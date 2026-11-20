begin;
create table public.ft_reward_intents (
 id uuid primary key default gen_random_uuid(),
 plan_id uuid not null references public.ft_reward_plans(id),
 actor_id uuid not null references auth.users(id),
 request_key uuid not null,
 action text not null check(action in ('create','enroll','submit','approve','refund')),
 payload jsonb not null,
 business_hash text not null,
 state text not null default 'Prepared' check(state in ('Prepared','AwaitingWallet','Submitted','Confirmed','Failed','Cancelled','Expired')),
 tx_digest text,
 tx_bytes text,
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(actor_id,request_key),
 check((tx_digest is null)=(tx_bytes is null))
);
create unique index ft_reward_one_live_intent on public.ft_reward_intents(plan_id,actor_id,business_hash) where state in ('Prepared','AwaitingWallet','Submitted','Confirmed');
create unique index ft_reward_one_pending_action on public.ft_reward_intents(plan_id,actor_id,action,(coalesce(payload->>'tester',''))) where state in ('Prepared','AwaitingWallet','Submitted');
create unique index ft_reward_one_bound_transaction on public.ft_reward_intents(tx_digest) where tx_digest is not null;
alter table public.ft_reward_intents enable row level security;
revoke all on public.ft_reward_intents from public,anon,authenticated,service_role;
grant select on public.ft_reward_intents to service_role;

-- All inputs except request key/action/target are assembled from authoritative
-- records. A future endpoint must authenticate p_actor from its session.
create function public.ft_prepare_reward_intent(p_plan uuid,p_actor uuid,p_request uuid,p_action text,p_target uuid default null,p_snapshot jsonb default null,p_canonical text default null,p_commitment text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.ft_reward_plans; a public.ft_reward_participants; s public.ft_submissions; h text; body jsonb; key text; prior public.ft_reward_intents; result public.ft_reward_intents; cutoff timestamptz;
begin
 select * into p from public.ft_reward_plans where id=p_plan for update;
 if not found or p_actor is null or p_request is null or p_action is null or p_action not in ('create','enroll','submit','approve','refund') then raise exception 'Invalid reward intent'; end if;
 -- Freeze the wallet identity from accepted terms/plan, not a browser address.
 if p_action='submit' then
   select * into a from public.ft_reward_participants where plan_id=p_plan and tester_id=p_actor;
   if not found or a.terms_hash<>p.terms_hash then raise exception 'Accepted tester terms required'; end if;
 else
   if p.owner_id<>p_actor or not exists(select 1 from public.ft_wallet_links where user_id=p_actor and address=p.owner_address) then raise exception 'Verified builder access required'; end if;
 end if;
 body:=jsonb_build_object('network',p.network,'packageId',p.package_id,'asset','USDC','termsHash',p.terms_hash,'action',p_action,'sender',case when p_action='submit' then a.address else p.owner_address end);
 if p_action='create' then
   if p.state<>'Frozen' then raise exception 'Plan already funded or closed'; end if;
   body:=body||jsonb_build_object('rewardBaseUnits',p.reward_base_units::text,'slots',p.document->>'slots','submitUntilMs',p.document->>'submitUntilMs','reviewUntilMs',p.document->>'reviewUntilMs');
 else
   if p.state<>'Funded' or p.chain_campaign_id is null then raise exception 'Funded campaign required'; end if;
   body:=body||jsonb_build_object('campaignId',p.chain_campaign_id);
 end if;
 cutoff:=to_timestamp((p.document->>'submitUntilMs')::numeric/1000);
 if p_action in ('enroll','approve') then
   select * into a from public.ft_reward_participants where plan_id=p_plan and tester_id=p_target;
   if not found or a.terms_hash<>p.terms_hash then raise exception 'Accepted tester required'; end if;
   body:=body||jsonb_build_object('tester',a.address);
 end if;
 if p_action='submit' then
   -- Reuse the already saved commitment for these exact source contents, even
   -- when two retrying servers generated different candidate salts.
   select submission_hash into h from public.ft_reward_commitments where plan_id=p_plan and tester_id=p_actor and snapshot=p_snapshot order by created_at desc,submission_hash limit 1;
   if h is null then h:=public.ft_save_reward_commitment(p_plan,p_actor,p_snapshot,p_canonical); end if;
   -- Existing snapshots also need rechecking against current feedback.
   select * into s from public.ft_submissions where campaign_id=p.campaign_id and tester_id=p_actor for update;
   if not found or s.status not in ('Submitted','Approved') or p_snapshot is distinct from jsonb_build_object('id',s.id,'campaign_id',s.campaign_id,'tester_id',s.tester_id,'responses',s.responses,'summary',s.summary) then raise exception 'Feedback changed'; end if;
   body:=body||jsonb_build_object('submissionHash',h);
 elsif p_action='approve' then
   select * into s from public.ft_submissions where campaign_id=p.campaign_id and tester_id=p_target for update;
   if not found or s.status<>'Approved' or not exists(select 1 from public.ft_reward_commitments c where c.plan_id=p_plan and c.tester_id=p_target and c.submission_hash=p_commitment and c.snapshot=jsonb_build_object('id',s.id,'campaign_id',s.campaign_id,'tester_id',s.tester_id,'responses',s.responses,'summary',s.summary)) then raise exception 'Approved feedback commitment required'; end if;
   if exists(select 1 from public.ft_reward_events where plan_id=p_plan and kind='Paid' and recipient=a.address) then raise exception 'Tester already paid'; end if;
   body:=body||jsonb_build_object('submissionHash',p_commitment);
   cutoff:=to_timestamp((p.document->>'reviewUntilMs')::numeric/1000);
 elsif p_action='refund' then
   if now()<to_timestamp((p.document->>'reviewUntilMs')::numeric/1000) then raise exception 'Refund cutoff not reached'; end if;
   cutoff:=now()+interval '15 minutes';
 end if;
 key:=encode(sha256(convert_to(body::text,'UTF8')),'hex');
 update public.ft_reward_intents set state='Expired',updated_at=now() where plan_id=p_plan and actor_id=p_actor and state='Prepared' and expires_at<=now();
 select * into prior from public.ft_reward_intents where actor_id=p_actor and request_key=p_request;
 if found then
   if prior.plan_id<>p_plan or prior.business_hash<>key then raise exception 'Request key reused for a different action'; end if;
   return to_jsonb(prior);
 end if;
 -- An armed or submitted transaction is never expired by wall-clock time.
 select * into prior from public.ft_reward_intents where plan_id=p_plan and actor_id=p_actor and business_hash=key and state in ('Prepared','AwaitingWallet','Submitted','Confirmed');
 if found then return to_jsonb(prior); end if;
 if cutoff<=now() then raise exception 'Reward action deadline passed'; end if;
 insert into public.ft_reward_intents(plan_id,actor_id,request_key,action,payload,business_hash,expires_at)
 values(p_plan,p_actor,p_request,p_action,body,key,least(cutoff,now()+interval '15 minutes')) returning * into result;
 return to_jsonb(result);
end $$;

-- Store only unsigned transaction bytes. Signatures/private keys are never stored.
-- The trusted server must build/simulate these bytes against the intent and
-- compute the Sui digest before invoking this RPC; browser bytes are forbidden.
create function public.ft_bind_reward_intent(p_intent uuid,p_actor uuid,p_digest text,p_bytes text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.ft_reward_intents;
begin
 select * into i from public.ft_reward_intents where id=p_intent for update;
 if not found or i.actor_id is distinct from p_actor then raise exception 'Intent actor mismatch'; end if;
 if i.tx_digest is not null then
   if i.tx_digest=p_digest and i.tx_bytes=p_bytes and i.state in ('AwaitingWallet','Submitted','Confirmed') then return to_jsonb(i); end if;
   raise exception 'Bound transaction cannot be replaced';
 end if;
 if i.state<>'Prepared' or i.expires_at<=now() then raise exception 'Intent is no longer ready'; end if;
 if p_digest is null or p_digest !~ '^[1-9A-HJ-NP-Za-km-z]{32,64}$' or p_bytes is null or length(p_bytes) not between 1 and 180000 or p_bytes !~ '^[A-Za-z0-9+/]+={0,2}$' then raise exception 'Invalid unsigned transaction'; end if;
 update public.ft_reward_intents set state='AwaitingWallet',tx_digest=p_digest,tx_bytes=p_bytes,updated_at=now() where id=p_intent returning * into i;
 return to_jsonb(i);
end $$;

create function public.ft_transition_reward_intent(p_intent uuid,p_actor uuid,p_state text,p_digest text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.ft_reward_intents;
begin
 select * into i from public.ft_reward_intents where id=p_intent for update;
 if not found or i.actor_id is distinct from p_actor then raise exception 'Intent actor mismatch'; end if;
 if p_state='Cancelled' then
   if i.state='Cancelled' then return to_jsonb(i); end if;
   if i.state<>'Prepared' or i.tx_digest is not null then raise exception 'Reconcile bound transaction before cancellation'; end if;
 elsif p_state='Submitted' then
   if i.tx_digest is null or i.tx_digest is distinct from p_digest or i.state not in ('AwaitingWallet','Submitted') then raise exception 'Submitted digest mismatch'; end if;
 elsif p_state='Failed' then
   -- Only a trusted chain reconciler may report failure. Wallet rejection or a
   -- request timeout is NOT a confirmed failed transaction.
   if i.tx_digest is null or i.tx_digest is distinct from p_digest or i.state not in ('AwaitingWallet','Submitted','Failed') then raise exception 'Failed digest mismatch'; end if;
 elsif p_state='Confirmed' then
   if i.tx_digest is null or i.tx_digest is distinct from p_digest or i.state not in ('AwaitingWallet','Submitted','Confirmed') then raise exception 'Confirmed digest mismatch'; end if;
   if not exists(select 1 from public.ft_reward_events e join public.ft_reward_event_proofs proof using(network,tx_digest,event_seq)
      where e.plan_id=i.plan_id and e.tx_digest=i.tx_digest and
       ((i.action='create' and e.kind='Funded') or (i.action='approve' and e.kind='Paid' and e.recipient=i.payload->>'tester') or (i.action='refund' and e.kind='Refunded'))) then raise exception 'Verified financial receipt required; participation confirmation is not active'; end if;
 else raise exception 'Invalid intent transition'; end if;
 update public.ft_reward_intents set state=p_state,updated_at=now() where id=p_intent returning * into i;
 return to_jsonb(i);
end $$;
revoke all on function public.ft_prepare_reward_intent(uuid,uuid,uuid,text,uuid,jsonb,text,text),public.ft_bind_reward_intent(uuid,uuid,text,text),public.ft_transition_reward_intent(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ft_prepare_reward_intent(uuid,uuid,uuid,text,uuid,jsonb,text,text),public.ft_bind_reward_intent(uuid,uuid,text,text),public.ft_transition_reward_intent(uuid,uuid,text,text) to service_role;
commit;
