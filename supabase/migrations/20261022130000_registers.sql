-- 20261022130000_registers.sql — Registers (phase 1, claude-docs/teams/REGISTERS-PLAN.md)
--
-- Attendance for a training sitting. Decisions: DECISIONS.md, the 2026-10-22 lines.
--
--   registers           one sitting: when, where, open/closed
--   register_groups     the SwimZone groups in it (each can carry a plan later: phase 2)
--   register_entries    one row per athlete per register: expected → in → out (full | partial)
--   register_events     append-only: every tap, with device time and server time (welfare evidence)
--   register_notes      the athlete's own training-log note, kept apart so RLS can hide it from staff
--
-- Rules
--   • Whoever creates a register (or adds a group to it, or closes it) needs take_register in EVERY
--     group on it. Anyone with take_register in one of its groups can tick that group's entries.
--     Staff of any of its groups can read it.
--   • A register only holds active athlete-side members of its groups (trigger, not just the UI).
--     One entry per athlete per register, even if they are in two of its groups.
--   • All writes go through the RPCs below; the tables have read policies only.
--   • Two coaches tapping the same swimmer: every tap is logged; the entry keeps the latest by device time.
--   • Attendance is not a swim: nothing here touches performance_results.
--   • The note is the athlete's (or their guardian's). Staff read it only when share = true.
--
-- Depends on 20261022120000_take_register. Idempotent.

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
create table if not exists public.registers (
  id          uuid primary key default gen_random_uuid(),
  client_uuid uuid unique,                              -- dedup a create sent twice (offline later)
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  venue       text,
  pool_type   text check (pool_type is null or pool_type in ('25SC','50LC','25Y')),
  status      text not null default 'open' check (status in ('open','closed')),
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  closed_by   uuid references public.users(id) on delete set null
);
create index if not exists registers_starts_at_idx on public.registers (starts_at);

create table if not exists public.register_groups (
  id           uuid primary key default gen_random_uuid(),
  register_id  uuid not null references public.registers(id) on delete cascade,
  org_id       uuid not null references public.organisations(id) on delete cascade,
  label        text,                                   -- "Lanes 1–3"
  sort         int  not null default 0,
  plan_title   text,                                   -- phase 2: attached plan
  plan_json    jsonb,                                  -- phase 2: frozen copy of the Set Builder session
  plan_summary jsonb,                                  -- phase 2: { volumeM, durationSec, focus:[type codes], byType:{} }
  cycle_ref    text,                                   -- later: microcycle
  unique (register_id, org_id)
);
create index if not exists register_groups_org_idx on public.register_groups (org_id);

create table if not exists public.register_entries (
  id                uuid primary key default gen_random_uuid(),
  register_id       uuid not null references public.registers(id) on delete cascade,
  register_group_id uuid not null references public.register_groups(id) on delete cascade,
  athlete_user_id   uuid not null references public.users(id) on delete cascade,
  expected          boolean not null default true,     -- from the group list (false = added on the night)
  attendance        text not null default 'expected' check (attendance in ('expected','in','absent','apologies')),
  in_at             timestamptz,
  attendance_at     timestamptz,                       -- device time of the last attendance change
  out_at            timestamptz,
  completion        text check (completion is null or completion in ('full','partial')),
  partial_reason    text check (partial_reason is null or partial_reason in ('left_early','unwell','injured','other')),
  done_m            int  check (done_m is null or done_m >= 0),
  done_pct          int  check (done_pct is null or done_pct between 0 and 100),
  coach_note        text,
  out_state_at      timestamptz,                       -- device time of the last sign-out change
  updated_by        uuid references public.users(id) on delete set null,
  updated_at        timestamptz not null default now(),
  unique (register_id, athlete_user_id),
  constraint register_entries_out_needs_in check (completion is null or attendance = 'in')
);
create index if not exists register_entries_athlete_idx on public.register_entries (athlete_user_id);
create index if not exists register_entries_group_idx on public.register_entries (register_group_id);

create table if not exists public.register_events (
  id          uuid primary key default gen_random_uuid(),
  register_id uuid not null references public.registers(id) on delete cascade,
  entry_id    uuid references public.register_entries(id) on delete cascade,
  event       text not null,                           -- created group_added added in undo_in absent apologies expected
                                                       -- out_full out_partial undo_out closed reopened
  at          timestamptz not null,                    -- device time
  recorded_at timestamptz not null default now(),      -- server time
  by_user_id  uuid references public.users(id) on delete set null,
  detail      jsonb not null default '{}'::jsonb,
  client_uuid uuid unique
);
create index if not exists register_events_register_idx on public.register_events (register_id, recorded_at);

create table if not exists public.register_notes (
  entry_id    uuid primary key references public.register_entries(id) on delete cascade,
  note        text,
  share       boolean not null default false,          -- coaches may read it
  written_by  uuid references public.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. Helpers (SECURITY DEFINER; policies call these, never subquery RLS tables)
-- ----------------------------------------------------------------------------

-- Has take_register in the group of this register group.
create or replace function public.can_take_register_group(p_register_group uuid, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from register_groups g
                  where g.id = p_register_group and public.has_group_capability(g.org_id, 'take_register', p_user));
$$;

-- Runs the whole register: take_register in every one of its groups.
create or replace function public.can_run_register(p_register uuid, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from register_groups where register_id = p_register)
     and not exists (select 1 from register_groups g
                      where g.register_id = p_register
                        and not public.has_group_capability(g.org_id, 'take_register', p_user));
$$;

-- Can see the register: take_register or staff in any of its groups.
create or replace function public.can_see_register(p_register uuid, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from register_groups g
                  where g.register_id = p_register
                    and (public.has_group_capability(g.org_id, 'take_register', p_user)
                         or public.is_group_staff(g.org_id, p_user)));
$$;

-- The athlete themself or their active guardian.
create or replace function public.is_self_or_guardian(p_athlete uuid, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public as $$
  select p_athlete = p_user or public.is_active_guardian(p_athlete, p_user);
$$;

-- How a coach sees a name on the register.
create or replace function public.register_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(full_name), ''), public_name, 'Swimmer') from users where id = p_user;
$$;

-- ----------------------------------------------------------------------------
-- 3. Members only (defence in depth: the RPCs already check)
-- ----------------------------------------------------------------------------
create or replace function public.guard_register_entry() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_reg uuid;
begin
  select org_id, register_id into v_org, v_reg from register_groups where id = new.register_group_id;
  if v_reg is distinct from new.register_id then
    raise exception 'INVALID: entry group is not on that register';
  end if;
  if tg_op = 'INSERT' or new.register_group_id is distinct from old.register_group_id
     or new.athlete_user_id is distinct from old.athlete_user_id then
    if not public.is_group_athlete(v_org, new.athlete_user_id) then
      raise exception 'NOT_A_MEMBER: only active members of the register''s groups can be on it';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_register_entry on public.register_entries;
create trigger trg_guard_register_entry before insert or update on public.register_entries
  for each row execute function public.guard_register_entry();

-- ----------------------------------------------------------------------------
-- 4. RPCs (writes)
-- ----------------------------------------------------------------------------

-- Internal: add a group to a register and fill its expected list (members not already on it).
create or replace function public.register_fill_group(p_register uuid, p_org uuid, p_sort int) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_rg uuid;
begin
  insert into register_groups (register_id, org_id, sort) values (p_register, p_org, p_sort)
  on conflict (register_id, org_id) do nothing
  returning id into v_rg;
  if v_rg is null then
    select id into v_rg from register_groups where register_id = p_register and org_id = p_org;
    return v_rg;
  end if;
  insert into register_entries (register_id, register_group_id, athlete_user_id, expected, updated_by)
  select distinct p_register, v_rg, m.user_id, true, auth.uid()
    from memberships m join group_roles r on r.key = m.role and not r.is_staff
   where m.org_id = p_org and m.status = 'active'
     and not exists (select 1 from register_entries e where e.register_id = p_register and e.athlete_user_id = m.user_id)
  on conflict (register_id, athlete_user_id) do nothing;
  return v_rg;
end $$;
-- Internal only: Supabase grants new functions to anon/authenticated explicitly, so revoke those too.
revoke execute on function public.register_fill_group(uuid, uuid, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.register_fill_group(uuid, uuid, int) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.register_fill_group(uuid, uuid, int) from authenticated;
  end if;
end $$;

-- Start a register with one or more groups. Groups are listed in order; a swimmer in two of them
-- lands in the first. The same client_uuid twice returns the first register.
create or replace function public.create_register(
  p_org_ids uuid[], p_starts_at timestamptz, p_ends_at timestamptz default null,
  p_venue text default null, p_pool_type text default null, p_client_uuid uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_org uuid; i int := 0;
begin
  if v_uid is null then raise exception 'NOT_ALLOWED: sign in first'; end if;
  if p_org_ids is null or cardinality(p_org_ids) = 0 then raise exception 'INVALID: pick at least one group'; end if;
  if p_starts_at is null then raise exception 'INVALID: a start time is required'; end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then raise exception 'INVALID: the end must be after the start'; end if;
  if p_client_uuid is not null then
    select id into v_id from registers where client_uuid = p_client_uuid and created_by = v_uid;
    if v_id is not null then return v_id; end if;
  end if;
  foreach v_org in array p_org_ids loop
    if not public.has_group_capability(v_org, 'take_register', v_uid) then
      raise exception 'NOT_ALLOWED: you cannot take registers for one of those groups';
    end if;
  end loop;

  insert into registers (client_uuid, starts_at, ends_at, venue, pool_type, created_by)
  values (p_client_uuid, p_starts_at, p_ends_at, nullif(btrim(p_venue), ''), p_pool_type, v_uid)
  returning id into v_id;
  foreach v_org in array p_org_ids loop
    i := i + 1;
    perform public.register_fill_group(v_id, v_org, i);
  end loop;
  insert into register_events (register_id, event, at, by_user_id, detail)
  values (v_id, 'created', now(), v_uid, jsonb_build_object('org_ids', to_jsonb(p_org_ids)));
  return v_id;
end $$;

-- Add another group to an open register (needs take_register in every group, including the new one).
create or replace function public.add_register_group(p_register uuid, p_org uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_rg uuid;
begin
  if not public.can_run_register(p_register) or not public.has_group_capability(p_org, 'take_register') then
    raise exception 'NOT_ALLOWED: you need take_register in every group on the register';
  end if;
  if (select status from registers where id = p_register) <> 'open' then raise exception 'CLOSED: the register is closed'; end if;
  v_rg := public.register_fill_group(p_register, p_org,
            coalesce((select max(sort) from register_groups where register_id = p_register), 0) + 1);
  insert into register_events (register_id, event, at, by_user_id, detail)
  values (p_register, 'group_added', now(), auth.uid(), jsonb_build_object('org_id', p_org));
  return v_rg;
end $$;

-- Put a member of the group on the register who wasn't on the list (e.g. joined the group since).
create or replace function public.add_register_entry(p_register_group uuid, p_athlete uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_reg uuid; v_org uuid; v_id uuid;
begin
  select register_id, org_id into v_reg, v_org from register_groups where id = p_register_group;
  if v_reg is null or not public.can_take_register_group(p_register_group) then
    raise exception 'NOT_ALLOWED: you cannot take this group''s register';
  end if;
  if not public.is_group_athlete(v_org, p_athlete) then
    raise exception 'NOT_A_MEMBER: only active members of the register''s groups can be on it';
  end if;
  select id into v_id from register_entries where register_id = v_reg and athlete_user_id = p_athlete;
  if v_id is not null then return v_id; end if;            -- already on (maybe under another group)
  insert into register_entries (register_id, register_group_id, athlete_user_id, expected, updated_by)
  values (v_reg, p_register_group, p_athlete, false, auth.uid())
  returning id into v_id;
  insert into register_events (register_id, entry_id, event, at, by_user_id)
  values (v_reg, v_id, 'added', now(), auth.uid());
  return v_id;
end $$;

-- One tap. p_action:
--   in · undo_in · absent · apologies · expected       (attendance)
--   out_full · out_partial · undo_out                  (sign-out; needs 'in')
-- p_detail for out_partial: { reason: left_early|unwell|injured|other, done_m, done_pct, note }
-- p_at is the device time of the tap. Every tap is logged; the entry only moves if p_at is not
-- older than the last change of the same kind (two coaches, latest wins). Same client_uuid twice = no-op.
-- Returns the entry as it now stands (jsonb).
drop function if exists public.mark_register_entry(uuid, text, timestamptz, jsonb, uuid);
create or replace function public.mark_register_entry(
  p_entry uuid, p_action text, p_at timestamptz default null,
  p_detail jsonb default '{}'::jsonb, p_client_uuid uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e register_entries%rowtype;
  v_at timestamptz := coalesce(p_at, now());
  v_reason text; v_dm int; v_dp int;
begin
  select * into e from register_entries where id = p_entry;
  if not found then raise exception 'NOT_FOUND: no such register entry'; end if;
  if not public.can_take_register_group(e.register_group_id) then
    raise exception 'NOT_ALLOWED: you cannot take this group''s register';
  end if;
  if p_client_uuid is not null and exists (select 1 from register_events where client_uuid = p_client_uuid) then
    return to_jsonb(e);
  end if;
  if p_action not in ('in','undo_in','absent','apologies','expected','out_full','out_partial','undo_out') then
    raise exception 'INVALID: unknown register action %', p_action;
  end if;
  p_detail := coalesce(p_detail, '{}'::jsonb);
  if v_at > now() + interval '10 minutes' then v_at := now(); end if;   -- a device clock far ahead

  insert into register_events (register_id, entry_id, event, at, by_user_id, detail, client_uuid)
  values (e.register_id, e.id, p_action, v_at, auth.uid(), p_detail, p_client_uuid);

  if p_action in ('in','undo_in','absent','apologies','expected') then
    if e.attendance_at is not null and v_at < e.attendance_at then return to_jsonb(e); end if;   -- a newer tap already won
    if p_action <> 'in' and e.completion is not null then
      raise exception 'SIGNED_OUT: undo the sign-out first';
    end if;
    update register_entries
       set attendance = case p_action when 'in' then 'in' when 'undo_in' then 'expected' else p_action end,
           in_at = case when p_action = 'in' then coalesce(case when e.attendance = 'in' then e.in_at end, v_at) end,
           attendance_at = v_at, updated_by = auth.uid(), updated_at = now()
     where id = e.id returning * into e;
  else
    if e.out_state_at is not null and v_at < e.out_state_at then return to_jsonb(e); end if;
    if p_action <> 'undo_out' and e.attendance <> 'in' then
      raise exception 'NOT_IN: tick them in before signing them out';
    end if;
    if p_action = 'out_partial' then
      v_reason := p_detail->>'reason';
      if v_reason is null or v_reason not in ('left_early','unwell','injured','other') then
        raise exception 'INVALID: a partial sign-out needs a reason (left_early, unwell, injured, other)';
      end if;
      v_dm := nullif(p_detail->>'done_m', '')::int;
      v_dp := nullif(p_detail->>'done_pct', '')::int;
    end if;
    update register_entries
       set completion     = case p_action when 'out_full' then 'full' when 'out_partial' then 'partial' end,
           out_at         = case when p_action = 'undo_out' then null else v_at end,
           partial_reason = case when p_action = 'out_partial' then v_reason end,
           done_m         = case when p_action = 'out_partial' then v_dm end,
           done_pct       = case when p_action = 'out_partial' then v_dp end,
           coach_note     = case when p_action = 'out_partial' then nullif(btrim(p_detail->>'note'), '') else e.coach_note end,
           out_state_at = v_at, updated_by = auth.uid(), updated_at = now()
     where id = e.id returning * into e;
  end if;
  return to_jsonb(e);
end $$;

-- "Sign everyone still in out — full session": every entry that is in and not yet out, in the
-- groups the caller can take. Partial sign-outs are left alone. Returns how many were signed out.
create or replace function public.sign_out_all(p_register uuid, p_at timestamptz default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz := least(coalesce(p_at, now()), now() + interval '10 minutes'); n int := 0; r record;
begin
  if not public.can_see_register(p_register) then raise exception 'NOT_ALLOWED: you cannot take this register'; end if;
  for r in select e.id from register_entries e
            where e.register_id = p_register and e.attendance = 'in' and e.completion is null
              and public.can_take_register_group(e.register_group_id)
  loop
    insert into register_events (register_id, entry_id, event, at, by_user_id, detail)
    values (p_register, r.id, 'out_full', v_at, auth.uid(), '{"bulk":true}'::jsonb);
    update register_entries set completion = 'full', out_at = v_at, out_state_at = v_at,
           updated_by = auth.uid(), updated_at = now()
     where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Close. Refuses while anyone is in but not out, unless p_force (the coach has checked).
create or replace function public.close_register(p_register uuid, p_force boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.can_run_register(p_register) then
    raise exception 'NOT_ALLOWED: you need take_register in every group on the register';
  end if;
  select count(*) into n from register_entries
   where register_id = p_register and attendance = 'in' and completion is null;
  if n > 0 and not coalesce(p_force, false) then
    raise exception 'STILL_IN: % swimmer(s) ticked in but not signed out', n;
  end if;
  update registers set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where id = p_register and status = 'open';
  insert into register_events (register_id, event, at, by_user_id, detail)
  values (p_register, 'closed', now(), auth.uid(), jsonb_build_object('still_in', n, 'forced', n > 0));
end $$;

create or replace function public.reopen_register(p_register uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_run_register(p_register) then
    raise exception 'NOT_ALLOWED: you need take_register in every group on the register';
  end if;
  update registers set status = 'open', closed_at = null, closed_by = null where id = p_register and status = 'closed';
  insert into register_events (register_id, event, at, by_user_id) values (p_register, 'reopened', now(), auth.uid());
end $$;

-- The athlete's (or guardian's) training-log note on one entry.
create or replace function public.set_register_note(p_entry uuid, p_note text, p_share boolean default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_athlete uuid;
begin
  select athlete_user_id into v_athlete from register_entries where id = p_entry;
  if v_athlete is null then raise exception 'NOT_FOUND: no such register entry'; end if;
  if not public.is_self_or_guardian(v_athlete) then
    raise exception 'NOT_ALLOWED: only the swimmer or their guardian can write this note';
  end if;
  insert into register_notes (entry_id, note, share, written_by, updated_at)
  values (p_entry, nullif(btrim(p_note), ''), coalesce(p_share, false), auth.uid(), now())
  on conflict (entry_id) do update
     set note = excluded.note, share = coalesce(p_share, register_notes.share),
         written_by = excluded.written_by, updated_at = now();
end $$;

-- ----------------------------------------------------------------------------
-- 5. Reads for the app (one call per screen; only what the caller may see)
-- ----------------------------------------------------------------------------

-- Registers I can see between two times, newest first, with counts.
create or replace function public.my_registers(p_from timestamptz default null, p_to timestamptz default null)
returns table (register_id uuid, starts_at timestamptz, ends_at timestamptz, venue text, pool_type text,
               status text, org_ids uuid[], group_names text[], can_run boolean,
               expected int, in_count int, out_count int, still_in int)
language sql stable security definer set search_path = public as $$
  select r.id, r.starts_at, r.ends_at, r.venue, r.pool_type, r.status,
         (select array_agg(g.org_id order by g.sort) from register_groups g where g.register_id = r.id),
         (select array_agg(o.name order by g.sort) from register_groups g join organisations o on o.id = g.org_id
           where g.register_id = r.id),
         public.can_run_register(r.id),
         (select count(*)::int from register_entries e where e.register_id = r.id),
         (select count(*)::int from register_entries e where e.register_id = r.id and e.attendance = 'in'),
         (select count(*)::int from register_entries e where e.register_id = r.id and e.completion is not null),
         (select count(*)::int from register_entries e where e.register_id = r.id and e.attendance = 'in' and e.completion is null)
    from registers r
   where public.can_see_register(r.id)
     and (p_from is null or r.starts_at >= p_from)
     and (p_to   is null or r.starts_at <  p_to)
   order by r.starts_at desc
   limit 200;
$$;

-- Everything the coach screen needs for one register.
create or replace function public.register_sheet(p_register uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r registers%rowtype;
begin
  if not public.can_see_register(p_register) then raise exception 'NOT_ALLOWED: you cannot see this register'; end if;
  select * into r from registers where id = p_register;
  return jsonb_build_object(
    'register', jsonb_build_object('id', r.id, 'starts_at', r.starts_at, 'ends_at', r.ends_at, 'venue', r.venue,
                                   'pool_type', r.pool_type, 'status', r.status, 'closed_at', r.closed_at,
                                   'created_by_name', public.register_name(r.created_by),
                                   'can_run', public.can_run_register(r.id)),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'org_id', g.org_id, 'name', o.name, 'label', g.label, 'sort', g.sort,
               'plan_title', g.plan_title, 'plan_summary', g.plan_summary,
               'can_take', public.can_take_register_group(g.id)) order by g.sort)
        from register_groups g join organisations o on o.id = g.org_id
       where g.register_id = r.id), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'register_group_id', e.register_group_id, 'athlete_user_id', e.athlete_user_id,
               'name', public.register_name(e.athlete_user_id), 'is_junior', public.is_junior(e.athlete_user_id),
               'expected', e.expected, 'attendance', e.attendance, 'in_at', e.in_at, 'out_at', e.out_at,
               'completion', e.completion, 'partial_reason', e.partial_reason, 'done_m', e.done_m,
               'done_pct', e.done_pct, 'coach_note', e.coach_note,
               'updated_by_name', public.register_name(e.updated_by), 'updated_at', e.updated_at,
               'athlete_note', case when n.share then n.note end)
             order by public.register_name(e.athlete_user_id))
        from register_entries e left join register_notes n on n.entry_id = e.id
       where e.register_id = r.id), '[]'::jsonb));
end $$;

-- Members of a register group who aren't on the register yet ("Add a swimmer from these groups").
create or replace function public.register_candidates(p_register_group uuid)
returns table (athlete_user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select distinct m.user_id, public.register_name(m.user_id)
    from register_groups g
    join memberships m on m.org_id = g.org_id and m.status = 'active'
    join group_roles r on r.key = m.role and not r.is_staff
   where g.id = p_register_group and public.can_take_register_group(g.id)
     and not exists (select 1 from register_entries e where e.register_id = g.register_id and e.athlete_user_id = m.user_id)
   order by 2;
$$;

-- An athlete's own attendance (or their junior's, for a guardian). No coach note.
create or replace function public.my_register_entries(p_athlete uuid default auth.uid(),
                                                       p_from timestamptz default null, p_to timestamptz default null)
returns table (entry_id uuid, register_id uuid, starts_at timestamptz, venue text, group_name text,
               attendance text, in_at timestamptz, out_at timestamptz, completion text, partial_reason text,
               done_m int, done_pct int, plan_title text, plan_summary jsonb, note text, share boolean)
language sql stable security definer set search_path = public as $$
  select e.id, r.id, r.starts_at, r.venue, o.name, e.attendance, e.in_at, e.out_at, e.completion,
         e.partial_reason, e.done_m, e.done_pct, g.plan_title, g.plan_summary, n.note, coalesce(n.share, false)
    from register_entries e
    join registers r       on r.id = e.register_id
    join register_groups g on g.id = e.register_group_id
    join organisations o   on o.id = g.org_id
    left join register_notes n on n.entry_id = e.id
   where e.athlete_user_id = p_athlete and public.is_self_or_guardian(p_athlete)
     and (p_from is null or r.starts_at >= p_from)
     and (p_to   is null or r.starts_at <  p_to)
   order by r.starts_at desc;
$$;

-- ----------------------------------------------------------------------------
-- 6. RLS: read policies only; every write is an RPC above
-- ----------------------------------------------------------------------------
alter table public.registers        enable row level security;
alter table public.register_groups  enable row level security;
alter table public.register_entries enable row level security;
alter table public.register_events  enable row level security;
alter table public.register_notes   enable row level security;

drop policy if exists sz_registers_read on public.registers;
create policy sz_registers_read on public.registers for select to authenticated
  using (public.can_see_register(id));

drop policy if exists sz_register_groups_read on public.register_groups;
create policy sz_register_groups_read on public.register_groups for select to authenticated
  using (public.can_see_register(register_id));

drop policy if exists sz_register_entries_read on public.register_entries;
create policy sz_register_entries_read on public.register_entries for select to authenticated
  using (public.can_see_register(register_id));

drop policy if exists sz_register_events_read on public.register_events;
create policy sz_register_events_read on public.register_events for select to authenticated
  using (public.can_see_register(register_id));

-- Notes: the swimmer and their guardian; staff only when shared. Needs the entry's athlete and register,
-- read through a helper so the policy never subqueries an RLS table.
create or replace function public.can_read_register_note(p_entry uuid, p_share boolean, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from register_entries e
                  where e.id = p_entry
                    and (public.is_self_or_guardian(e.athlete_user_id, p_user)
                         or (p_share and public.can_see_register(e.register_id, p_user))));
$$;
drop policy if exists sz_register_notes_read on public.register_notes;
create policy sz_register_notes_read on public.register_notes for select to authenticated
  using (public.can_read_register_note(entry_id, share));
