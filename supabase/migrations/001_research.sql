begin;
create schema if not exists fieldtest_private;
revoke all on schema fieldtest_private from public;
grant usage on schema fieldtest_private to authenticated;

create table public.ft_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 100),
  project text not null check (length(trim(project)) between 1 and 80),
  description text not null check (length(trim(description)) between 10 and 1000),
  tasks jsonb not null check (jsonb_typeof(tasks)='array' and jsonb_array_length(tasks) between 1 and 12),
  criteria text not null check (length(trim(criteria)) between 10 and 2000),
  product_url text not null check (length(product_url)<=500 and product_url ~ '^https?://[^[:space:]]+$'),
  reward integer not null check (reward between 1 and 1000),
  slots integer not null check (slots between 1 and 50),
  deadline timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.ft_invitations (
  campaign_id uuid primary key references public.ft_campaigns(id),
  token uuid unique not null default gen_random_uuid()
);
create table public.ft_members (
  campaign_id uuid not null references public.ft_campaigns(id),
  tester_id uuid not null references auth.users(id),
  joined_at timestamptz not null default now(),
  primary key(campaign_id,tester_id)
);
create table public.ft_submissions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ft_campaigns(id),
  tester_id uuid not null references auth.users(id),
  tester_name text not null,
  responses jsonb not null,
  summary text not null default '',
  status text not null default 'Submitted' check (status in ('Submitted','Approved','Revision requested','Rejected')),
  review_note text not null default '',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id,tester_id),
  foreign key(campaign_id,tester_id) references public.ft_members(campaign_id,tester_id)
);
create index ft_campaign_owner on public.ft_campaigns(owner_id);
create index ft_submission_campaign on public.ft_submissions(campaign_id);
create index ft_submission_tester on public.ft_submissions(tester_id);

create function fieldtest_private.is_owner(campaign uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ft_campaigns c where c.id=campaign and c.owner_id=auth.uid());
$$;
create function fieldtest_private.is_member(campaign uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ft_members m where m.campaign_id=campaign and m.tester_id=auth.uid());
$$;
alter table public.ft_campaigns enable row level security;
alter table public.ft_invitations enable row level security;
alter table public.ft_members enable row level security;
alter table public.ft_submissions enable row level security;
create policy campaign_read on public.ft_campaigns for select to authenticated
 using (owner_id=auth.uid() or fieldtest_private.is_member(id));
create policy invitation_owner_read on public.ft_invitations for select to authenticated
 using (fieldtest_private.is_owner(campaign_id));
create policy member_read on public.ft_members for select to authenticated
 using (tester_id=auth.uid() or fieldtest_private.is_owner(campaign_id));
create policy submission_read on public.ft_submissions for select to authenticated
 using (tester_id=auth.uid() or fieldtest_private.is_owner(campaign_id));
revoke all on public.ft_campaigns,public.ft_invitations,public.ft_members,public.ft_submissions from public,anon,authenticated;
grant select on public.ft_campaigns,public.ft_invitations,public.ft_members,public.ft_submissions to authenticated;

create function public.ft_create_campaign(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; task jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if jsonb_typeof(payload->'tasks') is distinct from 'array' then raise exception 'Tasks are required'; end if;
 for task in select jsonb_array_elements(payload->'tasks') loop
   if jsonb_typeof(task)<>'string' or length(trim(task#>>'{}')) not between 1 and 300 then raise exception 'Invalid task'; end if;
 end loop;
 if (payload->>'deadline')::timestamptz <= now() then raise exception 'Deadline must be in the future'; end if;
 insert into public.ft_campaigns(owner_id,name,project,description,tasks,criteria,product_url,reward,slots,deadline)
 values(auth.uid(),trim(payload->>'name'),trim(payload->>'project'),trim(payload->>'description'),payload->'tasks',trim(payload->>'criteria'),payload->>'url',(payload->>'reward')::integer,(payload->>'slots')::integer,(payload->>'deadline')::timestamptz)
 returning id into result;
 insert into public.ft_invitations(campaign_id) values(result);
 return result;
end;
$$;

-- Invite links are bearer access: a signed-in holder can join until seats fill or the deadline passes.
-- Locking the campaign serializes joins, so two users cannot claim the final seat.
create function public.ft_join_campaign(invite_token uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.ft_campaigns;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select campaign.* into c from public.ft_campaigns campaign join public.ft_invitations i on i.campaign_id=campaign.id where i.token=invite_token for update of campaign;
 if not found then raise exception 'Invitation unavailable'; end if;
 if c.owner_id=auth.uid() then raise exception 'Use a separate tester account to test your campaign'; end if;
 if exists(select 1 from public.ft_members m where m.campaign_id=c.id and m.tester_id=auth.uid()) then return c.id; end if;
 if c.deadline<=now() then raise exception 'Campaign closed'; end if;
 if (select count(*) from public.ft_members where campaign_id=c.id)>=c.slots then raise exception 'No tester seats available'; end if;
 insert into public.ft_members(campaign_id,tester_id) values(c.id,auth.uid());
 return c.id;
end;
$$;

create function public.ft_submit_feedback(campaign uuid, payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.ft_campaigns; previous public.ft_submissions; r jsonb; e jsonb; idx integer:=0;
 total_bytes bigint:=0; file_bytes bigint; paths text[]:='{}'; result uuid;
begin
 if auth.uid() is null or not fieldtest_private.is_member(campaign) then raise exception 'Join this campaign first'; end if;
 select * into c from public.ft_campaigns where id=campaign for update;
 if c.deadline<=now() then raise exception 'Campaign closed'; end if;
 select * into previous from public.ft_submissions where campaign_id=campaign and tester_id=auth.uid();
 if found and previous.status<>'Revision requested' then raise exception 'Submission already exists'; end if;
 if coalesce(length(trim(payload->>'testerName')),0) not between 1 and 60 or coalesce(length(payload->>'summary'),0)>3000 then raise exception 'Invalid tester details'; end if;
 if jsonb_typeof(payload->'responses') is distinct from 'array' or jsonb_array_length(payload->'responses')<>jsonb_array_length(c.tasks) then raise exception 'Complete every task'; end if;
 for r in select jsonb_array_elements(payload->'responses') loop
   if (r->>'task') is distinct from (c.tasks->>idx) or coalesce(r->>'outcome','') not in ('Completed','Partly completed','Blocked')
      or coalesce(length(trim(r->>'expected')),0) not between 10 and 2000 or coalesce(length(trim(r->>'actual')),0) not between 10 and 2000 then raise exception 'Invalid task response'; end if;
   if jsonb_typeof(r->'evidence') is distinct from 'array' or jsonb_array_length(r->'evidence')>3 then raise exception 'Invalid evidence'; end if;
   for e in select jsonb_array_elements(r->'evidence') loop
     if coalesce(length(e->>'name'),0) not between 1 and 300 or coalesce(e->>'path','')=any(paths) then raise exception 'Invalid evidence path'; end if;
     select (o.metadata->>'size')::bigint into file_bytes from storage.objects o
       where o.bucket_id='fieldtest-evidence' and o.name=e->>'path'
       and split_part(o.name,'/',1)=auth.uid()::text and split_part(o.name,'/',2)=campaign::text;
     if not found or file_bytes is null or file_bytes>2097152 then raise exception 'Evidence unavailable or too large'; end if;
     total_bytes:=total_bytes+file_bytes; paths:=array_append(paths,e->>'path');
   end loop;
   idx:=idx+1;
 end loop;
 if total_bytes>6291456 then raise exception 'Evidence exceeds 6 MB'; end if;
 insert into public.ft_submissions(campaign_id,tester_id,tester_name,responses,summary)
 values(campaign,auth.uid(),trim(payload->>'testerName'),payload->'responses',coalesce(payload->>'summary',''))
 on conflict(campaign_id,tester_id) do update set tester_name=excluded.tester_name,responses=excluded.responses,summary=excluded.summary,status='Submitted',review_note='',updated_at=now()
 returning id into result;
 return result;
end;
$$;
create function public.ft_review_submission(submission uuid, decision text, note text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.ft_submissions;
begin
 select * into s from public.ft_submissions where id=submission for update;
 if not found or not fieldtest_private.is_owner(s.campaign_id) then raise exception 'Review not allowed'; end if;
 if s.status<>'Submitted' then raise exception 'Submission already reviewed'; end if;
 if decision not in ('Approved','Rejected','Revision requested') or length(coalesce(note,''))>2000
    or (decision<>'Approved' and coalesce(length(trim(note)),0)<10) then raise exception 'Invalid review decision or note'; end if;
 update public.ft_submissions set status=decision,review_note=coalesce(trim(note),''),updated_at=now() where id=submission;
end;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('fieldtest-evidence','fieldtest-evidence',false,2097152,array['image/jpeg','image/png','image/webp']);
create function fieldtest_private.evidence_referenced(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ft_submissions s, jsonb_array_elements(s.responses) r, jsonb_array_elements(r->'evidence') e where e->>'path'=path);
$$;
create function fieldtest_private.can_read_evidence(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ft_submissions s join public.ft_campaigns c on c.id=s.campaign_id,
   jsonb_array_elements(s.responses) r, jsonb_array_elements(r->'evidence') e
   where e->>'path'=path and (s.tester_id=auth.uid() or c.owner_id=auth.uid()));
$$;
create policy ft_evidence_upload on storage.objects for insert to authenticated with check (
 bucket_id='fieldtest-evidence' and split_part(name,'/',1)=auth.uid()::text
 and exists(select 1 from public.ft_members m join public.ft_campaigns c on c.id=m.campaign_id
   where m.campaign_id::text=split_part(storage.objects.name,'/',2) and m.tester_id=auth.uid() and c.deadline>now())
);
create policy ft_evidence_read on storage.objects for select to authenticated using (
 bucket_id='fieldtest-evidence' and (split_part(name,'/',1)=auth.uid()::text or fieldtest_private.can_read_evidence(name))
);
-- No UPDATE policy: finalized files cannot be overwritten.
create policy ft_evidence_cleanup on storage.objects for delete to authenticated using (
 bucket_id='fieldtest-evidence' and split_part(name,'/',1)=auth.uid()::text and not fieldtest_private.evidence_referenced(name)
);

revoke execute on function public.ft_create_campaign(jsonb), public.ft_join_campaign(uuid), public.ft_submit_feedback(uuid,jsonb), public.ft_review_submission(uuid,text,text) from public,anon;
grant execute on function public.ft_create_campaign(jsonb), public.ft_join_campaign(uuid), public.ft_submit_feedback(uuid,jsonb), public.ft_review_submission(uuid,text,text) to authenticated;
revoke execute on all functions in schema fieldtest_private from public,anon;
grant execute on function fieldtest_private.is_owner(uuid),fieldtest_private.is_member(uuid),fieldtest_private.can_read_evidence(text),fieldtest_private.evidence_referenced(text) to authenticated;
commit;
