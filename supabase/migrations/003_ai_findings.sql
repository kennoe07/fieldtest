begin;
create table public.ft_ai_reports (
 campaign_id uuid primary key references public.ft_campaigns(id),
 source_hash text not null,
 model text not null,
 report jsonb not null,
 generated_at timestamptz not null default now()
);
alter table public.ft_ai_reports enable row level security;
revoke all on public.ft_ai_reports from public,anon,authenticated;
grant select on public.ft_ai_reports to authenticated;
create policy ai_report_owner_read on public.ft_ai_reports for select to authenticated using(fieldtest_private.is_owner(campaign_id));
create table fieldtest_private.ai_runs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 campaign_id uuid not null references public.ft_campaigns(id),
 source_hash text not null,
 created_at timestamptz not null default now(),
 finished boolean not null default false
);
revoke all on fieldtest_private.ai_runs from public,anon,authenticated;
create index ai_runs_owner_created on fieldtest_private.ai_runs(owner_id,created_at);

create function public.ft_reserve_ai_run(p_campaign uuid,p_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); run uuid;
begin
 if u is null or not fieldtest_private.is_owner(p_campaign) then raise exception 'Campaign owner access required'; end if;
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid source fingerprint'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,1));
 if (select count(*) from fieldtest_private.ai_runs where owner_id=u and created_at>now()-interval '24 hours')>=5 then raise exception 'Daily generation limit reached (5 requests per 24 hours).'; end if;
 if exists(select 1 from fieldtest_private.ai_runs where owner_id=u and (created_at>now()-interval '60 seconds' or (not finished and created_at>now()-interval '2 minutes'))) then raise exception 'Generation is running or cooling down. Please wait before trying again.'; end if;
 insert into fieldtest_private.ai_runs(owner_id,campaign_id,source_hash) values(u,p_campaign,p_hash) returning id into run;
 return run;
end $$;

create function public.ft_finish_ai_run(p_run uuid,p_owner uuid,p_report jsonb,p_model text) returns void
language plpgsql security definer set search_path='' as $$
declare r fieldtest_private.ai_runs;
begin
 select * into r from fieldtest_private.ai_runs where id=p_run for update;
 if not found or r.owner_id<>p_owner or r.finished or r.created_at<now()-interval '2 minutes' then raise exception 'Generation lease expired'; end if;
 if p_report is not null then
   if not exists(select 1 from public.ft_campaigns where id=r.campaign_id and owner_id=p_owner) then raise exception 'Campaign access changed'; end if;
   insert into public.ft_ai_reports(campaign_id,source_hash,model,report) values(r.campaign_id,r.source_hash,p_model,p_report)
   on conflict(campaign_id) do update set source_hash=excluded.source_hash,model=excluded.model,report=excluded.report,generated_at=now();
 end if;
 update fieldtest_private.ai_runs set finished=true where id=p_run;
end $$;
revoke all on function public.ft_reserve_ai_run(uuid,text) from public,anon,authenticated;
grant execute on function public.ft_reserve_ai_run(uuid,text) to authenticated;
revoke all on function public.ft_finish_ai_run(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.ft_finish_ai_run(uuid,uuid,jsonb,text) to service_role;
commit;
