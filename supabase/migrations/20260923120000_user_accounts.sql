-- ============================================================================
-- SwimZone — User accounts: delegated adding rights + athlete log sharing
-- Migration 20260923120000_user_accounts.sql
--
-- Builds on the existing tables:  users, organisations, memberships
-- Adds:                           system_settings, admin_grants, user_additions,
--                                 log_permissions, performance_results
--
-- Design in one paragraph:
--   Adding rights are GRANTS given to ORGANISATIONS (groups). Active 'admin'
--   members of a group act for it. Grants form a tree (parent_grant_id);
--   a grant only works if it and every grant above it is 'active', so
--   suspending one grant cuts off its whole branch, and restoring it brings
--   the branch back. Removing a PERSON from a group never cascades.
--   Every add is written to user_additions (audit), not onto the athlete, so
--   athletes are independent of the chain. A single daily rate limit per
--   group (system_settings.daily_add_limit, optional per-group override)
--   guards against scripted abuse. Training/performance logs are shared only
--   through log_permissions, which the athlete (or, for an under-18, their
--   guardian) controls. Nobody — root included — bypasses it.
--
-- Error convention: every refusal raises an exception whose message starts
-- with an UPPER_CASE code, e.g. 'NOT_ALLOWED: ...', so the client can map it.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. Extend existing tables
-- ----------------------------------------------------------------------------
alter table public.users          add column if not exists date_of_birth date;

alter table public.organisations  add column if not exists daily_limit_override int
                                    check (daily_limit_override is null or daily_limit_override >= 0);
alter table public.organisations  add column if not exists created_by uuid references public.users(id);
alter table public.organisations  add column if not exists created_at timestamptz not null default now();

-- memberships.status: 'pending' (nominated, not yet accepted), 'active' and
-- 'suspended' already existed; this adds 'removed' (left or taken off).
alter table public.memberships drop constraint if exists memberships_status_check;
alter table public.memberships add constraint memberships_status_check
  check (status = any (array['pending'::text, 'active'::text, 'suspended'::text, 'removed'::text]));

alter table public.memberships    add column if not exists nominated_by uuid references public.users(id);
alter table public.memberships    add column if not exists created_at timestamptz not null default now();
alter table public.memberships    add column if not exists updated_at timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- 1. New tables
-- ----------------------------------------------------------------------------
create table if not exists public.system_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

insert into public.system_settings (key, value, description) values
  ('daily_add_limit', '50'::jsonb,
   'Max athletes added + sub-groups created by one group in any 24 hours. '
   'Raise to 1000000 to effectively switch off; per-group override lives on organisations.daily_limit_override.')
on conflict (key) do nothing;

create table if not exists public.admin_grants (
  id               uuid primary key default gen_random_uuid(),
  org_id  uuid not null unique references public.organisations(id) on delete cascade,
  parent_grant_id  uuid references public.admin_grants(id),          -- null = root
  granted_by       uuid references public.users(id),
  status           text not null default 'active' check (status in ('active','suspended')),
  status_changed_by uuid references public.users(id),
  status_changed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (parent_grant_id is null or parent_grant_id <> id)
);
create index if not exists admin_grants_parent_idx on public.admin_grants(parent_grant_id);

create table if not exists public.user_additions (
  id                   uuid primary key default gen_random_uuid(),
  added_user_id        uuid not null references public.users(id) on delete cascade,
  added_by_user_id     uuid not null references public.users(id),
  via_org_id  uuid not null references public.organisations(id),
  was_new_account      boolean not null default true,
  created_at           timestamptz not null default now()
);
create index if not exists user_additions_org_time_idx on public.user_additions(via_org_id, created_at);

create table if not exists public.log_permissions (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references public.users(id) on delete cascade,  -- the athlete
  grantee_user_id  uuid not null references public.users(id) on delete cascade,
  can_read         boolean not null default true,
  can_add          boolean not null default false,
  can_edit         boolean not null default false,
  is_guardian      boolean not null default false,
  status           text not null default 'active' check (status in ('pending','active','revoked')),
  expires_at       timestamptz,
  granted_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (owner_user_id <> grantee_user_id),
  check (not is_guardian or (can_read and can_add and can_edit))
);
create unique index if not exists log_permissions_live_pair_uq
  on public.log_permissions(owner_user_id, grantee_user_id) where status <> 'revoked';
create index if not exists log_permissions_grantee_idx on public.log_permissions(grantee_user_id) where status = 'active';

create table if not exists public.performance_results (
  id               uuid primary key default gen_random_uuid(),
  athlete_user_id  uuid not null references public.users(id) on delete cascade,
  swum_on          date not null default current_date,
  kind             text not null default 'training' check (kind in ('training','meet','time_trial')),
  stroke           text not null check (stroke in ('FS','BK','BR','Fly','IM','Kick')),
  dist_m           int  not null check (dist_m > 0),
  pool_type        text not null default '25SC' check (pool_type in ('25SC','50LC','25Y')),
  time_sec         numeric(8,2) not null check (time_sec > 0),
  splits           jsonb,          -- e.g. poolside stopwatch export: [{"dist":50,"sec":31.2,"sr":42,"sc":18}, ...]
  location         text,
  notes            text,
  source           text not null default 'manual' check (source in ('manual','stopwatch','import')),
  created_by       uuid references public.users(id),
  updated_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists performance_results_athlete_idx on public.performance_results(athlete_user_id, swum_on desc);

-- ----------------------------------------------------------------------------
-- 2. Helper functions (security definer: they read past RLS, return booleans)
-- ----------------------------------------------------------------------------
create or replace function public.org_grant(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from admin_grants where org_id = p_org;
$$;

-- A grant works only if it and every ancestor is active.
create or replace function public.grant_is_effective(p_grant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive chain as (
    select id, parent_grant_id, status, 1 as depth from admin_grants where id = p_grant
    union all
    select g.id, g.parent_grant_id, g.status, c.depth + 1
      from admin_grants g join chain c on g.id = c.parent_grant_id
     where c.depth < 100
  )
  select exists (select 1 from chain)
     and not exists (select 1 from chain where status <> 'active');
$$;

-- Strict ancestors of a grant (parent, grandparent, ... root).
create or replace function public.grant_ancestors(p_grant uuid) returns table (grant_id uuid, org_id uuid)
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select p.id, p.org_id, p.parent_grant_id, 1 as depth
      from admin_grants g join admin_grants p on p.id = g.parent_grant_id
     where g.id = p_grant
    union all
    select p.id, p.org_id, p.parent_grant_id, u.depth + 1
      from admin_grants p join up u on p.id = u.parent_grant_id
     where u.depth < 100
  )
  select id, org_id from up;
$$;

create or replace function public.is_group_admin(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships
                  where org_id = p_org and user_id = p_user
                    and role = 'admin' and status = 'active');
$$;

-- Can this person act for this group right now? (admin of it + grant chain intact)
create or replace function public.can_act_for_group(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_group_admin(p_org, p_user)
     and coalesce(public.grant_is_effective(public.org_grant(p_org)), false);
$$;

-- Can this person manage (suspend/restore) this grant? Only from ABOVE it.
create or replace function public.can_manage_grant(p_grant uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.grant_ancestors(p_grant) a
                  where public.can_act_for_group(a.org_id, p_user));
$$;

-- Can this person manage a group's members? Its own admins, or anyone above it.
create or replace function public.can_manage_group(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_act_for_group(p_org, p_user)
      or coalesce(public.can_manage_grant(public.org_grant(p_org), p_user), false);
$$;

create or replace function public.can_add_users(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m
                  where m.user_id = p_user and m.role = 'admin' and m.status = 'active'
                    and public.can_act_for_group(m.org_id, p_user));
$$;

create or replace function public.is_root(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_grants g
                  where g.parent_grant_id is null and g.status = 'active'
                    and public.is_group_admin(g.org_id, p_user));
$$;

create or replace function public.is_adult(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select date_of_birth <= (current_date - interval '18 years')::date
                     from users where id = p_user), false);
$$;

create or replace function public.is_junior(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select date_of_birth > (current_date - interval '18 years')::date
                     from users where id = p_user), false);
$$;

create or replace function public.find_user_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from users where lower(email) = lower(trim(p_email)) limit 1;
$$;

-- ---- rate limit -------------------------------------------------------------
create or replace function public.group_daily_limit(p_org uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select daily_limit_override from organisations where id = p_org),
    (select (value #>> '{}')::int from system_settings where key = 'daily_add_limit'),
    50);
$$;

create or replace function public.group_actions_last_24h(p_org uuid) returns int
language sql stable security definer set search_path = public as $$
  select (select count(*) from user_additions
           where via_org_id = p_org and created_at > now() - interval '24 hours')::int
       + (select count(*) from admin_grants
           where parent_grant_id = public.org_grant(p_org) and created_at > now() - interval '24 hours')::int;
$$;

create or replace function public.assert_within_rate_limit(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.group_actions_last_24h(p_org) >= public.group_daily_limit(p_org) then
    raise exception 'RATE_LIMIT: this group has reached its limit of % adds in 24 hours',
      public.group_daily_limit(p_org);
  end if;
end $$;

-- ---- log access -------------------------------------------------------------
create or replace function public.has_log_access(p_owner uuid, p_action text, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from log_permissions lp
     where lp.owner_user_id = p_owner and lp.grantee_user_id = p_user
       and lp.status = 'active'
       and (lp.expires_at is null or lp.expires_at > now())
       and case p_action
             when 'read' then lp.can_read
             when 'add'  then lp.can_add
             when 'edit' then lp.can_edit
             else false end);
$$;

create or replace function public.is_active_guardian(p_owner uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from log_permissions
                  where owner_user_id = p_owner and grantee_user_id = p_user
                    and is_guardian and status = 'active');
$$;

-- Adults manage their own sharing; an under-18's sharing is managed by their guardian(s).
create or replace function public.can_manage_log_sharing(p_owner uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select (p_owner = p_user and not public.is_junior(p_owner))
      or public.is_active_guardian(p_owner, p_user);
$$;

-- ----------------------------------------------------------------------------
-- 3. Triggers
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_admin_grants_updated     on public.admin_grants;
create trigger trg_admin_grants_updated     before update on public.admin_grants     for each row execute function public.set_updated_at();
drop trigger if exists trg_log_permissions_updated  on public.log_permissions;
create trigger trg_log_permissions_updated  before update on public.log_permissions  for each row execute function public.set_updated_at();
drop trigger if exists trg_memberships_updated      on public.memberships;
create trigger trg_memberships_updated      before update on public.memberships      for each row execute function public.set_updated_at();

-- An under-18 can never lose their last ACTIVE guardian.
create or replace function public.guard_last_guardian() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_losing boolean;
begin
  if tg_op = 'DELETE' then
    v_losing := old.is_guardian and old.status = 'active';
  else
    v_losing := old.is_guardian and old.status = 'active'
                and (new.status <> 'active' or not new.is_guardian);
  end if;

  if v_losing and public.is_junior(old.owner_user_id)
     and not exists (select 1 from log_permissions
                      where owner_user_id = old.owner_user_id and id <> old.id
                        and is_guardian and status = 'active') then
    raise exception 'LAST_GUARDIAN: an under-18 athlete must keep at least one guardian — add another guardian first';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_guard_last_guardian on public.log_permissions;
create trigger trg_guard_last_guardian before update or delete on public.log_permissions
  for each row execute function public.guard_last_guardian();

-- Results: stamp who created/changed each row; a result can't be moved to another athlete.
create or replace function public.stamp_result() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.updated_by := new.created_by;
  else
    if new.athlete_user_id <> old.athlete_user_id then
      raise exception 'NOT_ALLOWED: a result cannot be moved to another athlete';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_result on public.performance_results;
create trigger trg_stamp_result before insert or update on public.performance_results
  for each row execute function public.stamp_result();

-- ----------------------------------------------------------------------------
-- 4. RPCs the app calls (as the signed-in user)
-- ----------------------------------------------------------------------------

-- Create a group below one you administer. Optionally nominate its first admin
-- (an existing user, by email) — they must accept before they can act.
create or replace function public.create_subgroup(
  p_parent_org uuid, p_name text, p_org_type text default 'club', p_admin_email text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_admin uuid;
begin
  if not public.can_act_for_group(p_parent_org, v_uid) then
    raise exception 'NOT_ALLOWED: you are not an active admin of that group';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'INVALID: group name is required';
  end if;
  perform public.assert_within_rate_limit(p_parent_org);

  if p_admin_email is not null then
    v_admin := public.find_user_by_email(p_admin_email);
    if v_admin is null then
      raise exception 'USER_NOT_FOUND: no SwimZone account for %', p_admin_email;
    end if;
  end if;

  insert into organisations (name, org_type, created_by)
  values (trim(p_name), coalesce(p_org_type, 'club'), v_uid)
  returning id into v_org;

  insert into admin_grants (org_id, parent_grant_id, granted_by)
  values (v_org, public.org_grant(p_parent_org), v_uid);

  if v_admin is not null then
    insert into memberships (user_id, org_id, role, status, nominated_by)
    values (v_admin, v_org, 'admin', 'pending', v_uid);
  end if;

  return v_org;
end $$;

-- Nominate an extra (or replacement) admin for a group you manage.
create or replace function public.nominate_group_admin(p_org uuid, p_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_user uuid;
  v_id uuid;
begin
  if not public.can_manage_group(p_org, v_uid) then
    raise exception 'NOT_ALLOWED: you cannot manage that group';
  end if;
  v_user := public.find_user_by_email(p_email);
  if v_user is null then
    raise exception 'USER_NOT_FOUND: no SwimZone account for %', p_email;
  end if;

  select id into v_id from memberships
   where org_id = p_org and user_id = v_user and role = 'admin' and status in ('active','pending');
  if v_id is not null then return v_id; end if;

  insert into memberships (user_id, org_id, role, status, nominated_by)
  values (v_user, p_org, 'admin', 'pending', v_uid)
  returning id into v_id;
  return v_id;
end $$;

-- Accept or decline a pending membership addressed to me.
create or replace function public.respond_to_membership(p_membership_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update memberships
     set status = case when p_accept then 'active' else 'removed' end
   where id = p_membership_id and user_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'NOT_FOUND: no pending membership of yours with that id';
  end if;
end $$;

-- Take someone out of a group (group's own admins or anyone above), or leave
-- a group yourself. Never cascades: the group's grant is untouched.
create or replace function public.remove_membership(p_membership_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_m memberships%rowtype;
begin
  select * into v_m from memberships where id = p_membership_id;
  if not found then raise exception 'NOT_FOUND: membership not found'; end if;

  if v_m.user_id <> auth.uid() and not public.can_manage_group(v_m.org_id) then
    raise exception 'NOT_ALLOWED: you cannot manage that group';
  end if;

  update memberships set status = 'removed' where id = p_membership_id;
end $$;

-- Suspend or restore a group's grant (cascades to the whole branch below).
create or replace function public.set_grant_status(p_grant_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('active','suspended') then
    raise exception 'INVALID: status must be active or suspended';
  end if;
  if not public.can_manage_grant(p_grant_id) then
    raise exception 'NOT_ALLOWED: only a group above this one can suspend or restore it';
  end if;
  update admin_grants
     set status = p_status, status_changed_by = auth.uid(), status_changed_at = now()
   where id = p_grant_id;
end $$;

-- Root only: per-group override of the daily limit (null = use the system setting).
create or replace function public.set_group_daily_limit(p_org uuid, p_limit int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_root() then raise exception 'NOT_ALLOWED: root only'; end if;
  update organisations set daily_limit_override = p_limit where id = p_org;
end $$;

-- Root only: change the system-wide daily limit.
create or replace function public.set_daily_add_limit(p_limit int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_root() then raise exception 'NOT_ALLOWED: root only'; end if;
  update system_settings set value = to_jsonb(p_limit), updated_at = now() where key = 'daily_add_limit';
end $$;

-- ---- log sharing ------------------------------------------------------------

-- Share an athlete's log with someone (by email). Add/edit imply read.
create or replace function public.share_log(
  p_owner uuid, p_grantee_email text,
  p_can_read boolean default true, p_can_add boolean default false, p_can_edit boolean default false,
  p_expires_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_grantee uuid;
  v_row log_permissions%rowtype;
  v_read boolean := p_can_read or p_can_add or p_can_edit;
begin
  if not public.can_manage_log_sharing(p_owner, v_uid) then
    raise exception 'NOT_ALLOWED: only the athlete (or their guardian if under 18) can share this log';
  end if;
  v_grantee := public.find_user_by_email(p_grantee_email);
  if v_grantee is null then
    raise exception 'USER_NOT_FOUND: no SwimZone account for %', p_grantee_email;
  end if;
  if v_grantee = p_owner then
    raise exception 'INVALID: the athlete already has full access to their own log';
  end if;
  if not v_read then
    raise exception 'INVALID: choose at least one of read, add or edit';
  end if;

  select * into v_row from log_permissions
   where owner_user_id = p_owner and grantee_user_id = v_grantee and status <> 'revoked';

  if found then
    if v_row.is_guardian then
      raise exception 'ALREADY_GUARDIAN: that person is a guardian and already has full access';
    end if;
    update log_permissions
       set can_read = v_read, can_add = p_can_add, can_edit = p_can_edit,
           expires_at = p_expires_at, status = 'active', granted_by = v_uid
     where id = v_row.id;
    return v_row.id;
  end if;

  insert into log_permissions (owner_user_id, grantee_user_id, can_read, can_add, can_edit,
                               expires_at, status, granted_by)
  values (p_owner, v_grantee, v_read, p_can_add, p_can_edit, p_expires_at, 'active', v_uid)
  returning id into v_row.id;
  return v_row.id;
end $$;

-- Revoke a permission. The athlete/guardian can revoke anyone; anyone can give
-- up their own access. The last active guardian of an under-18 is protected.
create or replace function public.revoke_log_permission(p_permission_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row log_permissions%rowtype;
begin
  select * into v_row from log_permissions where id = p_permission_id;
  if not found then raise exception 'NOT_FOUND: permission not found'; end if;
  if v_row.grantee_user_id <> auth.uid()
     and not public.can_manage_log_sharing(v_row.owner_user_id) then
    raise exception 'NOT_ALLOWED: you cannot change sharing on this log';
  end if;
  update log_permissions set status = 'revoked' where id = p_permission_id;
end $$;

-- Nominate an adult athlete as guardian of an under-18. Allowed for an existing
-- guardian, or an admin of a group the junior belongs to. Starts 'pending'.
create or replace function public.nominate_guardian(p_junior uuid, p_guardian_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_guardian uuid;
  v_row log_permissions%rowtype;
begin
  if not public.is_junior(p_junior) then
    raise exception 'INVALID: guardians are only for athletes under 18';
  end if;
  if not public.is_active_guardian(p_junior, v_uid)
     and not exists (select 1 from memberships m
                      where m.user_id = p_junior and m.status = 'active'
                        and public.can_act_for_group(m.org_id, v_uid)) then
    raise exception 'NOT_ALLOWED: only a guardian or an admin of the athlete''s group can nominate a guardian';
  end if;

  v_guardian := public.find_user_by_email(p_guardian_email);
  if v_guardian is null then
    raise exception 'USER_NOT_FOUND: no SwimZone account for %', p_guardian_email;
  end if;
  if not public.is_adult(v_guardian) then
    raise exception 'GUARDIAN_NOT_ADULT: % must be an athlete aged 18 or over (date of birth set)', p_guardian_email;
  end if;

  select * into v_row from log_permissions
   where owner_user_id = p_junior and grantee_user_id = v_guardian and status <> 'revoked';
  if found then
    if v_row.is_guardian then return v_row.id; end if;
    update log_permissions
       set is_guardian = true, can_read = true, can_add = true, can_edit = true,
           status = 'pending', expires_at = null, granted_by = v_uid
     where id = v_row.id;
    return v_row.id;
  end if;

  insert into log_permissions (owner_user_id, grantee_user_id, can_read, can_add, can_edit,
                               is_guardian, status, granted_by)
  values (p_junior, v_guardian, true, true, true, true, 'pending', v_uid)
  returning id into v_row.id;
  return v_row.id;
end $$;

-- The nominated guardian accepts or declines.
create or replace function public.respond_to_guardianship(p_permission_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update log_permissions
     set status = case when p_accept then 'active' else 'revoked' end
   where id = p_permission_id and grantee_user_id = auth.uid()
     and is_guardian and status = 'pending';
  if not found then
    raise exception 'NOT_FOUND: no pending guardianship of yours with that id';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Service-role-only functions (called by the add-athlete Edge Function,
--    which verifies the caller's JWT and passes their id as p_actor)
-- ----------------------------------------------------------------------------

-- Returns null if the add is allowed, otherwise an error string. No writes.
create or replace function public.validate_athlete_addition(
  p_actor uuid, p_org uuid, p_date_of_birth date, p_guardian_emails text[],
  p_existing_user uuid default null)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_email text;
  v_g uuid;
  v_junior boolean;
begin
  if not public.can_act_for_group(p_org, p_actor) then
    return 'NOT_ALLOWED: you are not an active admin of that group, or its rights are suspended';
  end if;
  if public.group_actions_last_24h(p_org) >= public.group_daily_limit(p_org) then
    return format('RATE_LIMIT: this group has reached its limit of %s adds in 24 hours',
                  public.group_daily_limit(p_org));
  end if;

  if p_existing_user is not null then
    v_junior := public.is_junior(p_existing_user);
  else
    if p_date_of_birth is null then
      return 'INVALID: date of birth is required for a new athlete';
    end if;
    v_junior := p_date_of_birth > (current_date - interval '18 years')::date;
  end if;

  if v_junior then
    -- An existing junior who already has a guardian doesn't need another.
    if p_existing_user is not null and exists (
         select 1 from log_permissions where owner_user_id = p_existing_user
            and is_guardian and status in ('pending','active')) then
      null;
    elsif coalesce(array_length(p_guardian_emails, 1), 0) = 0 then
      return 'GUARDIAN_REQUIRED: an under-18 athlete needs at least one adult athlete as guardian';
    end if;
  end if;

  foreach v_email in array coalesce(p_guardian_emails, '{}') loop
    v_g := public.find_user_by_email(v_email);
    if v_g is null then
      return format('USER_NOT_FOUND: no SwimZone account for %s — add them as an adult athlete first', v_email);
    end if;
    if not public.is_adult(v_g) then
      return format('GUARDIAN_NOT_ADULT: %s must be an athlete aged 18 or over (date of birth set)', v_email);
    end if;
  end loop;

  return null;
end $$;

-- Writes everything for one add in a single transaction.
create or replace function public.record_athlete_addition(
  p_actor uuid, p_org uuid, p_user_id uuid, p_email text, p_full_name text,
  p_date_of_birth date, p_guardian_emails text[], p_new_account boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_err text;
  v_email text;
  v_g uuid;
  v_guardian_ids uuid[] := '{}';
begin
  v_err := public.validate_athlete_addition(p_actor, p_org, p_date_of_birth, p_guardian_emails,
                                            case when p_new_account then null else p_user_id end);
  if v_err is not null then raise exception '%', v_err; end if;

  if p_new_account then
    insert into users (id, email, full_name, date_of_birth)
    values (p_user_id, lower(trim(p_email)), p_full_name, p_date_of_birth)
    on conflict (id) do update
      set full_name     = coalesce(excluded.full_name, users.full_name),
          date_of_birth = coalesce(users.date_of_birth, excluded.date_of_birth);
  end if;

  if not exists (select 1 from memberships
                  where user_id = p_user_id and org_id = p_org
                    and role = 'athlete' and status = 'active') then
    insert into memberships (user_id, org_id, role, status, nominated_by)
    values (p_user_id, p_org, 'athlete', 'active', p_actor);
  end if;

  insert into user_additions (added_user_id, added_by_user_id, via_org_id, was_new_account)
  values (p_user_id, p_actor, p_org, p_new_account);

  foreach v_email in array coalesce(p_guardian_emails, '{}') loop
    v_g := public.find_user_by_email(v_email);
    if v_g <> p_user_id and not exists (
         select 1 from log_permissions
          where owner_user_id = p_user_id and grantee_user_id = v_g and status <> 'revoked') then
      insert into log_permissions (owner_user_id, grantee_user_id, can_read, can_add, can_edit,
                                   is_guardian, status, granted_by)
      values (p_user_id, v_g, true, true, true, true, 'pending', p_actor);
      v_guardian_ids := v_guardian_ids || v_g;
    end if;
  end loop;

  return jsonb_build_object('user_id', p_user_id, 'pending_guardians', to_jsonb(v_guardian_ids));
end $$;

-- ----------------------------------------------------------------------------
-- 6. Function privileges
-- ----------------------------------------------------------------------------
revoke execute on function public.validate_athlete_addition(uuid, uuid, date, text[], uuid) from public;
revoke execute on function public.record_athlete_addition(uuid, uuid, uuid, text, text, date, text[], boolean) from public;
revoke execute on function public.find_user_by_email(text) from public;
revoke execute on function public.assert_within_rate_limit(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.validate_athlete_addition(uuid, uuid, date, text[], uuid) to service_role;
    grant execute on function public.record_athlete_addition(uuid, uuid, uuid, text, text, date, text[], boolean) to service_role;
    grant execute on function public.find_user_by_email(text) to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.validate_athlete_addition(uuid, uuid, date, text[], uuid) from anon;
    revoke execute on function public.record_athlete_addition(uuid, uuid, uuid, text, text, date, text[], boolean) from anon;
    revoke execute on function public.find_user_by_email(text) from anon;
    revoke execute on function public.assert_within_rate_limit(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.validate_athlete_addition(uuid, uuid, date, text[], uuid) from authenticated;
    revoke execute on function public.record_athlete_addition(uuid, uuid, uuid, text, text, date, text[], boolean) from authenticated;
    revoke execute on function public.find_user_by_email(text) from authenticated;
    revoke execute on function public.assert_within_rate_limit(uuid) from authenticated;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 7. Row Level Security
--    New tables: reads via policies below; ALL writes go through the RPCs above
--    (no insert/update/delete policies), except performance_results.
--    Existing tables: policies are added alongside any you already have.
-- ----------------------------------------------------------------------------
alter table public.system_settings     enable row level security;
alter table public.admin_grants        enable row level security;
alter table public.user_additions      enable row level security;
alter table public.log_permissions     enable row level security;
alter table public.performance_results enable row level security;
alter table public.users               enable row level security;
alter table public.organisations       enable row level security;
alter table public.memberships         enable row level security;

-- system_settings
drop policy if exists sz_settings_read on public.system_settings;
create policy sz_settings_read on public.system_settings for select to authenticated using (true);

-- admin_grants: your own groups' grants and everything below them
drop policy if exists sz_grants_read on public.admin_grants;
create policy sz_grants_read on public.admin_grants for select to authenticated
  using (public.is_group_admin(org_id) or public.can_manage_grant(id));

-- user_additions: who you added, and adds made by groups you manage
drop policy if exists sz_additions_read on public.user_additions;
create policy sz_additions_read on public.user_additions for select to authenticated
  using (added_by_user_id = auth.uid() or public.can_manage_group(via_org_id));

-- log_permissions: owner, grantee, and whoever manages the owner's sharing
drop policy if exists sz_logperm_read on public.log_permissions;
create policy sz_logperm_read on public.log_permissions for select to authenticated
  using (owner_user_id = auth.uid() or grantee_user_id = auth.uid()
         or public.can_manage_log_sharing(owner_user_id));

-- performance_results: owner, or anyone the owner (guardian) has granted access
drop policy if exists sz_results_read on public.performance_results;
create policy sz_results_read on public.performance_results for select to authenticated
  using (athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'read'));

drop policy if exists sz_results_insert on public.performance_results;
create policy sz_results_insert on public.performance_results for insert to authenticated
  with check (athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'add'));

drop policy if exists sz_results_update on public.performance_results;
create policy sz_results_update on public.performance_results for update to authenticated
  using      (athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'edit'))
  with check (athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'edit'));

drop policy if exists sz_results_delete on public.performance_results;
create policy sz_results_delete on public.performance_results for delete to authenticated
  using (athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'edit'));

-- users: yourself; people you share logs with either way; members of groups you manage
drop policy if exists sz_users_self on public.users;
create policy sz_users_self on public.users for select to authenticated using (id = auth.uid());
drop policy if exists sz_users_self_insert on public.users;
create policy sz_users_self_insert on public.users for insert to authenticated with check (id = auth.uid());
drop policy if exists sz_users_self_update on public.users;
create policy sz_users_self_update on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists sz_users_related on public.users;
create policy sz_users_related on public.users for select to authenticated
  using (exists (select 1 from public.log_permissions lp
                  where lp.status <> 'revoked'
                    and ((lp.owner_user_id = users.id and lp.grantee_user_id = auth.uid())
                      or (lp.grantee_user_id = users.id and lp.owner_user_id = auth.uid())))
      or exists (select 1 from public.memberships m
                  where m.user_id = users.id and m.status <> 'removed'
                    and public.can_manage_group(m.org_id)));

-- organisations: groups you belong to (incl. pending) and groups you manage
drop policy if exists sz_orgs_read on public.organisations;
create policy sz_orgs_read on public.organisations for select to authenticated
  using (exists (select 1 from public.memberships m
                  where m.org_id = organisations.id and m.user_id = auth.uid()
                    and m.status in ('active','pending'))
      or public.can_manage_group(id));

-- memberships: your own, and all memberships of groups you manage
drop policy if exists sz_memberships_read on public.memberships;
create policy sz_memberships_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.can_manage_group(org_id));

-- Stop users editing their own date of birth once set (it drives guardian rules).
create or replace function public.lock_date_of_birth() returns trigger
language plpgsql as $$
begin
  if old.date_of_birth is not null and new.date_of_birth is distinct from old.date_of_birth
     and auth.uid() is not null and not public.is_root() then
    raise exception 'NOT_ALLOWED: date of birth can only be corrected by an administrator';
  end if;
  return new;
end $$;
drop trigger if exists trg_lock_dob on public.users;
create trigger trg_lock_dob before update on public.users for each row execute function public.lock_date_of_birth();

commit;
