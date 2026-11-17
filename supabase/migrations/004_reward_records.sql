begin;
create table public.ft_reward_drafts (
 campaign_id uuid primary key references public.ft_campaigns(id),
 review_days integer not null check(review_days in (1,3,7,14,30)),
 updated_at timestamptz not null default now()
);
create table public.ft_reward_plans (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid unique not null references public.ft_campaigns(id),
 owner_id uuid not null references auth.users(id),
 owner_address text not null,
 network text not null check(network='sui:mainnet'),
 package_id text not null check(package_id ~ '^0x[0-9a-f]{64}$' and package_id !~ '^0x0+$'),
 terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
 document jsonb not null,
 total_base_units bigint not null check(total_base_units>0),
 reward_base_units bigint not null check(reward_base_units>0),
 chain_campaign_id text unique,
 state text not null default 'Frozen' check(state in ('Frozen','Funded','Closed')),
 remaining_base_units bigint not null default 0 check(remaining_base_units>=0),
 created_at timestamptz not null default now()
);
create table public.ft_reward_events (
 network text not null check(network='sui:mainnet'),
 tx_digest text not null check(tx_digest ~ '^[1-9A-HJ-NP-Za-km-z]{32,64}$'),
 event_seq integer not null check(event_seq>=0),
 plan_id uuid not null references public.ft_reward_plans(id),
 kind text not null check(kind in ('Funded','Paid','Refunded')),
 chain_campaign_id text not null check(chain_campaign_id ~ '^0x[0-9a-f]{64}$'),
 recipient text not null check(recipient ~ '^0x[0-9a-f]{64}$' and recipient !~ '^0x0+$'),
 amount_base_units bigint not null check(amount_base_units>=0),
 recorded_at timestamptz not null default now(),
 primary key(network,tx_digest,event_seq)
);
create unique index one_reward_per_tester on public.ft_reward_events(plan_id,recipient) where kind='Paid';
create unique index one_funding_and_refund on public.ft_reward_events(plan_id,kind) where kind in ('Funded','Refunded');
alter table public.ft_reward_drafts enable row level security;
alter table public.ft_reward_plans enable row level security;
alter table public.ft_reward_events enable row level security;
revoke all on public.ft_reward_drafts,public.ft_reward_plans,public.ft_reward_events from public,anon,authenticated;
grant select on public.ft_reward_drafts,public.ft_reward_plans,public.ft_reward_events to authenticated;
create policy reward_draft_owner on public.ft_reward_drafts for select to authenticated using(fieldtest_private.is_owner(campaign_id));
create policy reward_plan_owner on public.ft_reward_plans for select to authenticated using(owner_id=auth.uid());
create policy reward_event_owner on public.ft_reward_events for select to authenticated using(exists(select 1 from public.ft_reward_plans p where p.id=plan_id and p.owner_id=auth.uid()));

create function public.ft_save_reward_draft(p_campaign uuid,p_days integer) returns void
language plpgsql security definer set search_path='' as $$
declare c public.ft_campaigns;
begin
 select * into c from public.ft_campaigns where id=p_campaign for update;
 if not found or c.owner_id<>auth.uid() or auth.uid() is null then raise exception 'Campaign owner access required'; end if;
 if exists(select 1 from public.ft_reward_plans where campaign_id=p_campaign) then raise exception 'Reward terms are already frozen'; end if;
 if c.deadline<=now() then raise exception 'Use a campaign with a future deadline'; end if;
 insert into public.ft_reward_drafts(campaign_id,review_days) values(p_campaign,p_days)
 on conflict(campaign_id) do update set review_days=excluded.review_days,updated_at=now();
end $$;

-- Server service only: caller must build/hash terms from authoritative data and
-- validate deployed package identity before calling. This never funds a contract.
create function public.ft_freeze_reward_plan(p_campaign uuid,p_owner uuid,p_package text,p_hash text,p_document jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.ft_campaigns; w text; days integer; prior public.ft_reward_plans; result uuid; submit_ms bigint;
begin
 select * into c from public.ft_campaigns where id=p_campaign for update;
 if not found or c.owner_id<>p_owner or p_owner is null then raise exception 'Campaign owner access required'; end if;
 select * into prior from public.ft_reward_plans where campaign_id=p_campaign;
 if found then
   if prior.terms_hash=p_hash and prior.document=p_document then return prior.id; end if;
   raise exception 'Frozen terms cannot be replaced';
 end if;
 if c.deadline<=now() or exists(select 1 from public.ft_members where campaign_id=p_campaign) then raise exception 'Freeze only future campaigns before any testers join'; end if;
 select address into w from public.ft_wallet_links where user_id=p_owner;
 if w is null then raise exception 'Verified builder wallet required'; end if;
 select review_days into days from public.ft_reward_drafts where campaign_id=p_campaign;
 if days is null then raise exception 'Save a reward draft first'; end if;
 submit_ms:=floor(extract(epoch from c.deadline)*1000)::bigint;
 if p_document is null or
    p_document->>'schema' is distinct from 'fieldtest-reward-terms-v1' or
    p_document->>'network' is distinct from 'sui:mainnet' or
    p_document->>'packageId' is distinct from p_package or
    p_document->>'campaignId' is distinct from c.id::text or
    p_document->>'owner' is distinct from w or
    coalesce(p_document->>'salt','') !~ '^[0-9a-f]{64}$' or
    p_document->'asset'->>'coinType' is distinct from '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC' or
    p_document->'asset'->>'symbol' is distinct from 'USDC' or
    p_document->'asset'->>'decimals' is distinct from '6' or
    p_document->>'rewardBaseUnits' is distinct from (c.reward::bigint*1000000)::text or
    p_document->>'slots' is distinct from c.slots::text or
    p_document->>'submitUntilMs' is distinct from submit_ms::text or
    p_document->>'reviewUntilMs' is distinct from (submit_ms+days::bigint*86400000)::text or
    p_document->'research' is distinct from jsonb_build_object('name',c.name,'project',c.project,'goal',c.description,'productUrl',c.product_url,'tasks',c.tasks,'acceptanceCriteria',c.criteria)
 then raise exception 'Reward document does not match authoritative terms'; end if;
 insert into public.ft_reward_plans(campaign_id,owner_id,owner_address,network,package_id,terms_hash,document,total_base_units,reward_base_units)
 values(c.id,p_owner,w,'sui:mainnet',p_package,p_hash,p_document,c.reward::bigint*1000000*c.slots,c.reward::bigint*1000000) returning id into result;
 return result;
end $$;

-- No HTTP ingestion endpoint is provided. A future trusted verifier must check
-- successful transaction effects, network, package, coin type, terms digest,
-- chain object, recipient, and event provenance before using this function.
create function public.ft_record_reward_event(p_plan uuid,p_digest text,p_seq integer,p_kind text,p_object text,p_recipient text,p_amount bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare p public.ft_reward_plans; prior public.ft_reward_events;
begin
 select * into p from public.ft_reward_plans where id=p_plan for update;
 if not found then raise exception 'Unknown reward plan'; end if;
 select * into prior from public.ft_reward_events where network=p.network and tx_digest=p_digest and event_seq=p_seq;
 if found then
   if prior.plan_id=p_plan and prior.kind=p_kind and prior.chain_campaign_id=p_object and prior.recipient=p_recipient and prior.amount_base_units=p_amount then return false; end if;
   raise exception 'Conflicting replay of chain event';
 end if;
 if p_kind='Funded' then
   if p.state<>'Frozen' or p_amount<>p.total_base_units or p_recipient<>p.owner_address then raise exception 'Invalid funding event'; end if;
   update public.ft_reward_plans set state='Funded',chain_campaign_id=p_object,remaining_base_units=p_amount where id=p_plan;
 elsif p_kind='Paid' then
   if p.state<>'Funded' or p.chain_campaign_id<>p_object or p_amount<>p.reward_base_units or p.remaining_base_units<p_amount or p_recipient=p.owner_address then raise exception 'Invalid payment event'; end if;
   update public.ft_reward_plans set remaining_base_units=remaining_base_units-p_amount where id=p_plan;
 elsif p_kind='Refunded' then
   if p.state<>'Funded' or p.chain_campaign_id<>p_object or p_amount<>p.remaining_base_units or p_recipient<>p.owner_address then raise exception 'Invalid refund event'; end if;
   update public.ft_reward_plans set state='Closed',remaining_base_units=0 where id=p_plan;
 else raise exception 'Invalid event kind'; end if;
 insert into public.ft_reward_events(network,tx_digest,event_seq,plan_id,kind,chain_campaign_id,recipient,amount_base_units)
 values(p.network,p_digest,p_seq,p_plan,p_kind,p_object,p_recipient,p_amount);
 return true;
end $$;
revoke all on function public.ft_save_reward_draft(uuid,integer),public.ft_freeze_reward_plan(uuid,uuid,text,text,jsonb),public.ft_record_reward_event(uuid,text,integer,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.ft_save_reward_draft(uuid,integer) to authenticated;
grant execute on function public.ft_freeze_reward_plan(uuid,uuid,text,text,jsonb),public.ft_record_reward_event(uuid,text,integer,text,text,text,bigint) to service_role;

-- Keep the existing unfunded flow unchanged for ordinary campaigns, but do not
-- admit testers under that flow once reward terms have been frozen. Both freeze
-- and join lock the campaign row, preventing a check/join race.
alter function public.ft_join_campaign(uuid) set schema fieldtest_private;
revoke all on function fieldtest_private.ft_join_campaign(uuid) from public,anon,authenticated;
create function public.ft_join_campaign(invite_token uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare campaign uuid;
begin
 select c.id into campaign from public.ft_campaigns c join public.ft_invitations i on i.campaign_id=c.id
 where i.token=invite_token for update of c;
 if exists(select 1 from public.ft_reward_plans where campaign_id=campaign) then
   raise exception 'Reward-enabled participation is not active yet. This campaign cannot use an unfunded invitation.';
 end if;
 return fieldtest_private.ft_join_campaign(invite_token);
end $$;
revoke all on function public.ft_join_campaign(uuid) from public,anon,authenticated;
grant execute on function public.ft_join_campaign(uuid) to authenticated;
commit;
