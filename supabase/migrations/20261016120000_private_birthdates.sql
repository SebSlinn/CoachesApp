-- ============================================================================
-- SwimZone — Private dates of birth
-- Migration 20261016120000_private_birthdates.sql          Owner: Accounts
-- Follows 20261015120000_groups_sponsorship.sql (applied 2026-10-15). DECISIONS 2026-10-16.
--
--   • Dates of birth move off users (which coaches and Team Managers can read)
--     into user_birthdates, readable only by the person and their guardian.
--   • Staff get the AGE instead: athlete_age(user, as_of) — today, or on a given
--     date (gala age groups). Never the date.
--   • Nobody enters another person's date of birth. Adults add their own
--     (optional; needed to be a guardian). A guardian adds their child's, when
--     accepting the guardianship or later. Set once; root corrects.
--   • A sponsor bringing someone new in only says "under 18" (by naming a
--     guardian). That child waits for the guardian to accept before joining.
--
-- Idempotent: safe to run twice.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. The private table, and moving existing dates into it
-- ----------------------------------------------------------------------------
-- Dates of birth are private: their own table, readable only by the person and
-- their guardian. users keeps only declared_junior (ticked by whoever sponsored
-- an under-18 in), used until a guardian enters the real date.
create table if not exists public.user_birthdates (
  user_id       uuid primary key references public.users(id) on delete cascade,
  date_of_birth date not null check (date_of_birth > date '1900-01-01'),
  set_by        uuid references public.users(id),
  set_at        timestamptz not null default now()
);
alter table public.users add column if not exists declared_junior boolean not null default false;
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'users' and column_name = 'date_of_birth') then
    insert into public.user_birthdates (user_id, date_of_birth)
    select id, date_of_birth from public.users where date_of_birth is not null
    on conflict (user_id) do nothing;
    drop trigger if exists trg_lock_dob on public.users;
    alter table public.users drop column date_of_birth;
  end if;
end $$;
drop function if exists public.lock_date_of_birth();

-- ----------------------------------------------------------------------------
-- 2. Adult / junior / age
-- ----------------------------------------------------------------------------
-- Adult = a date of birth on record showing 18+. Unknown age is NOT adult.
create or replace function public.is_adult(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select date_of_birth <= (current_date - interval '18 years')::date
                     from user_birthdates where user_id = p_user), false);
$$;

-- Junior = a date of birth showing under 18, or (no date yet) declared under 18.
create or replace function public.is_junior(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select date_of_birth > (current_date - interval '18 years')::date
                     from user_birthdates where user_id = p_user),
                  (select declared_junior from users where id = p_user), false);
$$;

-- Age in whole years (today, or on a given date — e.g. 31 Dec for gala age groups)
-- for someone whose results you can read, or yourself. Never the date itself.
create or replace function public.athlete_age(p_user uuid, p_as_of date default current_date) returns int
language sql stable security definer set search_path = public as $$
  select case when p_user = auth.uid() or public.has_log_access(p_user, 'read')
              then (select extract(year from age(coalesce(p_as_of, current_date), date_of_birth))::int
                      from user_birthdates where user_id = p_user) end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Adding new people (Edge Function), guardians, dates of birth
-- ----------------------------------------------------------------------------
-- ---- Edge Function checks (service role). Names kept: add-athlete calls them. ----
-- Adding brings a NEW person in, using the group's sponsorship. Someone who
-- already has an account joins through an invite link instead (opt-in).
-- p_date_of_birth is IGNORED: nobody enters another person's date of birth.
-- Guardian emails given = this person is under 18 (declared_junior); they wait
-- for the guardian to accept before their membership is active.
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
  foreach v_email in array coalesce(p_guardian_emails, '{}') loop
    v_g := public.find_user_by_email(v_email);
    if v_g is null then
      return format('USER_NOT_FOUND: no SwimZone account for %s — bring the parent in first', v_email);
    end if;
    if not public.is_adult(v_g) then
      return format('GUARDIAN_NOT_ADULT: %s needs to sign in and add their date of birth (18 or over) first', v_email);
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
  v_junior boolean := coalesce(array_length(p_guardian_emails, 1), 0) > 0;
  o organisations%rowtype;
begin
  v_err := public.validate_athlete_addition(p_actor, p_org, null, p_guardian_emails,
                                            case when p_new_account then null else p_user_id end);
  if v_err is not null then raise exception '%', v_err; end if;
  select * into o from organisations where id = p_org;

  insert into users (id, email, full_name, declared_junior)
  values (p_user_id, lower(trim(p_email)), p_full_name, v_junior)
  on conflict (id) do update
    set full_name       = coalesce(excluded.full_name, users.full_name),
        declared_junior = users.declared_junior or excluded.declared_junior;

  if not exists (select 1 from memberships where user_id = p_user_id and org_id = p_org and role = 'member') then
    insert into memberships (user_id, org_id, role, status, nominated_by,
                             share_public_name, share_full_name, share_email, share_results)
    values (p_user_id, p_org, 'member', case when v_junior then 'awaiting_guardian' else 'active' end, p_actor,
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

-- ---- Guardians and dates of birth ----

-- Accept (or decline) being a junior's guardian. Accepting needs the child's date
-- of birth if none is on record yet, and lets the child into any group that
-- added them (sponsor-added memberships waiting for a guardian).
drop function if exists public.respond_to_guardianship(uuid, boolean);
create or replace function public.respond_to_guardianship(
  p_permission_id uuid, p_accept boolean, p_date_of_birth date default null) returns void
language plpgsql security definer set search_path = public as $$
declare lp log_permissions%rowtype;
begin
  select * into lp from log_permissions
   where id = p_permission_id and grantee_user_id = auth.uid() and is_guardian and status = 'pending';
  if not found then raise exception 'NOT_FOUND: no pending guardianship of yours with that id'; end if;

  if not p_accept then
    update log_permissions set status = 'revoked' where id = lp.id;
    return;
  end if;

  if not exists (select 1 from user_birthdates where user_id = lp.owner_user_id) then
    if p_date_of_birth is null then
      raise exception 'DOB_REQUIRED: enter your child''s date of birth to accept';
    end if;
    if p_date_of_birth <= (current_date - interval '18 years')::date or p_date_of_birth > current_date then
      raise exception 'INVALID: that date makes them 18 or over (or is in the future) — adults add their own';
    end if;
    insert into user_birthdates (user_id, date_of_birth, set_by) values (lp.owner_user_id, p_date_of_birth, auth.uid());
  end if;

  update log_permissions set status = 'active' where id = lp.id;
  update memberships
     set status = case when needs_approval then 'pending' else 'active' end,
         guardian_approved_by = auth.uid()
   where user_id = lp.owner_user_id and status = 'awaiting_guardian' and invite_id is null;
end $$;

-- Add your own date of birth, once. Corrections go through root.
create or replace function public.set_my_date_of_birth(p_date_of_birth date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_ALLOWED: sign in first'; end if;
  if exists (select 1 from user_birthdates where user_id = auth.uid()) then
    raise exception 'ALREADY_SET: your date of birth is already recorded — ask SwimZone to correct it';
  end if;
  if p_date_of_birth is null or p_date_of_birth <= date '1900-01-01' or p_date_of_birth > current_date - interval '3 years' then
    raise exception 'INVALID: that date of birth doesn''t look right';
  end if;
  insert into user_birthdates (user_id, date_of_birth, set_by) values (auth.uid(), p_date_of_birth, auth.uid());
end $$;

-- A guardian adds their child's date of birth, once (must be under 18).
create or replace function public.set_junior_date_of_birth(p_junior uuid, p_date_of_birth date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_guardian(p_junior) then raise exception 'NOT_ALLOWED: you are not this athlete''s guardian'; end if;
  if exists (select 1 from user_birthdates where user_id = p_junior) then
    raise exception 'ALREADY_SET: their date of birth is already recorded — ask SwimZone to correct it';
  end if;
  if p_date_of_birth is null or p_date_of_birth <= (current_date - interval '18 years')::date or p_date_of_birth > current_date then
    raise exception 'INVALID: that date makes them 18 or over (or is in the future) — adults add their own';
  end if;
  insert into user_birthdates (user_id, date_of_birth, set_by) values (p_junior, p_date_of_birth, auth.uid());
end $$;

-- Root only: correct a date of birth.
create or replace function public.correct_date_of_birth(p_user uuid, p_date_of_birth date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_root() then raise exception 'NOT_ALLOWED: root only'; end if;
  insert into user_birthdates (user_id, date_of_birth, set_by) values (p_user, p_date_of_birth, auth.uid())
  on conflict (user_id) do update set date_of_birth = excluded.date_of_birth, set_by = excluded.set_by, set_at = now();
end $$;

-- About me (and my juniors): what's on record — never the dates themselves except my own.
create or replace function public.my_account_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'has_date_of_birth', exists (select 1 from user_birthdates where user_id = auth.uid()),
    'is_junior', public.is_junior(auth.uid()),
    'is_adult',  public.is_adult(auth.uid()),
    'juniors_missing_date_of_birth', coalesce((
       select jsonb_agg(jsonb_build_object('user_id', lp.owner_user_id, 'name', coalesce(u.full_name, u.public_name)))
         from log_permissions lp join users u on u.id = lp.owner_user_id
        where lp.grantee_user_id = auth.uid() and lp.is_guardian and lp.status = 'active'
          and not exists (select 1 from user_birthdates b where b.user_id = lp.owner_user_id)), '[]'::jsonb));
$$;

-- ----------------------------------------------------------------------------
-- 4. Dashboard: what's waiting for me
-- ----------------------------------------------------------------------------
-- Things waiting for me: juniors' join requests (as guardian), join requests in
-- groups I manage, and guardianships offered to me (needs_dob = I must enter
-- the child's date of birth to accept; org_name = groups waiting on my answer).
drop function if exists public.my_pending_requests();
create or replace function public.my_pending_requests()
returns table (kind text, id uuid, org_id uuid, org_name text, user_id uuid, name text, role_label text,
               needs_dob boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select 'junior_join', m.id, o.id, o.name, m.user_id, coalesce(u.full_name, u.public_name), r.label, false, m.created_at
    from memberships m join organisations o on o.id = m.org_id
    join group_roles r on r.key = m.role join users u on u.id = m.user_id
   where m.status = 'awaiting_guardian' and m.invite_id is not null and public.is_active_guardian(m.user_id)
  union all
  select 'member_approval', m.id, o.id, o.name, m.user_id, coalesce(u.full_name, u.public_name), r.label, false, m.created_at
    from memberships m join organisations o on o.id = m.org_id
    join group_roles r on r.key = m.role join users u on u.id = m.user_id
   where m.status = 'pending' and public.can_manage_group(m.org_id)
  union all
  select 'guardianship', lp.id, null,
         (select string_agg(o.name, ', ') from memberships m join organisations o on o.id = m.org_id
           where m.user_id = lp.owner_user_id and m.status = 'awaiting_guardian' and m.invite_id is null),
         lp.owner_user_id, coalesce(u.full_name, u.public_name), 'Guardian',
         not exists (select 1 from user_birthdates b where b.user_id = lp.owner_user_id),
         lp.created_at
    from log_permissions lp join users u on u.id = lp.owner_user_id
   where lp.grantee_user_id = auth.uid() and lp.is_guardian and lp.status = 'pending'
  order by 9;
$$;

-- ----------------------------------------------------------------------------
-- 5. Row Level Security
-- ----------------------------------------------------------------------------
alter table public.user_birthdates enable row level security;
drop policy if exists sz_birthdates_read on public.user_birthdates;
create policy sz_birthdates_read on public.user_birthdates for select to authenticated
  using (user_id = auth.uid() or public.is_active_guardian(user_id));
revoke insert, update, delete on public.user_birthdates from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke insert, update, delete on public.user_birthdates from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.user_birthdates from anon;
  end if;
end $$;

commit;
