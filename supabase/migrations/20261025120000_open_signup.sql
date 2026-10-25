-- 20261025120000_open_signup.sql — Accounts: root's "open sign-up" switch (DECISIONS 2026-10-25).
--
-- Supersedes, while switched on, 2026-10-15 "SwimZone stays invite-only": that decision said open
-- sign-up may become a setting later — this is that setting. Off by default.
--
--   open_signup (system_settings)   root turns it on/off (set_open_signup). Anyone can ask whether
--                                   it's on (is_open_signup), signed in or not — the sign-up page needs it.
--   Parent sign-up                  the self-signup Edge Function: name + email → invite email →
--                                   set password. validate_self_signup / record_self_signup here.
--   "Add my child"                  a signed-in adult adds their child (name, email, date of birth):
--                                   the child gets an invite email; the parent is their guardian at
--                                   once (they made the account). validate_child_addition /
--                                   record_child_addition. Allowed when open, or for anyone who can sponsor.
--   self_signups                    log of both, for the daily limits and as an audit trail.
--   Limits                          signup_daily_limit (all sign-ups, default 30 / 24 h) and
--                                   child_daily_limit (per parent, default 6 / 24 h).
--
-- Joining the club stays as it is: the parent opens the group's invite link and joins themself or
-- their child. Only service_role (the Edge Function) can call validate_/record_*.
-- Idempotent.

insert into public.system_settings (key, value, description) values
  ('open_signup', 'false'::jsonb, 'Root switch: anyone with the link can create an account (parents), and adults can add their children.'),
  ('signup_daily_limit', '30'::jsonb, 'Max self sign-ups (parents + children) across SwimZone in any 24 hours.'),
  ('child_daily_limit', '6'::jsonb, 'Max children one parent can add in any 24 hours.')
on conflict (key) do nothing;

create table if not exists public.self_signups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  kind        text not null check (kind in ('parent','child')),
  added_by    uuid references public.users(id) on delete set null,   -- the parent, for a child
  created_at  timestamptz not null default now()
);
create index if not exists self_signups_time_idx on public.self_signups (created_at);
create index if not exists self_signups_by_idx on public.self_signups (added_by, created_at);
alter table public.self_signups enable row level security;
drop policy if exists sz_self_signups_root on public.self_signups;
create policy sz_self_signups_root on public.self_signups for select to authenticated using (public.is_root());

-- ----------------------------------------------------------------------------
create or replace function public.is_open_signup() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from system_settings where key = 'open_signup'), false);
$$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then grant execute on function public.is_open_signup() to anon; end if;
end $$;

create or replace function public.set_open_signup(p_open boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_root() then raise exception 'NOT_ALLOWED: only root can open or close sign-up'; end if;
  insert into system_settings (key, value, description, updated_at)
  values ('open_signup', to_jsonb(coalesce(p_open, false)), 'Root switch: anyone with the link can create an account (parents), and adults can add their children.', now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return coalesce(p_open, false);
end $$;

-- Who signed up lately (root's view).
create or replace function public.recent_self_signups(p_days int default 30)
returns table (user_id uuid, name text, email text, kind text, added_by_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.user_id, coalesce(u.full_name, u.public_name), u.email, s.kind,
         (select coalesce(p.full_name, p.public_name) from users p where p.id = s.added_by), s.created_at
    from self_signups s join users u on u.id = s.user_id
   where public.is_root() and s.created_at > now() - make_interval(days => greatest(p_days, 1))
   order by s.created_at desc;
$$;

-- ----------------------------------------------------------------------------
-- For the Edge Function (service role). → a problem 'CODE: words', or null if fine.
create or replace function public.validate_self_signup(p_email text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_open_signup() then
    return 'SIGNUP_CLOSED: SwimZone is invite-only at the moment — ask your club for an invite';
  end if;
  if public.find_user_by_email(p_email) is not null then
    return 'ALREADY_REGISTERED: there''s already an account for that email — use "Forgot password?" on the sign-in page';
  end if;
  if (select count(*) from self_signups where created_at > now() - interval '24 hours')
     >= public.setting_int('signup_daily_limit', 30) then
    return 'RATE_LIMIT: too many sign-ups today — please try again tomorrow';
  end if;
  return null;
end $$;

create or replace function public.record_self_signup(p_user uuid, p_email text, p_full_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  v := public.validate_self_signup(p_email);
  if v is not null then raise exception '%', v; end if;
  insert into users (id, email, full_name) values (p_user, lower(trim(p_email)), nullif(btrim(p_full_name), ''))
  on conflict (id) do update set full_name = coalesce(excluded.full_name, users.full_name);
  insert into self_signups (user_id, kind) values (p_user, 'parent');
end $$;

create or replace function public.validate_child_addition(p_parent uuid, p_email text, p_date_of_birth date) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_open_signup() or public.can_sponsor(p_parent)) then
    return 'SIGNUP_CLOSED: adding children yourself isn''t switched on — ask your club';
  end if;
  if not public.is_adult(p_parent) then
    return 'GUARDIAN_NOT_ADULT: add your own date of birth (18 or over) on the Dashboard first';
  end if;
  if p_date_of_birth is null or p_date_of_birth > current_date or p_date_of_birth < current_date - interval '18 years' then
    return 'INVALID: the child''s date of birth is needed, and they must be under 18';
  end if;
  if public.find_user_by_email(p_email) is not null then
    return 'ALREADY_REGISTERED: there''s already an account for that email — use a different one (e.g. you+childname@gmail.com)';
  end if;
  if (select count(*) from self_signups where added_by = p_parent and created_at > now() - interval '24 hours')
     >= public.setting_int('child_daily_limit', 6) then
    return 'RATE_LIMIT: that''s the most children you can add today — try again tomorrow';
  end if;
  if (select count(*) from self_signups where created_at > now() - interval '24 hours')
     >= public.setting_int('signup_daily_limit', 30) and not public.can_sponsor(p_parent) then
    return 'RATE_LIMIT: too many sign-ups today — please try again tomorrow';
  end if;
  return null;
end $$;

create or replace function public.record_child_addition(p_parent uuid, p_child uuid, p_email text, p_full_name text,
                                                        p_date_of_birth date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  v := public.validate_child_addition(p_parent, p_email, p_date_of_birth);
  if v is not null then raise exception '%', v; end if;
  if nullif(btrim(p_full_name), '') is null then raise exception 'INVALID: the child''s name is needed'; end if;
  insert into users (id, email, full_name, declared_junior) values (p_child, lower(trim(p_email)), btrim(p_full_name), true)
  on conflict (id) do update set full_name = excluded.full_name, declared_junior = true;
  insert into user_birthdates (user_id, date_of_birth, set_by) values (p_child, p_date_of_birth, p_parent)
  on conflict (user_id) do nothing;
  insert into log_permissions (owner_user_id, grantee_user_id, can_read, can_add, can_edit, is_guardian, status, granted_by)
  values (p_child, p_parent, true, true, true, true, 'active', p_parent);
  insert into self_signups (user_id, kind, added_by) values (p_child, 'child', p_parent);
  return jsonb_build_object('user_id', p_child);
end $$;

do $$
declare f text;
begin
  foreach f in array array['validate_self_signup(text)', 'record_self_signup(uuid, text, text)',
                           'validate_child_addition(uuid, text, date)', 'record_child_addition(uuid, uuid, text, text, date)'] loop
    execute format('revoke execute on function public.%s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function public.%s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke execute on function public.%s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function public.%s to service_role', f); end if;
  end loop;
end $$;
