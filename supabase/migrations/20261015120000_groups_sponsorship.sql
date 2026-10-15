-- ============================================================================
-- SwimZone — Groups & Sponsorship
-- Migration 20261015120000_groups_sponsorship.sql          Owner: Accounts
--
-- Design: claude-docs/teams/ACCOUNTS-GROUPS-PLAN.md · DECISIONS 2026-10-15.
--
--   SPONSORSHIP  The old "adding-rights" grant tree, renamed (admin_grants →
--                sponsorships). It now only governs bringing NEW people into
--                SwimZone (the add-athlete Edge Function) and sponsoring
--                other groups. Suspending still cascades down the branch.
--   GROUPS       Anyone signed in can create a group (rate-limited). Joining
--                is opt-in, through an invite link/code made by someone who
--                manages the group. Never by typed email.
--   ROLES        A catalogue (group_roles) gives each role default
--                capabilities: manage_members, read_results, add_results,
--                is_staff. Every check asks about a capability, never a role
--                name. A manager can override read/add/manage per person.
--   VISIBILITY   Group ticks (show_*) AND the member's own ticks (share_*).
--                Tightening applies at once; loosening only for members who
--                accept. Under-18s never show full name/email to non-staff.
--   ACCESS       has_log_access(owner, op, user), signature unchanged:
--                guardian, or a group capability over a member, or a sharing
--                group with results on for both. Personal shares are retired.
--   LOG          Membership and settings changes write group_events, which
--                every member (and members' guardians) can read.
--
-- Also rewrites two Tests helpers (can_see_protocol_org, can_edit_protocol_org)
-- that called the old grant-tree functions.
--
-- Error convention unchanged: 'CODE: message'.
-- Idempotent: safe to run twice.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. Drop everything that depends on the functions being replaced
-- ----------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.admin_grants') is not null then
    drop policy if exists sz_grants_read on public.admin_grants;
    drop trigger if exists trg_admin_grants_updated on public.admin_grants;
  end if;
end $$;
drop policy if exists sz_additions_read            on public.user_additions;
drop policy if exists sz_users_related             on public.users;
drop policy if exists sz_orgs_read                 on public.organisations;
drop policy if exists sz_memberships_read          on public.memberships;
drop policy if exists "memberships: org staff read" on public.memberships;

drop function if exists public.create_subgroup(uuid, text, text, text);
drop function if exists public.nominate_group_admin(uuid, text);
drop function if exists public.respond_to_membership(uuid, boolean);
drop function if exists public.set_grant_status(uuid, text);
drop function if exists public.share_log(uuid, text, boolean, boolean, boolean, timestamptz);
drop function if exists public.can_add_users(uuid);
drop function if exists public.can_manage_grant(uuid, uuid);
drop function if exists public.can_act_for_group(uuid, uuid);
drop function if exists public.is_group_admin(uuid, uuid);
drop function if exists public.is_org_staff(uuid, uuid);
drop function if exists public.grant_ancestors(uuid);
drop function if exists public.grant_is_effective(uuid);
drop function if exists public.org_grant(uuid);

-- ----------------------------------------------------------------------------
-- 1. Sponsorship (rename of admin_grants)
-- ----------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.admin_grants') is not null and to_regclass('public.sponsorships') is null then
    alter table public.admin_grants rename to sponsorships;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name = 'sponsorships' and column_name = 'parent_grant_id') then
    alter table public.sponsorships rename column parent_grant_id to parent_sponsorship_id;
  end if;
  if to_regclass('public.admin_grants_parent_idx') is not null then
    alter index public.admin_grants_parent_idx rename to sponsorships_parent_idx;
  end if;
end $$;

drop trigger if exists trg_sponsorships_updated on public.sponsorships;
create trigger trg_sponsorships_updated before update on public.sponsorships
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Role catalogue
-- ----------------------------------------------------------------------------
create table if not exists public.group_roles (
  key            text primary key,
  label          text not null,
  org_id         uuid references public.organisations(id) on delete cascade,  -- null = system-wide (per-group roles later)
  manage_members boolean not null default false,
  read_results   boolean not null default false,
  add_results    boolean not null default false,
  is_staff       boolean not null default false,
  sort           int     not null default 100,
  retired        boolean not null default false
);

insert into public.group_roles (key, label, manage_members, read_results, add_results, is_staff, sort) values
  ('team_manager',       'Team Manager',       true,  false, false, true,  10),
  ('coach',              'Coach',              false, true,  true,  true,  20),
  ('assistant_coach',    'Assistant Coach',    false, true,  true,  true,  30),
  ('poolside_assistant', 'Poolside Assistant', false, false, true,  true,  40),
  ('member',             'Member',             false, false, false, false, 90)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Groups: organisations + memberships
-- ----------------------------------------------------------------------------
alter table public.organisations add column if not exists parent_org_id        uuid references public.organisations(id) on delete cascade;
alter table public.organisations add column if not exists group_type           text;
alter table public.organisations add column if not exists description          text;
alter table public.organisations add column if not exists show_public_name     boolean not null default true;
alter table public.organisations add column if not exists show_full_name       boolean not null default false;
alter table public.organisations add column if not exists show_email           boolean not null default false;
alter table public.organisations add column if not exists members_see_results  boolean not null default false;
update public.organisations set group_type = case when org_type = 'root' then 'root' else 'coaching' end
 where group_type is null;
alter table public.organisations alter column group_type set default 'coaching';
alter table public.organisations alter column group_type set not null;
alter table public.organisations drop constraint if exists organisations_group_type_check;
alter table public.organisations add  constraint organisations_group_type_check
  check (group_type in ('root','coaching','sharing','family'));
-- org_type stays as a descriptive label (club, school, county, …)
alter table public.organisations drop constraint if exists organisations_org_type_check;
alter table public.organisations add  constraint organisations_org_type_check
  check (org_type in ('root','club','governing_body','county','school','squad','family','private','other'));
alter table public.organisations drop constraint if exists organisations_parent_not_self;
alter table public.organisations add  constraint organisations_parent_not_self check (parent_org_id is distinct from id);
create index if not exists organisations_parent_idx on public.organisations(parent_org_id);

-- Roles: old fixed list → catalogue keys.
alter table public.memberships drop constraint if exists memberships_role_check;
delete from public.memberships m                         -- a person who was both admin and manager keeps one row
 where m.role = 'manager'
   and exists (select 1 from public.memberships a where a.user_id = m.user_id and a.org_id = m.org_id and a.role = 'admin');
delete from public.memberships where role = 'guardian';  -- unused: guardianship lives in log_permissions
update public.memberships set role = 'team_manager' where role in ('admin','manager');
update public.memberships set role = 'member'       where role = 'athlete';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_role_fkey') then
    alter table public.memberships add constraint memberships_role_fkey
      foreign key (role) references public.group_roles(key);
  end if;
end $$;

-- 'pending' = waiting for a manager to approve; 'awaiting_guardian' = an under-18 waiting for a guardian.
alter table public.memberships drop constraint if exists memberships_status_check;
alter table public.memberships add  constraint memberships_status_check
  check (status in ('pending','awaiting_guardian','active','suspended','removed'));

-- Per-person capability overrides (null = the role's default)
alter table public.memberships add column if not exists manage_members      boolean;
alter table public.memberships add column if not exists read_results        boolean;
alter table public.memberships add column if not exists add_results         boolean;
-- The member's own visibility ticks (shown = group tick AND these)
alter table public.memberships add column if not exists share_public_name   boolean not null default true;
alter table public.memberships add column if not exists share_full_name     boolean not null default false;
alter table public.memberships add column if not exists share_email         boolean not null default false;
alter table public.memberships add column if not exists share_results       boolean not null default false;
alter table public.memberships add column if not exists needs_approval      boolean not null default false;
alter table public.memberships add column if not exists guardian_approved_by uuid references public.users(id);
alter table public.memberships add column if not exists invite_id           uuid;

-- ----------------------------------------------------------------------------
-- 4. New tables: invites, events, qualifications
-- ----------------------------------------------------------------------------
create table if not exists public.group_invites (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations(id) on delete cascade,
  code           text not null unique,
  role           text not null default 'member' references public.group_roles(key),
  needs_approval boolean not null default false,
  max_uses       int check (max_uses is null or max_uses > 0),
  uses           int not null default 0,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  created_by     uuid references public.users(id),
  created_at     timestamptz not null default now()
);
create index if not exists group_invites_org_idx on public.group_invites(org_id);

create table if not exists public.group_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organisations(id) on delete cascade,
  actor_user_id   uuid references public.users(id) on delete set null,
  subject_user_id uuid references public.users(id) on delete set null,
  event           text not null check (event in ('created','joined','left','removed','role_added',
                                                 'capability_changed','settings_changed','sponsored')),
  detail          jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists group_events_org_time_idx on public.group_events(org_id, created_at desc);

create table if not exists public.staff_qualifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  issuer      text,
  ref         text,
  expires_on  date,
  verified_by uuid references public.users(id),
  verified_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists staff_qualifications_user_idx on public.staff_qualifications(user_id);

-- Limits for group creation (rolling, per person; sub-groups count)
insert into public.system_settings (key, value, description) values
  ('group_create_daily_limit', '10'::jsonb, 'Max groups one person can create in any 24 hours.'),
  ('group_create_30day_limit', '30'::jsonb, 'Max groups one person can create in any 30 days.')
on conflict (key) do nothing;
update public.system_settings
   set description = 'Max new people sponsored + groups sponsored by one group in any 24 hours. '
                     'Per-group override lives on organisations.daily_limit_override.'
 where key = 'daily_add_limit';

-- Personal shares are retired (groups replace them). Guardianships stay.
update public.log_permissions set status = 'revoked' where not is_guardian and status <> 'revoked';

-- ----------------------------------------------------------------------------
-- 5. Helpers (SECURITY DEFINER; RLS policies call these, never the tables)
-- ----------------------------------------------------------------------------

-- Effective capability of one membership row.
create or replace function public.membership_can(p_membership uuid, p_cap text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_cap
             when 'manage_members' then coalesce(m.manage_members, r.manage_members)
             when 'read_results'   then coalesce(m.read_results,   r.read_results)
             when 'add_results'    then coalesce(m.add_results,    r.add_results)
             when 'staff'          then r.is_staff
             else false end
      from memberships m join group_roles r on r.key = m.role
     where m.id = p_membership), false);
$$;

create or replace function public.has_group_capability(p_org uuid, p_cap text, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m
                  where m.org_id = p_org and m.user_id = p_user and m.status = 'active'
                    and public.membership_can(m.id, p_cap));
$$;

create or replace function public.is_group_staff(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_group_capability(p_org, 'staff', p_user);
$$;

-- Holds an active staff role in any group.
create or replace function public.is_staff_anywhere(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m join group_roles r on r.key = m.role
                  where m.user_id = p_user and m.status = 'active' and r.is_staff);
$$;

-- In the group in any live state (used for "can see the group exists").
create or replace function public.is_member_of(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships
                  where org_id = p_org and user_id = p_user
                    and status in ('active','pending','awaiting_guardian'));
$$;

-- An active, non-staff ("athlete-side") member: whose results the group's staff work with.
create or replace function public.is_group_athlete(p_org uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m join group_roles r on r.key = m.role
                  where m.org_id = p_org and m.user_id = p_user and m.status = 'active'
                    and not r.is_staff);
$$;

-- The group and every group above it (parent_org_id chain), nearest first.
create or replace function public.org_ancestors_and_self(p_org uuid) returns table (org_id uuid, depth int)
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, parent_org_id, 0 as depth from organisations where id = p_org
    union all
    select o.id, o.parent_org_id, u.depth + 1
      from organisations o join up u on o.id = u.parent_org_id
     where u.depth < 50
  )
  select id, depth from up;
$$;

-- Manage a group's membership: manage_members here or in any group above it.
create or replace function public.can_manage_group(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_ancestors_and_self(p_org) a
                  where public.has_group_capability(a.org_id, 'manage_members', p_user));
$$;

-- Can see the group: in it, manages it, or is guardian of someone in it.
create or replace function public.can_see_group(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member_of(p_org, p_user)
      or public.can_manage_group(p_org, p_user)
      or exists (select 1 from memberships m
                  where m.org_id = p_org and m.status in ('active','pending','awaiting_guardian')
                    and public.is_active_guardian(m.user_id, p_user));
$$;

-- ---- sponsorship ------------------------------------------------------------
create or replace function public.org_sponsorship(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from sponsorships where org_id = p_org;
$$;

-- Works only if it and every sponsorship above it is active.
create or replace function public.sponsorship_is_effective(p_sponsorship uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive chain as (
    select id, parent_sponsorship_id, status, 1 as depth from sponsorships where id = p_sponsorship
    union all
    select s.id, s.parent_sponsorship_id, s.status, c.depth + 1
      from sponsorships s join chain c on s.id = c.parent_sponsorship_id
     where c.depth < 100
  )
  select exists (select 1 from chain)
     and not exists (select 1 from chain where status <> 'active');
$$;

-- Strict ancestors of a sponsorship (parent … root).
create or replace function public.sponsorship_ancestors(p_sponsorship uuid)
returns table (sponsorship_id uuid, org_id uuid)
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select p.id, p.org_id, p.parent_sponsorship_id, 1 as depth
      from sponsorships s join sponsorships p on p.id = s.parent_sponsorship_id
     where s.id = p_sponsorship
    union all
    select p.id, p.org_id, p.parent_sponsorship_id, u.depth + 1
      from sponsorships p join up u on p.id = u.parent_sponsorship_id
     where u.depth < 100
  )
  select id, org_id from up;
$$;

-- Can this person use this group's sponsorship right now?
create or replace function public.can_sponsor_via(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_group_capability(p_org, 'manage_members', p_user)
     and coalesce(public.sponsorship_is_effective(public.org_sponsorship(p_org)), false);
$$;

create or replace function public.can_sponsor(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sponsorships s where public.can_sponsor_via(s.org_id, p_user));
$$;

-- Suspend/restore a sponsorship: only from a group ABOVE it.
create or replace function public.can_manage_sponsorship(p_sponsorship uuid, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sponsorship_ancestors(p_sponsorship) a
                  where public.can_sponsor_via(a.org_id, p_user));
$$;

create or replace function public.is_root(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sponsorships s
                  where s.parent_sponsorship_id is null and s.status = 'active'
                    and public.has_group_capability(s.org_id, 'manage_members', p_user));
$$;

-- Rate limit for sponsorship use: new people + groups sponsored, last 24 h.
create or replace function public.group_actions_last_24h(p_org uuid) returns int
language sql stable security definer set search_path = public as $$
  select (select count(*) from user_additions
           where via_org_id = p_org and created_at > now() - interval '24 hours')::int
       + (select count(*) from sponsorships
           where parent_sponsorship_id = public.org_sponsorship(p_org)
             and created_at > now() - interval '24 hours')::int;
$$;

create or replace function public.setting_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from system_settings where key = p_key), p_default);
$$;

-- ---- results access (signature unchanged; Times/Tests/Metrics depend on it) --
create or replace function public.has_log_access(p_owner uuid, p_action text, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public as $$
  select
    -- 1. guardian
    exists (select 1 from log_permissions lp
             where lp.owner_user_id = p_owner and lp.grantee_user_id = p_user
               and lp.is_guardian and lp.status = 'active'
               and (lp.expires_at is null or lp.expires_at > now())
               and case p_action when 'read' then lp.can_read
                                 when 'add'  then lp.can_add
                                 when 'edit' then lp.can_edit else false end)
    -- 2. a group capability over an athlete-side member
    or (p_action in ('read','add') and exists (
          select 1 from memberships s
           where s.user_id = p_user and s.status = 'active'
             and public.membership_can(s.id, case p_action when 'read' then 'read_results' else 'add_results' end)
             and public.is_group_athlete(s.org_id, p_owner)))
    -- 3. a group where members see each other's results, both sharing
    or (p_action = 'read' and exists (
          select 1 from memberships a
            join memberships b on b.org_id = a.org_id
            join organisations o on o.id = a.org_id
           where a.user_id = p_owner and a.status = 'active' and a.share_results
             and b.user_id = p_user  and b.status = 'active'
             and o.members_see_results));
$$;

-- Who can see a person's users row (full profile incl. email)?
-- Themselves; guardian ↔ junior; staff or managers of a group the person is in.
-- Other members see each other only through group_directory().
create or replace function public.can_see_user(p_target uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select p_target = p_user
      or exists (select 1 from log_permissions lp
                  where lp.is_guardian and lp.status <> 'revoked'
                    and ((lp.owner_user_id = p_target and lp.grantee_user_id = p_user)
                      or (lp.grantee_user_id = p_target and lp.owner_user_id = p_user)))
      or exists (select 1 from memberships m
                  where m.user_id = p_target and m.status in ('active','pending','awaiting_guardian')
                    and (public.is_group_staff(m.org_id, p_user) or public.can_manage_group(m.org_id, p_user)));
$$;

-- ---- Tests helpers that used the old grant tree (now via parent groups) -----
create or replace function public.can_see_protocol_org(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select p_org is null
      or public.can_manage_group(p_org, p_user)
      or exists (select 1 from memberships m
                  where m.user_id = p_user and m.status = 'active'
                    and exists (select 1 from public.org_ancestors_and_self(m.org_id) a where a.org_id = p_org));
$$;

create or replace function public.can_edit_protocol_org(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_org is null then public.is_root(p_user)
              else public.is_group_staff(p_org, p_user) or public.can_manage_group(p_org, p_user) end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Triggers: last manager guard, event log
-- ----------------------------------------------------------------------------

-- A group can never be left with no one who manages its members.
create or replace function public.guard_last_team_manager() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_was boolean;
  v_still boolean;
begin
  v_was := old.status = 'active' and public.membership_can(old.id, 'manage_members');
  if not v_was then return case when tg_op = 'DELETE' then old else new end; end if;

  if tg_op = 'DELETE' then
    v_still := false;
  else
    v_still := new.status = 'active'
           and coalesce(new.manage_members,
                        (select r.manage_members from group_roles r where r.key = new.role), false);
  end if;

  if not v_still
     and exists (select 1 from organisations where id = old.org_id)      -- not a cascade from deleting the group
     and not exists (select 1 from memberships m
                      where m.org_id = old.org_id and m.id <> old.id and m.status = 'active'
                        and public.membership_can(m.id, 'manage_members')) then
    raise exception 'LAST_TEAM_MANAGER: a group must keep at least one Team Manager — add another first';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_guard_last_team_manager on public.memberships;
create trigger trg_guard_last_team_manager before update or delete on public.memberships
  for each row execute function public.guard_last_team_manager();

-- Every membership change any member should know about.
create or replace function public.log_membership_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_label text := (select label from group_roles where key = new.role);
begin
  if tg_op = 'INSERT' then
    if new.status = 'active' then
      insert into group_events (org_id, actor_user_id, subject_user_id, event, detail)
      values (new.org_id, v_actor, new.user_id,
              case when exists (select 1 from memberships m where m.org_id = new.org_id and m.user_id = new.user_id
                                  and m.id <> new.id and m.status = 'active') then 'role_added' else 'joined' end,
              jsonb_build_object('role', new.role, 'role_label', v_label));
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'active' then
      insert into group_events (org_id, actor_user_id, subject_user_id, event, detail)
      values (new.org_id, v_actor, new.user_id, 'joined', jsonb_build_object('role', new.role, 'role_label', v_label));
    elsif new.status = 'removed' and old.status = 'active' then
      insert into group_events (org_id, actor_user_id, subject_user_id, event, detail)
      values (new.org_id, v_actor, new.user_id,
              case when v_actor = new.user_id then 'left' else 'removed' end,
              jsonb_build_object('role', new.role, 'role_label', v_label));
    end if;
  end if;

  if new.manage_members is distinct from old.manage_members
     or new.read_results is distinct from old.read_results
     or new.add_results  is distinct from old.add_results then
    insert into group_events (org_id, actor_user_id, subject_user_id, event, detail)
    values (new.org_id, v_actor, new.user_id, 'capability_changed',
            jsonb_build_object('role', new.role, 'role_label', v_label,
              'from', jsonb_build_object('manage_members', old.manage_members, 'read_results', old.read_results, 'add_results', old.add_results),
              'to',   jsonb_build_object('manage_members', new.manage_members, 'read_results', new.read_results, 'add_results', new.add_results)));
  end if;
  return new;
end $$;

drop trigger if exists trg_log_membership_event on public.memberships;
create trigger trg_log_membership_event after insert or update on public.memberships
  for each row execute function public.log_membership_event();

create or replace function public.log_group_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into group_events (org_id, actor_user_id, event, detail)
    values (new.id, auth.uid(), 'created', jsonb_build_object('name', new.name, 'group_type', new.group_type));
  elsif (new.name, new.description, new.show_public_name, new.show_full_name, new.show_email, new.members_see_results)
        is distinct from
        (old.name, old.description, old.show_public_name, old.show_full_name, old.show_email, old.members_see_results) then
    insert into group_events (org_id, actor_user_id, event, detail)
    values (new.id, auth.uid(), 'settings_changed', jsonb_build_object(
      'from', jsonb_build_object('name', old.name, 'show_public_name', old.show_public_name, 'show_full_name', old.show_full_name,
                                 'show_email', old.show_email, 'members_see_results', old.members_see_results),
      'to',   jsonb_build_object('name', new.name, 'show_public_name', new.show_public_name, 'show_full_name', new.show_full_name,
                                 'show_email', new.show_email, 'members_see_results', new.members_see_results)));
  end if;
  return new;
end $$;

drop trigger if exists trg_log_group_event on public.organisations;
create trigger trg_log_group_event after insert or update on public.organisations
  for each row execute function public.log_group_event();

-- ----------------------------------------------------------------------------
-- 7. RPCs: groups
-- ----------------------------------------------------------------------------

-- Create a group; the creator becomes its Team Manager. Optional parent (you must manage it).
create or replace function public.create_group(
  p_name text, p_group_type text default 'coaching', p_org_type text default 'club',
  p_parent_org uuid default null, p_description text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_day int; v_month int;
begin
  if v_uid is null then raise exception 'NOT_ALLOWED: sign in first'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'INVALID: group name is required'; end if;
  if p_group_type not in ('coaching','sharing','family') then
    raise exception 'INVALID: group type must be coaching, sharing or family';
  end if;
  if p_parent_org is not null and not public.can_manage_group(p_parent_org, v_uid) then
    raise exception 'NOT_ALLOWED: you do not manage the parent group';
  end if;

  select count(*) filter (where created_at > now() - interval '24 hours'),
         count(*) filter (where created_at > now() - interval '30 days')
    into v_day, v_month
    from organisations where created_by = v_uid;
  if v_day >= public.setting_int('group_create_daily_limit', 10) then
    raise exception 'RATE_LIMIT: you can create % groups in 24 hours', public.setting_int('group_create_daily_limit', 10);
  end if;
  if v_month >= public.setting_int('group_create_30day_limit', 30) then
    raise exception 'RATE_LIMIT: you can create % groups in 30 days', public.setting_int('group_create_30day_limit', 30);
  end if;

  insert into organisations (name, org_type, group_type, parent_org_id, description, created_by,
                             show_public_name, show_full_name, show_email, members_see_results)
  values (trim(p_name), coalesce(p_org_type, 'club'), p_group_type, p_parent_org, p_description, v_uid,
          true,
          p_group_type = 'family',
          false,
          p_group_type in ('sharing','family'))
  returning id into v_org;

  insert into memberships (user_id, org_id, role, status, nominated_by)
  values (v_uid, v_org, 'team_manager', 'active', v_uid);

  -- In a sharing or family group the creator shares too, so is also a member.
  if p_group_type in ('sharing','family') then
    insert into memberships (user_id, org_id, role, status, nominated_by,
                             share_public_name, share_full_name, share_email, share_results)
    select v_uid, v_org, 'member', 'active', v_uid,
           show_public_name, show_full_name, show_email, members_see_results
      from organisations where id = v_org;
  end if;

  return v_org;
end $$;

-- Change a group's name/description/ticks. Members' own ticks are untouched, so
-- tightening bites at once and loosening waits for each member to accept.
create or replace function public.update_group_settings(
  p_org uuid, p_name text default null, p_description text default null,
  p_show_public_name boolean default null, p_show_full_name boolean default null,
  p_show_email boolean default null, p_members_see_results boolean default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_group(p_org) then raise exception 'NOT_ALLOWED: you do not manage that group'; end if;
  update organisations
     set name                = coalesce(nullif(trim(p_name), ''), name),
         description         = coalesce(p_description, description),
         show_public_name    = coalesce(p_show_public_name, show_public_name),
         show_full_name      = coalesce(p_show_full_name, show_full_name),
         show_email          = coalesce(p_show_email, show_email),
         members_see_results = coalesce(p_members_see_results, members_see_results)
   where id = p_org;
end $$;

-- A member (or their guardian) takes up the group's current ticks.
create or replace function public.accept_group_settings(p_org uuid, p_user uuid default auth.uid()) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user <> auth.uid() and not public.is_active_guardian(p_user) then
    raise exception 'NOT_ALLOWED: only the member or their guardian can accept';
  end if;
  update memberships m
     set share_public_name = o.show_public_name, share_full_name = o.show_full_name,
         share_email = o.show_email, share_results = o.members_see_results
    from organisations o
   where o.id = m.org_id and m.org_id = p_org and m.user_id = p_user and m.status <> 'removed';
end $$;

-- A member (or guardian) changes their own ticks; they can only be as open as the group allows.
create or replace function public.set_my_sharing(
  p_org uuid, p_public_name boolean, p_full_name boolean, p_email boolean, p_results boolean,
  p_user uuid default auth.uid())
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user <> auth.uid() and not public.is_active_guardian(p_user) then
    raise exception 'NOT_ALLOWED: only the member or their guardian can change this';
  end if;
  update memberships set share_public_name = p_public_name, share_full_name = p_full_name,
                         share_email = p_email, share_results = p_results
   where org_id = p_org and user_id = p_user and status <> 'removed';
end $$;

-- Make an invite link/code. Staff roles always need a manager's approval.
create or replace function public.create_group_invite(
  p_org uuid, p_role text default 'member', p_needs_approval boolean default false,
  p_max_uses int default null, p_expires_at timestamptz default now() + interval '14 days')
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_staff boolean;
begin
  if not public.can_manage_group(p_org) then raise exception 'NOT_ALLOWED: you do not manage that group'; end if;
  select is_staff into v_staff from group_roles where key = p_role and not retired;
  if not found then raise exception 'INVALID: unknown role %', p_role; end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into group_invites (org_id, code, role, needs_approval, max_uses, expires_at, created_by)
  values (p_org, v_code, p_role, p_needs_approval or v_staff, p_max_uses, p_expires_at, auth.uid());
  return v_code;
end $$;

create or replace function public.revoke_group_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from group_invites where id = p_invite;
  if v_org is null or not public.can_manage_group(v_org) then
    raise exception 'NOT_ALLOWED: you do not manage that group';
  end if;
  update group_invites set revoked_at = now() where id = p_invite and revoked_at is null;
end $$;

-- Internal: the invite row if it can still be used, else an error.
create or replace function public.usable_invite(p_code text) returns public.group_invites
language plpgsql stable security definer set search_path = public as $$
declare v group_invites%rowtype;
begin
  select * into v from group_invites where code = upper(trim(p_code));
  if not found or v.revoked_at is not null or (v.expires_at is not null and v.expires_at <= now())
     or (v.max_uses is not null and v.uses >= v.max_uses) then
    raise exception 'INVITE_INVALID: this invite link is not valid or has expired';
  end if;
  return v;
end $$;

-- What the join screen shows, before joining.
create or replace function public.preview_group_invite(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v group_invites%rowtype;
  o organisations%rowtype;
begin
  if auth.uid() is null then raise exception 'NOT_ALLOWED: sign in first'; end if;
  v := public.usable_invite(p_code);
  select * into o from organisations where id = v.org_id;
  return jsonb_build_object(
    'org_id', o.id, 'name', o.name, 'description', o.description,
    'group_type', o.group_type, 'org_type', o.org_type,
    'role', v.role, 'role_label', (select label from group_roles where key = v.role),
    'needs_approval', v.needs_approval,
    'visibility', jsonb_build_object('public_name', o.show_public_name, 'full_name', o.show_full_name,
                                     'email', o.show_email, 'results', o.members_see_results),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'public_name', coalesce(u.public_name, u.full_name),
               'full_name', u.full_name,
               'role_label', r.label,
               'manage_members', public.membership_can(m.id, 'manage_members'),
               'read_results',   public.membership_can(m.id, 'read_results'),
               'add_results',    public.membership_can(m.id, 'add_results'),
               'qualifications', coalesce((select jsonb_agg(jsonb_build_object(
                                     'title', q.title, 'issuer', q.issuer, 'expires_on', q.expires_on,
                                     'verified', q.verified_at is not null) order by q.title)
                                   from staff_qualifications q where q.user_id = u.id), '[]'::jsonb))
             order by r.sort, u.full_name)
        from memberships m join group_roles r on r.key = m.role join users u on u.id = m.user_id
       where m.org_id = o.id and m.status = 'active' and r.is_staff), '[]'::jsonb));
end $$;

-- Join with an invite code, yourself or (as guardian) for your junior.
-- Under-18 joining themself → awaiting_guardian. Needs approval → pending. Else active.
create or replace function public.join_group(p_code text, p_user uuid default auth.uid()) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v group_invites%rowtype;
  o organisations%rowtype;
  v_by_guardian boolean;
  v_status text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'NOT_ALLOWED: sign in first'; end if;
  v_by_guardian := p_user <> v_uid;
  if v_by_guardian and not public.is_active_guardian(p_user, v_uid) then
    raise exception 'NOT_ALLOWED: you can only join groups for yourself or a junior you are guardian of';
  end if;
  v := public.usable_invite(p_code);
  select * into o from organisations where id = v.org_id;

  v_status := case when public.is_junior(p_user) and not v_by_guardian then 'awaiting_guardian'
                   when v.needs_approval then 'pending'
                   else 'active' end;

  select id into v_id from memberships where user_id = p_user and org_id = o.id and role = v.role;
  if v_id is not null then
    if (select status from memberships where id = v_id) in ('active','pending','awaiting_guardian') then
      return v_id;                                         -- already in (or waiting): no-op
    end if;
    update memberships
       set status = v_status, needs_approval = v.needs_approval, invite_id = v.id, nominated_by = v_uid,
           guardian_approved_by = case when v_by_guardian then v_uid end,
           share_public_name = o.show_public_name, share_full_name = o.show_full_name,
           share_email = o.show_email, share_results = o.members_see_results,
           manage_members = null, read_results = null, add_results = null
     where id = v_id;
  else
    insert into memberships (user_id, org_id, role, status, needs_approval, invite_id, nominated_by,
                             guardian_approved_by, share_public_name, share_full_name, share_email, share_results)
    values (p_user, o.id, v.role, v_status, v.needs_approval, v.id, v_uid,
            case when v_by_guardian then v_uid end,
            o.show_public_name, o.show_full_name, o.show_email, o.members_see_results)
    returning id into v_id;
  end if;

  update group_invites set uses = uses + 1 where id = v.id;
  return v_id;
end $$;

-- A guardian approves (or declines) their junior's request to join.
create or replace function public.approve_junior_membership(p_membership uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare m memberships%rowtype;
begin
  select * into m from memberships where id = p_membership;
  if not found or m.status <> 'awaiting_guardian' then raise exception 'NOT_FOUND: no request waiting for a guardian'; end if;
  if not public.is_active_guardian(m.user_id) then raise exception 'NOT_ALLOWED: you are not this athlete''s guardian'; end if;
  update memberships
     set status = case when not p_accept then 'removed' when m.needs_approval then 'pending' else 'active' end,
         guardian_approved_by = case when p_accept then auth.uid() end
   where id = p_membership;
end $$;

-- A manager approves (or declines) a pending join.
create or replace function public.approve_membership(p_membership uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare m memberships%rowtype;
begin
  select * into m from memberships where id = p_membership;
  if not found or m.status <> 'pending' then raise exception 'NOT_FOUND: no pending request with that id'; end if;
  if not public.can_manage_group(m.org_id) then raise exception 'NOT_ALLOWED: you do not manage that group'; end if;
  update memberships set status = case when p_accept then 'active' else 'removed' end where id = p_membership;
end $$;

-- Give an existing member of the group another role (e.g. make a parent a Poolside Assistant).
create or replace function public.add_member_role(p_org uuid, p_user uuid, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_manage_group(p_org) then raise exception 'NOT_ALLOWED: you do not manage that group'; end if;
  if not exists (select 1 from group_roles where key = p_role and not retired) then
    raise exception 'INVALID: unknown role %', p_role;
  end if;
  if not exists (select 1 from memberships where org_id = p_org and user_id = p_user and status = 'active') then
    raise exception 'NOT_FOUND: that person is not an active member of the group';
  end if;
  select id into v_id from memberships where org_id = p_org and user_id = p_user and role = p_role;
  if v_id is null then
    insert into memberships (user_id, org_id, role, status, nominated_by,
                             share_public_name, share_full_name, share_email, share_results)
    select p_user, p_org, p_role, 'active', auth.uid(),
           show_public_name, show_full_name, show_email, members_see_results
      from organisations where id = p_org
    returning id into v_id;
  else
    update memberships set status = 'active', manage_members = null, read_results = null, add_results = null
     where id = v_id and status <> 'active';
  end if;
  return v_id;
end $$;

-- Switch one capability on/off for one person (null = back to the role's default).
create or replace function public.set_member_capability(p_membership uuid, p_cap text, p_value boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from memberships where id = p_membership;
  if v_org is null or not public.can_manage_group(v_org) then
    raise exception 'NOT_ALLOWED: you do not manage that group';
  end if;
  if p_cap = 'manage_members' then update memberships set manage_members = p_value where id = p_membership;
  elsif p_cap = 'read_results' then update memberships set read_results = p_value where id = p_membership;
  elsif p_cap = 'add_results'  then update memberships set add_results  = p_value where id = p_membership;
  else raise exception 'INVALID: capability must be manage_members, read_results or add_results';
  end if;
end $$;

-- Leave (yourself), take your junior out (guardian), or remove someone (manager).
create or replace function public.remove_membership(p_membership_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_m memberships%rowtype;
begin
  select * into v_m from memberships where id = p_membership_id;
  if not found then raise exception 'NOT_FOUND: membership not found'; end if;
  if v_m.user_id <> auth.uid()
     and not public.is_active_guardian(v_m.user_id)
     and not public.can_manage_group(v_m.org_id) then
    raise exception 'NOT_ALLOWED: you cannot change that membership';
  end if;
  update memberships set status = 'removed' where id = p_membership_id;
end $$;

-- The member list as the caller is allowed to see it. Hidden fields come back null.
create or replace function public.group_directory(p_org uuid)
returns table (membership_id uuid, user_id uuid, public_name text, full_name text, email text,
               role text, role_label text, is_staff boolean, status text,
               manage_members boolean, read_results boolean, add_results boolean, is_junior boolean)
language sql stable security definer set search_path = public as $$
  with me as (
    select public.is_group_staff(p_org) or public.can_manage_group(p_org) as staff_view,
           public.can_see_group(p_org) as can_see
  )
  select m.id, m.user_id,
         coalesce(u.public_name, u.full_name),
         case when me.staff_view or m.user_id = auth.uid() or r.is_staff
                   or (o.show_full_name and m.share_full_name and not public.is_junior(m.user_id))
              then u.full_name end,
         case when me.staff_view or m.user_id = auth.uid()
                   or (o.show_email and m.share_email and not public.is_junior(m.user_id))
              then u.email end,
         m.role, r.label, r.is_staff, m.status,
         public.membership_can(m.id, 'manage_members'),
         public.membership_can(m.id, 'read_results'),
         public.membership_can(m.id, 'add_results'),
         public.is_junior(m.user_id)
    from me, memberships m
    join group_roles r   on r.key = m.role
    join users u         on u.id = m.user_id
    join organisations o on o.id = m.org_id
   where me.can_see and m.org_id = p_org
     and (m.status = 'active' or (me.staff_view and m.status in ('pending','awaiting_guardian')))
     and (me.staff_view or r.is_staff or m.user_id = auth.uid()
          or public.is_active_guardian(m.user_id)
          or (o.show_public_name and m.share_public_name))
   order by r.sort, coalesce(u.public_name, u.full_name);
$$;

-- ----------------------------------------------------------------------------
-- 8. RPCs: qualifications
-- ----------------------------------------------------------------------------
create or replace function public.add_qualification(p_title text, p_issuer text default null,
  p_ref text default null, p_expires_on date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'NOT_ALLOWED: sign in first'; end if;
  insert into staff_qualifications (user_id, title, issuer, ref, expires_on)
  values (auth.uid(), trim(p_title), p_issuer, p_ref, p_expires_on) returning id into v_id;
  return v_id;
end $$;

create or replace function public.remove_qualification(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from staff_qualifications where id = p_id and user_id = auth.uid();
  if not found then raise exception 'NOT_FOUND: no qualification of yours with that id'; end if;
end $$;

-- Root only for now.
create or replace function public.verify_qualification(p_id uuid, p_verified boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_root() then raise exception 'NOT_ALLOWED: root only'; end if;
  update staff_qualifications
     set verified_by = case when p_verified then auth.uid() end,
         verified_at = case when p_verified then now() end
   where id = p_id;
end $$;

-- ----------------------------------------------------------------------------
-- 9. RPCs: sponsorship
-- ----------------------------------------------------------------------------

-- Give sponsorship to a group (you use the sponsorship of p_sponsor_org).
-- You must also be in the target group, so you can only sponsor groups you know.
create or replace function public.sponsor_group(p_sponsor_org uuid, p_org uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if not public.can_sponsor_via(p_sponsor_org, v_uid) then
    raise exception 'NOT_ALLOWED: you cannot use that group''s sponsorship, or it is suspended';
  end if;
  if not public.is_member_of(p_org, v_uid) then
    raise exception 'NOT_ALLOWED: you can only sponsor a group you are in';
  end if;
  if public.org_sponsorship(p_org) is not null then
    raise exception 'ALREADY_SPONSORED: that group already has sponsorship';
  end if;
  if public.group_actions_last_24h(p_sponsor_org) >= public.group_daily_limit(p_sponsor_org) then
    raise exception 'RATE_LIMIT: this group has reached its limit of % in 24 hours', public.group_daily_limit(p_sponsor_org);
  end if;
  insert into sponsorships (org_id, parent_sponsorship_id, granted_by)
  values (p_org, public.org_sponsorship(p_sponsor_org), v_uid) returning id into v_id;
  insert into group_events (org_id, actor_user_id, event, detail)
  values (p_org, v_uid, 'sponsored', jsonb_build_object('by_org', p_sponsor_org));
  return v_id;
end $$;

-- Suspend or restore (cascades to the branch below). Only from above.
create or replace function public.set_sponsorship_status(p_sponsorship uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('active','suspended') then raise exception 'INVALID: status must be active or suspended'; end if;
  if not public.can_manage_sponsorship(p_sponsorship) then
    raise exception 'NOT_ALLOWED: only a group above this one can suspend or restore it';
  end if;
  update sponsorships set status = p_status, status_changed_by = auth.uid(), status_changed_at = now()
   where id = p_sponsorship;
end $$;

-- Nominate a guardian: an existing guardian, or someone who manages a group the junior is in.
create or replace function public.nominate_guardian(p_junior uuid, p_guardian_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_guardian uuid;
  v_row log_permissions%rowtype;
begin
  if not public.is_junior(p_junior) then raise exception 'INVALID: guardians are only for athletes under 18'; end if;
  if not public.is_active_guardian(p_junior, v_uid)
     and not exists (select 1 from memberships m
                      where m.user_id = p_junior and m.status = 'active'
                        and public.can_manage_group(m.org_id, v_uid)) then
    raise exception 'NOT_ALLOWED: only a guardian or a Team Manager of the athlete''s group can nominate a guardian';
  end if;
  v_guardian := public.find_user_by_email(p_guardian_email);
  if v_guardian is null then raise exception 'USER_NOT_FOUND: no SwimZone account for %', p_guardian_email; end if;
  if not public.is_adult(v_guardian) then
    raise exception 'GUARDIAN_NOT_ADULT: % must be aged 18 or over (date of birth set)', p_guardian_email;
  end if;

  select * into v_row from log_permissions
   where owner_user_id = p_junior and grantee_user_id = v_guardian and status <> 'revoked';
  if found then
    if v_row.is_guardian then return v_row.id; end if;
    update log_permissions set is_guardian = true, can_read = true, can_add = true, can_edit = true,
           status = 'pending', expires_at = null, granted_by = v_uid
     where id = v_row.id;
    return v_row.id;
  end if;
  insert into log_permissions (owner_user_id, grantee_user_id, can_read, can_add, can_edit, is_guardian, status, granted_by)
  values (p_junior, v_guardian, true, true, true, true, 'pending', v_uid)
  returning id into v_row.id;
  return v_row.id;
end $$;

-- ---- Edge Function checks (service role). Names kept: add-athlete calls them. ----
-- Adding brings a NEW person in, using the group's sponsorship. Someone who
-- already has an account joins through an invite link instead (opt-in).
create or replace function public.validate_athlete_addition(
  p_actor uuid, p_org uuid, p_date_of_birth date, p_guardian_emails text[],
  p_existing_user uuid default null)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_email text;
  v_g uuid;
begin
  if not public.can_sponsor_via(p_org, p_actor) then
    return 'NOT_ALLOWED: you are not a Team Manager of a sponsored group, or its sponsorship is suspended';
  end if;
  if p_existing_user is not null then
    return 'ALREADY_REGISTERED: this person already has a SwimZone account — send them the group''s invite link instead';
  end if;
  if public.group_actions_last_24h(p_org) >= public.group_daily_limit(p_org) then
    return format('RATE_LIMIT: this group has reached its limit of %s adds in 24 hours', public.group_daily_limit(p_org));
  end if;
  if p_date_of_birth is null then return 'INVALID: date of birth is required for a new athlete'; end if;
  if p_date_of_birth > (current_date - interval '18 years')::date
     and coalesce(array_length(p_guardian_emails, 1), 0) = 0 then
    return 'GUARDIAN_REQUIRED: an under-18 athlete needs at least one adult as guardian';
  end if;
  foreach v_email in array coalesce(p_guardian_emails, '{}') loop
    v_g := public.find_user_by_email(v_email);
    if v_g is null then
      return format('USER_NOT_FOUND: no SwimZone account for %s — add them as an adult first', v_email);
    end if;
    if not public.is_adult(v_g) then
      return format('GUARDIAN_NOT_ADULT: %s must be aged 18 or over (date of birth set)', v_email);
    end if;
  end loop;
  return null;
end $$;

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
  o organisations%rowtype;
begin
  v_err := public.validate_athlete_addition(p_actor, p_org, p_date_of_birth, p_guardian_emails,
                                            case when p_new_account then null else p_user_id end);
  if v_err is not null then raise exception '%', v_err; end if;
  select * into o from organisations where id = p_org;

  insert into users (id, email, full_name, date_of_birth)
  values (p_user_id, lower(trim(p_email)), p_full_name, p_date_of_birth)
  on conflict (id) do update
    set full_name     = coalesce(excluded.full_name, users.full_name),
        date_of_birth = coalesce(users.date_of_birth, excluded.date_of_birth);

  if not exists (select 1 from memberships where user_id = p_user_id and org_id = p_org and role = 'member') then
    insert into memberships (user_id, org_id, role, status, nominated_by,
                             share_public_name, share_full_name, share_email, share_results)
    values (p_user_id, p_org, 'member', 'active', p_actor,
            o.show_public_name, o.show_full_name, o.show_email, o.members_see_results);
  end if;

  insert into user_additions (added_user_id, added_by_user_id, via_org_id, was_new_account)
  values (p_user_id, p_actor, p_org, true);

  foreach v_email in array coalesce(p_guardian_emails, '{}') loop
    v_g := public.find_user_by_email(v_email);
    if v_g <> p_user_id and not exists (
         select 1 from log_permissions where owner_user_id = p_user_id and grantee_user_id = v_g and status <> 'revoked') then
      insert into log_permissions (owner_user_id, grantee_user_id, can_read, can_add, can_edit, is_guardian, status, granted_by)
      values (p_user_id, v_g, true, true, true, true, 'pending', p_actor);
      v_guardian_ids := v_guardian_ids || v_g;
    end if;
  end loop;

  return jsonb_build_object('user_id', p_user_id, 'pending_guardians', to_jsonb(v_guardian_ids));
end $$;

-- ----------------------------------------------------------------------------
-- 9b. Reads for the app (one call per screen; each returns only what the caller may see)
-- ----------------------------------------------------------------------------

drop function if exists public.my_memberships();
-- My memberships with effective capabilities. settings_to_accept = the group has
-- loosened a tick the member hasn't taken up yet.
create or replace function public.my_memberships()
returns table (membership_id uuid, org_id uuid, org_name text, group_type text, org_type text,
               parent_org_id uuid, description text, role text, role_label text, status text,
               manage_members boolean, read_results boolean, add_results boolean, is_staff boolean,
               share_public_name boolean, share_full_name boolean, share_email boolean, share_results boolean,
               settings_to_accept boolean)
language sql stable security definer set search_path = public as $$
  select m.id, o.id, o.name, o.group_type, o.org_type, o.parent_org_id, o.description,
         m.role, r.label, m.status,
         public.membership_can(m.id, 'manage_members'), public.membership_can(m.id, 'read_results'),
         public.membership_can(m.id, 'add_results'), r.is_staff,
         m.share_public_name, m.share_full_name, m.share_email, m.share_results,
         m.status = 'active' and not r.is_staff and (
           (o.show_public_name and not m.share_public_name)
           or (o.show_full_name and not m.share_full_name and not public.is_junior(m.user_id))
           or (o.show_email and not m.share_email and not public.is_junior(m.user_id))
           or (o.members_see_results and not m.share_results))
    from memberships m
    join organisations o on o.id = m.org_id
    join group_roles r   on r.key = m.role
   where m.user_id = auth.uid() and m.status in ('active','pending','awaiting_guardian')
   order by o.name, r.sort;
$$;

-- The athletes I can load: my juniors (guardian) and athlete-side members of my groups
-- whose results I can read or add to. One row per athlete.
create or replace function public.my_athletes()
returns table (athlete_id uuid, name text, relation text, via text, can_read boolean, can_add boolean, is_junior boolean)
language sql stable security definer set search_path = public as $$
  with cand as (
    select lp.owner_user_id as uid, 'guardian'::text as relation, null::text as via
      from log_permissions lp
     where lp.grantee_user_id = auth.uid() and lp.is_guardian and lp.status = 'active'
    union
    select a.user_id, 'group', o.name
      from memberships s
      join memberships a   on a.org_id = s.org_id and a.status = 'active' and a.user_id <> auth.uid()
      join group_roles ra  on ra.key = a.role and not ra.is_staff
      join organisations o on o.id = s.org_id
     where s.user_id = auth.uid() and s.status = 'active'
  )
  select c.uid,
         case when bool_or(c.relation = 'guardian')
                   or exists (select 1 from memberships m where m.user_id = c.uid and m.status = 'active'
                                 and public.is_group_staff(m.org_id))
              then coalesce(nullif(btrim(u.full_name), ''), u.public_name)
              else coalesce(nullif(btrim(u.public_name), ''), u.full_name) end,
         case when bool_or(c.relation = 'guardian') then 'guardian' else 'group' end,
         string_agg(distinct c.via, ', '),
         public.has_log_access(c.uid, 'read'),
         public.has_log_access(c.uid, 'add'),
         public.is_junior(c.uid)
    from cand c join users u on u.id = c.uid
   group by c.uid, u.full_name, u.public_name
  having public.has_log_access(c.uid, 'read') or public.has_log_access(c.uid, 'add')
   order by 2;
$$;

-- Things waiting for me: juniors' join requests (as guardian), join requests in
-- groups I manage, and guardianships offered to me.
create or replace function public.my_pending_requests()
returns table (kind text, id uuid, org_id uuid, org_name text, user_id uuid, name text, role_label text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select 'junior_join', m.id, o.id, o.name, m.user_id, coalesce(u.full_name, u.public_name), r.label, m.created_at
    from memberships m join organisations o on o.id = m.org_id
    join group_roles r on r.key = m.role join users u on u.id = m.user_id
   where m.status = 'awaiting_guardian' and public.is_active_guardian(m.user_id)
  union all
  select 'member_approval', m.id, o.id, o.name, m.user_id, coalesce(u.full_name, u.public_name), r.label, m.created_at
    from memberships m join organisations o on o.id = m.org_id
    join group_roles r on r.key = m.role join users u on u.id = m.user_id
   where m.status = 'pending' and public.can_manage_group(m.org_id)
  union all
  select 'guardianship', lp.id, null, null, lp.owner_user_id, coalesce(u.full_name, u.public_name), 'Guardian', lp.created_at
    from log_permissions lp join users u on u.id = lp.owner_user_id
   where lp.grantee_user_id = auth.uid() and lp.is_guardian and lp.status = 'pending'
  order by 8;
$$;

-- A group's event log with names (public names; never email).
create or replace function public.group_event_log(p_org uuid, p_limit int default 100)
returns table (id uuid, event text, actor_name text, subject_name text, detail jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.event,
         coalesce(nullif(btrim(a.public_name), ''), a.full_name),
         coalesce(nullif(btrim(s.public_name), ''), s.full_name),
         e.detail, e.created_at
    from group_events e
    left join users a on a.id = e.actor_user_id
    left join users s on s.id = e.subject_user_id
   where e.org_id = p_org and public.can_see_group(p_org)
   order by e.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- The sponsorship tree as far as I can see it (my sponsored groups and everything below).
create or replace function public.sponsorship_tree()
returns table (sponsorship_id uuid, parent_sponsorship_id uuid, status text, effective boolean,
               org_id uuid, org_name text, can_use boolean, can_manage boolean, created_at timestamptz,
               daily_limit int, used_last_24h int)
language sql stable security definer set search_path = public as $$
  select s.id, s.parent_sponsorship_id, s.status, public.sponsorship_is_effective(s.id),
         o.id, o.name, public.can_sponsor_via(o.id), public.can_manage_sponsorship(s.id), s.created_at,
         public.group_daily_limit(o.id), public.group_actions_last_24h(o.id)
    from sponsorships s join organisations o on o.id = s.org_id
   where public.has_group_capability(o.id, 'manage_members') or public.can_manage_sponsorship(s.id)
   order by s.created_at;
$$;

-- ----------------------------------------------------------------------------
-- 10. Privileges
-- ----------------------------------------------------------------------------
revoke execute on function public.usable_invite(text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.usable_invite(text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.usable_invite(text) from authenticated;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 11. Row Level Security (reads via helpers; all writes go through the RPCs)
-- ----------------------------------------------------------------------------
alter table public.sponsorships          enable row level security;
alter table public.group_roles           enable row level security;
alter table public.group_invites         enable row level security;
alter table public.group_events          enable row level security;
alter table public.staff_qualifications  enable row level security;

drop policy if exists sz_sponsorships_read on public.sponsorships;
create policy sz_sponsorships_read on public.sponsorships for select to authenticated
  using (public.has_group_capability(org_id, 'manage_members') or public.can_manage_sponsorship(id));

drop policy if exists sz_additions_read on public.user_additions;
create policy sz_additions_read on public.user_additions for select to authenticated
  using (added_by_user_id = auth.uid() or public.can_manage_group(via_org_id));

drop policy if exists sz_users_related on public.users;
create policy sz_users_related on public.users for select to authenticated
  using (public.can_see_user(id));

drop policy if exists sz_orgs_read on public.organisations;
create policy sz_orgs_read on public.organisations for select to authenticated
  using (public.can_see_group(id));

-- Own rows; your junior's rows; every row of a group you manage or are staff in.
-- Other members are listed through group_directory().
drop policy if exists sz_memberships_read on public.memberships;
create policy sz_memberships_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.is_active_guardian(user_id)
         or public.can_manage_group(org_id) or public.is_group_staff(org_id));

drop policy if exists sz_group_roles_read on public.group_roles;
create policy sz_group_roles_read on public.group_roles for select to authenticated using (true);

drop policy if exists sz_group_invites_read on public.group_invites;
create policy sz_group_invites_read on public.group_invites for select to authenticated
  using (public.can_manage_group(org_id));

drop policy if exists sz_group_events_read on public.group_events;
create policy sz_group_events_read on public.group_events for select to authenticated
  using (public.can_see_group(org_id));

-- Your own; anyone else's only while they hold a staff role somewhere (they're shown on join screens).
drop policy if exists sz_quals_read on public.staff_qualifications;
create policy sz_quals_read on public.staff_qualifications for select to authenticated
  using (user_id = auth.uid() or public.is_staff_anywhere(user_id));

commit;
