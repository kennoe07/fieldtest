begin;
create unique index ft_reward_unique_terms on public.ft_reward_plans(network,package_id,terms_hash);
create table public.ft_reward_participants (
 plan_id uuid not null references public.ft_reward_plans(id),
 tester_id uuid not null references auth.users(id),
 address text not null check(address ~ '^0x[0-9a-f]{64}$' and address !~ '^0x0+$'),
 terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
 accepted_at timestamptz not null default now(),
 primary key(plan_id,tester_id), unique(plan_id,address)
);
create table public.ft_reward_commitments (
 plan_id uuid not null,
 tester_id uuid not null,
 submission_id uuid not null references public.ft_submissions(id),
 submission_hash text not null check(submission_hash ~ '^[0-9a-f]{64}$'),
 document jsonb not null,
 snapshot jsonb not null,
 created_at timestamptz not null default now(),
 primary key(plan_id,tester_id,submission_hash),
 foreign key(plan_id,tester_id) references public.ft_reward_participants(plan_id,tester_id)
);
alter table public.ft_reward_participants enable row level security;
alter table public.ft_reward_commitments enable row level security;
revoke all on public.ft_reward_participants,public.ft_reward_commitments from public,anon,authenticated,service_role;
grant select on public.ft_reward_participants,public.ft_reward_commitments to service_role;

-- Future authenticated server endpoint must obtain p_tester from a verified
-- session and explicit consent. No endpoint invokes this function yet.
create function public.ft_accept_reward_terms(p_plan uuid,p_tester uuid,p_hash text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.ft_reward_plans; w text; prior public.ft_reward_participants;
begin
 select * into p from public.ft_reward_plans where id=p_plan for update;
 if not found or p.state<>'Funded' or p.terms_hash is distinct from p_hash or p.owner_id=p_tester or p_tester is null then raise exception 'Funded reward terms unavailable'; end if;
 select * into prior from public.ft_reward_participants where plan_id=p_plan and tester_id=p_tester;
 if found then
   if prior.terms_hash=p_hash then return; end if;
   raise exception 'Accepted terms cannot be replaced';
 end if;
 if (p.document->>'submitUntilMs')::numeric<=extract(epoch from now())*1000 then raise exception 'Reward participation closed'; end if;
 select address into w from public.ft_wallet_links where user_id=p_tester;
 if w is null or w=p.owner_address then raise exception 'Verified tester wallet required'; end if;
 if (select count(*) from public.ft_reward_participants where plan_id=p_plan)>=(p.document->>'slots')::integer then raise exception 'Reward seats full'; end if;
 insert into public.ft_members(campaign_id,tester_id) values(p.campaign_id,p_tester) on conflict do nothing;
 insert into public.ft_reward_participants(plan_id,tester_id,address,terms_hash) values(p_plan,p_tester,w,p_hash);
end $$;

-- The server hashes actual evidence bytes. This RPC computes the document hash
-- itself and verifies the feedback snapshot under lock; no browser hash is used.
create function public.ft_save_reward_commitment(p_plan uuid,p_tester uuid,p_snapshot jsonb,p_canonical text) returns text
language plpgsql security definer set search_path='' as $$
declare p public.ft_reward_plans; a public.ft_reward_participants; s public.ft_submissions; d jsonb; h text; r jsonb; e jsonb; idx integer:=0; j integer;
begin
 select * into p from public.ft_reward_plans where id=p_plan for update;
 if not found or p.state<>'Funded' or (p.document->>'submitUntilMs')::numeric<=extract(epoch from now())*1000 then raise exception 'Reward submission closed'; end if;
 select * into a from public.ft_reward_participants where plan_id=p_plan and tester_id=p_tester;
 if not found or a.terms_hash<>p.terms_hash then raise exception 'Accept reward terms first'; end if;
 select * into s from public.ft_submissions where campaign_id=p.campaign_id and tester_id=p_tester for update;
 if not found or s.status not in ('Submitted','Approved') or p_snapshot is distinct from jsonb_build_object('id',s.id,'campaign_id',s.campaign_id,'tester_id',s.tester_id,'responses',s.responses,'summary',s.summary) then raise exception 'Feedback snapshot changed or unavailable'; end if;
 if p_canonical is null or octet_length(p_canonical)>200000 then raise exception 'Invalid commitment document'; end if;
 d:=p_canonical::jsonb;
 if d->>'schema' is distinct from 'fieldtest-reward-submission-v1' or d->>'termsHash' is distinct from p.terms_hash or d->>'campaignId' is distinct from p.campaign_id::text or d->>'submissionId' is distinct from s.id::text or d->>'tester' is distinct from a.address or coalesce(d->>'salt','') !~ '^[0-9a-f]{64}$' or d->>'summary' is distinct from s.summary or jsonb_typeof(d->'responses') is distinct from 'array' then raise exception 'Commitment identity mismatch'; end if;
 if jsonb_array_length(d->'responses')<>jsonb_array_length(s.responses) then raise exception 'Commitment responses mismatch'; end if;
 for r in select value from jsonb_array_elements(d->'responses') loop
   if (r-'evidence') is distinct from ((s.responses->idx)-'evidence') or jsonb_typeof(r->'evidence') is distinct from 'array' then raise exception 'Commitment feedback mismatch'; end if;
   if jsonb_array_length(r->'evidence')<>jsonb_array_length(s.responses->idx->'evidence') then raise exception 'Commitment evidence mismatch'; end if;
   j:=0;
   for e in select value from jsonb_array_elements(r->'evidence') loop
     if e->>'name' is distinct from s.responses->idx->'evidence'->j->>'name' or coalesce(e->>'contentHash','') !~ '^[0-9a-f]{64}$' or coalesce(e->>'mime','') not in ('image/png','image/jpeg','image/webp') or coalesce((e->>'size')::integer,0) not between 1 and 2097152 then raise exception 'Invalid evidence commitment'; end if;
     j:=j+1;
   end loop;
   idx:=idx+1;
 end loop;
 h:=encode(sha256(convert_to(p_canonical,'UTF8')),'hex');
 insert into public.ft_reward_commitments(plan_id,tester_id,submission_id,submission_hash,document,snapshot) values(p_plan,p_tester,s.id,h,d,p_snapshot) on conflict do nothing;
 return h;
end $$;
revoke all on function public.ft_accept_reward_terms(uuid,uuid,text),public.ft_save_reward_commitment(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.ft_accept_reward_terms(uuid,uuid,text),public.ft_save_reward_commitment(uuid,uuid,jsonb,text) to service_role;
commit;
