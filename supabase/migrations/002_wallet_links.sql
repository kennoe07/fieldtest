begin;
create table public.ft_wallet_links (
  user_id uuid primary key references auth.users(id),
  address text unique not null check (address ~ '^0x[0-9a-f]{64}$'),
  verified_at timestamptz not null default now()
);
alter table public.ft_wallet_links enable row level security;
revoke all on public.ft_wallet_links from public, anon, authenticated;
grant select on public.ft_wallet_links to authenticated;
create policy own_wallet on public.ft_wallet_links for select to authenticated using (user_id=auth.uid());

create table fieldtest_private.wallet_challenges (
  user_id uuid primary key references auth.users(id),
  nonce uuid not null,
  address text not null,
  origin text not null,
  message text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
revoke all on fieldtest_private.wallet_challenges from public,anon,authenticated;

create function public.ft_begin_wallet_link(p_address text, p_origin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); n uuid:=gen_random_uuid(); expires timestamptz:=now()+interval '5 minutes'; msg text;
begin
  if u is null then raise exception 'Sign in first'; end if;
  if p_address !~ '^0x[0-9a-f]{64}$' or p_address is null then raise exception 'Invalid wallet address'; end if;
  if p_origin is null or p_origin not in ('https://fieldtest-two.vercel.app','http://127.0.0.1:5173') then raise exception 'Invalid origin'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  if exists(select 1 from public.ft_wallet_links where user_id=u) then raise exception 'Account already has a verified wallet'; end if;
  if exists(select 1 from fieldtest_private.wallet_challenges where user_id=u and created_at > now()-interval '30 seconds') then raise exception 'Wait 30 seconds before requesting another challenge'; end if;
  msg := 'Fieldtest wallet ownership verification v1' || E'\nOrigin: ' || p_origin || E'\nAccount: ' || u::text || E'\nWallet: ' || p_address || E'\nNetwork: sui:mainnet\nNonce: ' || n::text || E'\nExpires: ' || to_char(expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || E'\nPurpose: Link this wallet to this Fieldtest account. This is not a transaction and authorizes no payments.';
  insert into fieldtest_private.wallet_challenges(user_id,nonce,address,origin,message,expires_at)
    values(u,n,p_address,p_origin,msg,expires)
    on conflict(user_id) do update set nonce=excluded.nonce,address=excluded.address,origin=excluded.origin,message=excluded.message,expires_at=excluded.expires_at,used=false,created_at=now();
  return jsonb_build_object('nonce',n,'address',p_address,'message',msg,'expiresAt',expires);
end $$;

-- These two functions are only callable by the server verifier, never browsers.
create function public.ft_get_wallet_challenge(p_user uuid, p_nonce uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('address',address,'origin',origin,'message',message,'expiresAt',expires_at)
 from fieldtest_private.wallet_challenges where user_id=p_user and nonce=p_nonce and not used and expires_at>now()
$$;

create function public.ft_complete_wallet_link(p_user uuid,p_nonce uuid,p_address text) returns void
language plpgsql security definer set search_path='' as $$
declare c fieldtest_private.wallet_challenges;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select * into c from fieldtest_private.wallet_challenges where user_id=p_user for update;
  if not found or c.used or c.nonce<>p_nonce or c.address<>p_address or c.expires_at<=now() then raise exception 'Challenge expired or already used'; end if;
  insert into public.ft_wallet_links(user_id,address) values(p_user,p_address);
  update fieldtest_private.wallet_challenges set used=true where user_id=p_user;
end $$;

revoke all on function public.ft_begin_wallet_link(text,text) from public,anon,authenticated;
grant execute on function public.ft_begin_wallet_link(text,text) to authenticated;
revoke all on function public.ft_get_wallet_challenge(uuid,uuid),public.ft_complete_wallet_link(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ft_get_wallet_challenge(uuid,uuid),public.ft_complete_wallet_link(uuid,uuid,text) to service_role;
commit;
