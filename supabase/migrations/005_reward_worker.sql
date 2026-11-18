begin;
-- No cursor is provisioned here: worker activation requires a reviewed policy,
-- publication checkpoint and previous checkpoint digest from a trusted node.
create table public.ft_reward_worker_cursors (
 id text primary key,
 policy_hash text not null check(policy_hash ~ '^[0-9a-f]{64}$'),
 next_checkpoint text not null check(next_checkpoint ~ '^[1-9][0-9]*$' and next_checkpoint::numeric<=18446744073709551615),
 previous_digest text not null check(previous_digest ~ '^[1-9A-HJ-NP-Za-km-z]{32,64}$'),
 updated_at timestamptz not null default now()
);
create table public.ft_reward_event_proofs (
 network text not null,
 tx_digest text not null,
 event_seq integer not null,
 worker_id text not null references public.ft_reward_worker_cursors(id),
 checkpoint numeric(20,0) not null check(checkpoint>0),
 checkpoint_digest text not null,
 transaction_index integer not null check(transaction_index>=0),
 object_version numeric(20,0) not null check(object_version>0),
 policy_hash text not null,
 primary key(network,tx_digest,event_seq),
 foreign key(network,tx_digest,event_seq) references public.ft_reward_events(network,tx_digest,event_seq)
);
alter table public.ft_reward_worker_cursors enable row level security;
alter table public.ft_reward_event_proofs enable row level security;
revoke all on public.ft_reward_worker_cursors,public.ft_reward_event_proofs from public,anon,authenticated;
grant select,insert on public.ft_reward_worker_cursors to service_role;
grant select on public.ft_reward_event_proofs to service_role;
-- Service-role Supabase clients bypass RLS but still need table privileges.

create function public.ft_commit_reward_checkpoint(p_worker text,p_policy text,p_checkpoint text,p_previous text,p_digest text,p_receipts jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare c public.ft_reward_worker_cursors; r jsonb; last_index integer:=-1; idx integer; inserted boolean;
begin
 select * into c from public.ft_reward_worker_cursors where id=p_worker for update;
 if not found or c.policy_hash is distinct from p_policy or c.next_checkpoint is distinct from p_checkpoint or c.previous_digest is distinct from p_previous then
   raise exception 'Stale cursor or changed reward policy';
 end if;
 if p_digest is null or p_digest !~ '^[1-9A-HJ-NP-Za-km-z]{32,64}$' or p_receipts is null or jsonb_typeof(p_receipts)<>'array' then raise exception 'Invalid checkpoint batch'; end if;
 if jsonb_array_length(p_receipts)>10000 then raise exception 'Checkpoint batch too large'; end if;
 for r in select value from jsonb_array_elements(p_receipts) loop
   idx:=(r->>'transactionIndex')::integer;
   if idx is null or idx<=last_index or r->>'checkpoint' is distinct from p_checkpoint or r->>'network' is distinct from 'sui:mainnet' or (r->>'objectVersion')::numeric<=0 then raise exception 'Invalid receipt order or proof'; end if;
   last_index:=idx;
   inserted:=public.ft_record_reward_event((r->>'planId')::uuid,r->>'transactionDigest',(r->>'eventSeq')::integer,r->>'kind',r->>'chainCampaignId',r->>'recipient',(r->>'amountBaseUnits')::bigint);
   -- An existing ledger event without this atomic cursor advance indicates an
   -- earlier ingestion path. Reconcile it explicitly rather than backfill proof.
   if not inserted then raise exception 'Receipt already recorded outside this checkpoint'; end if;
   insert into public.ft_reward_event_proofs(network,tx_digest,event_seq,worker_id,checkpoint,checkpoint_digest,transaction_index,object_version,policy_hash)
   values(r->>'network',r->>'transactionDigest',(r->>'eventSeq')::integer,p_worker,p_checkpoint::numeric,p_digest,idx,(r->>'objectVersion')::numeric,p_policy);
 end loop;
 update public.ft_reward_worker_cursors set next_checkpoint=(next_checkpoint::numeric+1)::text,previous_digest=p_digest,updated_at=now() where id=p_worker;
end $$;
revoke all on function public.ft_commit_reward_checkpoint(text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.ft_commit_reward_checkpoint(text,text,text,text,text,jsonb) to service_role;
commit;
