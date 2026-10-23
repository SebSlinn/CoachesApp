-- 20261023120000_register_summaries.sql — Registers: session summaries, volumes, tests in the training log.
-- (claude-docs/teams/REGISTERS.md "Summaries and volume"; DECISIONS 2026-10-23.)
--
-- Storage stays small: a session summary is stored ONCE per group per register (register_groups),
-- never copied onto each swimmer. A swimmer gets their own figure only when someone changes it:
--   the coach's figure for them        register_entries.done_m (set_entry_volume, or a partial sign-out)
--   the athlete's own figure           register_notes.my_volume_m / my_breakdown (set_my_session_summary)
--
-- Volume for one swimmer on one session (entry_volume):
--   their own figure  →  the coach's figure for them  →  the session volume × % (a partial with a %)
--   →  the session volume (anyone who attended: C, P, I)  →  nothing.
-- A P with no figure shows the full session volume; nobody has to type anything.
--
-- Tests are part of the session, not extra volume: a Poolside test/set is matched to the register the
-- swimmer was on when its first rep started (Europe/London; 30 min either side; no end time → 3 h;
-- a register already started wins a tie, then the nearest start),
-- or, with no rep times, to their only register that day. Session total = greatest(session volume,
-- test volume); the test is shown as "of which". Tests outside any register are their own timeline line.
-- Nothing is stored for the match: it's worked out when the log is read (swims stay evidence).
--
-- Depends on 20261022150000_register_scan_guests. Idempotent.

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
-- Matching tests to sessions reads rep start times (added by 20261009150000_rep_start_times, Tests).
-- Some databases skipped that file; add the column here too so this one can't fail. Run that file as
-- well: it also adds fill_rep_start_times(), which Poolside re-imports use.
alter table public.performance_results add column if not exists started_at timestamptz;

alter table public.register_groups add column if not exists summary_text text;
alter table public.register_groups add column if not exists volume_m int;
alter table public.register_groups add column if not exists breakdown jsonb;      -- { "AT": 2000, "No1": 1600 }
alter table public.register_groups add column if not exists summary_by uuid references public.users(id) on delete set null;
alter table public.register_groups add column if not exists summary_at timestamptz;
alter table public.register_notes  add column if not exists my_volume_m int;
alter table public.register_notes  add column if not exists my_breakdown jsonb;
alter table public.register_notes  alter column note drop not null;

-- ----------------------------------------------------------------------------
-- 2. Small checks
-- ----------------------------------------------------------------------------
-- A breakdown: at most 12 labels (letters/digits/spaces, ≤ 12 chars), whole metres 0–50000. → cleaned, or null if empty.
create or replace function public.clean_breakdown(p jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; v jsonb; out jsonb := '{}'::jsonb; n int := 0;
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'INVALID: the breakdown must be label → metres'; end if;
  for k, v in select * from jsonb_each(p) loop
    if btrim(k) = '' then continue; end if;
    if btrim(k) !~ '^[A-Za-z0-9 ]{1,12}$' then raise exception 'INVALID: breakdown label "%" (letters and numbers, up to 12)', k; end if;
    if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric) or (v::text)::numeric < 0 or (v::text)::numeric > 50000 then
      raise exception 'INVALID: % must be whole metres, 0–50000', k;
    end if;
    n := n + 1;
    if n > 12 then raise exception 'INVALID: at most 12 breakdown figures'; end if;
    out := out || jsonb_build_object(btrim(k), (v::text)::int);
  end loop;
  return nullif(out, '{}'::jsonb);
end $$;

create or replace function public.check_volume(p int) returns int
language plpgsql immutable as $$
begin
  if p is not null and (p < 0 or p > 50000) then raise exception 'INVALID: volume must be 0–50000 m'; end if;
  return p;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Writing summaries
-- ----------------------------------------------------------------------------
-- The coach's summary for one group on one register (before or after the session). Empty text and
-- null volume/breakdown clear them.
create or replace function public.set_session_summary(p_register_group uuid, p_text text, p_volume_m int default null,
                                                      p_breakdown jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_reg uuid;
begin
  select register_id into v_reg from register_groups where id = p_register_group;
  if v_reg is null or not public.can_take_register_group(p_register_group) then
    raise exception 'NOT_ALLOWED: you cannot take this group''s register';
  end if;
  update register_groups
     set summary_text = left(nullif(btrim(p_text), ''), 300), volume_m = public.check_volume(p_volume_m),
         breakdown = public.clean_breakdown(p_breakdown), summary_by = auth.uid(), summary_at = now()
   where id = p_register_group;
  insert into register_events (register_id, event, at, by_user_id, detail)
  values (v_reg, 'summary', now(), auth.uid(),
          jsonb_build_object('register_group_id', p_register_group, 'volume_m', p_volume_m, 'text', left(nullif(btrim(p_text), ''), 300)));
end $$;

-- The coach's figure for one swimmer (null = back to the session's). Logged.
create or replace function public.set_entry_volume(p_entry uuid, p_volume_m int) returns void
language plpgsql security definer set search_path = public as $$
declare e register_entries%rowtype;
begin
  select * into e from register_entries where id = p_entry;
  if not found then raise exception 'NOT_FOUND: no such register entry'; end if;
  if not public.can_take_register_group(e.register_group_id) then raise exception 'NOT_ALLOWED: you cannot take this group''s register'; end if;
  update register_entries set done_m = public.check_volume(p_volume_m), updated_by = auth.uid(), updated_at = now() where id = p_entry;
  insert into register_events (register_id, entry_id, event, at, by_user_id, detail)
  values (e.register_id, e.id, 'volume', now(), auth.uid(), jsonb_build_object('volume_m', p_volume_m));
end $$;

-- The swimmer's (or guardian's) own figure for their session. Null volume and breakdown clear it.
create or replace function public.set_my_session_summary(p_entry uuid, p_volume_m int, p_breakdown jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_athlete uuid; v_reg uuid;
begin
  select athlete_user_id, register_id into v_athlete, v_reg from register_entries where id = p_entry;
  if v_athlete is null then raise exception 'NOT_FOUND: no such register entry'; end if;
  if not public.is_self_or_guardian(v_athlete) then raise exception 'NOT_ALLOWED: only the swimmer or their guardian can change this'; end if;
  insert into register_notes (entry_id, note, share, written_by, updated_at, my_volume_m, my_breakdown)
  values (p_entry, null, false, auth.uid(), now(), public.check_volume(p_volume_m), public.clean_breakdown(p_breakdown))
  on conflict (entry_id) do update
     set my_volume_m = excluded.my_volume_m, my_breakdown = excluded.my_breakdown, written_by = auth.uid(), updated_at = now();
  insert into register_events (register_id, entry_id, event, at, by_user_id, detail)
  values (v_reg, p_entry, 'my_summary', now(), auth.uid(), jsonb_build_object('volume_m', p_volume_m));
end $$;

-- ----------------------------------------------------------------------------
-- 4. Reading: one swimmer's volume, the letter, matched tests
-- ----------------------------------------------------------------------------
-- → { m, src: mine | coach | session_pct | session | null, breakdown }
create or replace function public.entry_volume(p_entry uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case
           when n.my_volume_m is not null then jsonb_build_object('m', n.my_volume_m, 'src', 'mine')
           when e.done_m is not null then jsonb_build_object('m', e.done_m, 'src', 'coach')
           when e.completion = 'partial' and e.done_pct is not null and g.volume_m is not null
             then jsonb_build_object('m', round(g.volume_m * e.done_pct / 100.0)::int, 'src', 'session_pct')
           when e.attendance = 'in' and g.volume_m is not null then jsonb_build_object('m', g.volume_m, 'src', 'session')
           else jsonb_build_object('m', null, 'src', null) end
         || jsonb_build_object('breakdown', coalesce(n.my_breakdown, g.breakdown))
    from register_entries e
    join register_groups g on g.id = e.register_group_id
    left join register_notes n on n.entry_id = e.id
   where e.id = p_entry;
$$;

create or replace function public.entry_code(p_attendance text, p_completion text, p_register_status text) returns text
language sql immutable as $$
  select case when p_completion = 'full' then 'C' when p_completion = 'partial' then 'P'
              when p_attendance = 'in' then 'I' when p_attendance = 'apologies' then 'Ap'
              when p_attendance = 'absent' then 'A' when p_register_status = 'closed' then 'A' else 'E' end;
$$;

-- An athlete's Poolside sets/tests in a window, each with the register entry it belongs to (or null).
-- Internal: callers check who may see them.
create or replace function public.athlete_efforts_matched(p_athlete uuid, p_from date, p_to date)
returns table (effort_id uuid, swum_on date, first_at timestamptz, name text, protocol_id uuid, reps int, volume_m int, entry_id uuid)
language sql stable security definer set search_path = public as $$
  with ef as (
    select se.id, se.swum_on, se.protocol_id,
           coalesce(tp.name, se.set_json->>'name', 'Set') as name,
           (select min(pr.started_at) from performance_results pr where pr.effort_id = se.id) as first_at,
           (select count(*)::int from performance_results pr where pr.effort_id = se.id) as reps,
           (select coalesce(sum(pr.dist_m), 0)::int from performance_results pr where pr.effort_id = se.id) as vol
      from set_efforts se left join test_protocols tp on tp.id = se.protocol_id
     where se.athlete_user_id = p_athlete and se.swum_on between p_from and p_to
  ), mine as (
    select e.id, r.starts_at, r.ends_at, (r.starts_at at time zone 'Europe/London')::date as day
      from register_entries e join registers r on r.id = e.register_id
     where e.athlete_user_id = p_athlete
       and (r.starts_at at time zone 'Europe/London')::date between p_from and p_to
  )
  select ef.id, ef.swum_on, ef.first_at, ef.name, ef.protocol_id, ef.reps, ef.vol,
         case when ef.first_at is not null then
                (select m.id from mine m
                  where ef.first_at between m.starts_at - interval '30 minutes'
                                        and coalesce(m.ends_at, m.starts_at + interval '3 hours') + interval '30 minutes'
                  order by (ef.first_at < m.starts_at), abs(extract(epoch from ef.first_at - m.starts_at)) limit 1)
              else
                (select min(m.id::text)::uuid from mine m where m.day = ef.swum_on
                  having count(*) = 1)
         end
    from ef;
$$;
revoke execute on function public.athlete_efforts_matched(uuid, date, date) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.athlete_efforts_matched(uuid, date, date) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.athlete_efforts_matched(uuid, date, date) from authenticated;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. The athlete's timeline (self or guardian)
-- ----------------------------------------------------------------------------
-- One row per register they were on (tests that belong to it nested), plus one per test outside any
-- register. Newest first. → [{ kind: session|test, at, … }]
create or replace function public.athlete_training_log(p_athlete uuid default auth.uid(),
                                                        p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from date; v_to date; v jsonb;
begin
  if p_athlete is null or not public.is_self_or_guardian(p_athlete) then raise exception 'NOT_ALLOWED: not your log'; end if;
  v_from := coalesce((p_from at time zone 'Europe/London')::date, date '2000-01-01');
  v_to   := coalesce((p_to   at time zone 'Europe/London')::date, date '2999-12-31');
  with ef as (select * from public.athlete_efforts_matched(p_athlete, v_from, v_to)),
  rows as (
    select jsonb_build_object(
             'kind', 'session', 'at', r.starts_at, 'ends_at', r.ends_at, 'entry_id', e.id, 'register_id', r.id,
             'venue', r.venue, 'group_name', o.name, 'entry_kind', e.kind,
             'code', public.entry_code(e.attendance, e.completion, r.status),
             'attendance', e.attendance, 'completion', e.completion, 'partial_reason', e.partial_reason,
             'in_at', e.in_at, 'out_at', e.out_at, 'done_m', e.done_m, 'done_pct', e.done_pct,
             'session', jsonb_build_object('text', g.summary_text, 'volume_m', g.volume_m, 'breakdown', g.breakdown, 'plan_title', g.plan_title),
             'mine', jsonb_build_object('volume_m', n.my_volume_m, 'breakdown', n.my_breakdown),
             'volume', public.entry_volume(e.id),
             'tests', coalesce((select jsonb_agg(jsonb_build_object('effort_id', t.effort_id, 'name', t.name, 'protocol_id', t.protocol_id,
                                                               'reps', t.reps, 'volume_m', t.volume_m) order by t.first_at nulls last)
                                  from ef t where t.entry_id = e.id), '[]'::jsonb),
             'test_volume_m', (select coalesce(sum(t.volume_m), 0) from ef t where t.entry_id = e.id),
             'note', n.note, 'share', coalesce(n.share, false)) as x
      from register_entries e
      join registers r on r.id = e.register_id
      join register_groups g on g.id = e.register_group_id
      join organisations o on o.id = g.org_id
      left join register_notes n on n.entry_id = e.id
     where e.athlete_user_id = p_athlete
       and (p_from is null or r.starts_at >= p_from) and (p_to is null or r.starts_at < p_to)
    union all
    select jsonb_build_object('kind', 'test', 'at', coalesce(t.first_at, t.swum_on::timestamptz), 'effort_id', t.effort_id,
                              'name', t.name, 'protocol_id', t.protocol_id, 'reps', t.reps, 'volume_m', t.volume_m, 'swum_on', t.swum_on)
      from ef t where t.entry_id is null
  )
  select coalesce(jsonb_agg(x order by (x->>'at') desc), '[]'::jsonb) into v from rows;
  return v;
end $$;

-- ----------------------------------------------------------------------------
-- 6. The coach's drill-down for one grid cell
-- ----------------------------------------------------------------------------
-- Tests only for someone who can read that swimmer's results; the athlete's note only if shared.
create or replace function public.register_cell_detail(p_entry uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e register_entries%rowtype; r registers%rowtype; g register_groups%rowtype; n register_notes%rowtype;
        v_tests jsonb := null; v_day date;
begin
  select * into e from register_entries where id = p_entry;
  if not found then raise exception 'NOT_FOUND: no such register entry'; end if;
  if not public.can_see_register(e.register_id) then raise exception 'NOT_ALLOWED: you cannot see this register'; end if;
  select * into r from registers where id = e.register_id;
  select * into g from register_groups where id = e.register_group_id;
  select * into n from register_notes where entry_id = e.id;
  if e.athlete_user_id is not null and public.has_log_access(e.athlete_user_id, 'read') then
    v_day := (r.starts_at at time zone 'Europe/London')::date;
    select coalesce(jsonb_agg(jsonb_build_object('effort_id', t.effort_id, 'name', t.name, 'reps', t.reps, 'volume_m', t.volume_m)), '[]'::jsonb)
      into v_tests from public.athlete_efforts_matched(e.athlete_user_id, v_day, v_day) t where t.entry_id = e.id;
  end if;
  return jsonb_build_object(
    'entry_id', e.id, 'register_id', r.id, 'starts_at', r.starts_at, 'ends_at', r.ends_at, 'venue', r.venue,
    'status', r.status, 'register_comment', r.comment,
    'name', coalesce(e.guest_name, public.register_name(e.athlete_user_id)), 'kind', e.kind,
    'code', public.entry_code(e.attendance, e.completion, r.status),
    'in_at', e.in_at, 'out_at', e.out_at, 'partial_reason', e.partial_reason, 'done_m', e.done_m, 'done_pct', e.done_pct,
    'coach_note', e.coach_note,
    'session', jsonb_build_object('text', g.summary_text, 'volume_m', g.volume_m, 'breakdown', g.breakdown, 'plan_title', g.plan_title),
    'mine', jsonb_build_object('volume_m', n.my_volume_m, 'breakdown', n.my_breakdown),
    'volume', public.entry_volume(e.id),
    'athlete_note', case when n.share then n.note end,
    'tests', v_tests,                      -- null = you can't read this swimmer's results
    'can_take', public.can_take_register_group(e.register_group_id));
end $$;

-- ----------------------------------------------------------------------------
-- 7. The sheet carries the group summary
-- ----------------------------------------------------------------------------
create or replace function public.register_sheet(p_register uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r registers%rowtype;
begin
  if not public.can_see_register(p_register) then raise exception 'NOT_ALLOWED: you cannot see this register'; end if;
  select * into r from registers where id = p_register;
  return jsonb_build_object(
    'register', jsonb_build_object('id', r.id, 'starts_at', r.starts_at, 'ends_at', r.ends_at, 'venue', r.venue,
                                   'pool_type', r.pool_type, 'status', r.status, 'closed_at', r.closed_at,
                                   'comment', r.comment,
                                   'created_by_name', public.register_name(r.created_by),
                                   'can_run', public.can_run_register(r.id)),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'org_id', g.org_id, 'name', o.name, 'label', g.label, 'sort', g.sort,
               'plan_title', g.plan_title, 'plan_summary', g.plan_summary,
               'summary_text', g.summary_text, 'volume_m', g.volume_m, 'breakdown', g.breakdown,
               'can_take', public.can_take_register_group(g.id)) order by g.sort)
        from register_groups g join organisations o on o.id = g.org_id
       where g.register_id = r.id), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'register_group_id', e.register_group_id, 'athlete_user_id', e.athlete_user_id,
               'person_key', coalesce(e.athlete_user_id::text, 'guest:' || coalesce(e.client_uuid, e.id)::text),
               'kind', e.kind,
               'name', coalesce(e.guest_name, public.register_name(e.athlete_user_id)),
               'is_junior', case when e.athlete_user_id is null then false else public.is_junior(e.athlete_user_id) end,
               'expected', e.expected, 'attendance', e.attendance, 'in_at', e.in_at, 'out_at', e.out_at,
               'attendance_at', e.attendance_at, 'out_state_at', e.out_state_at,
               'completion', e.completion, 'partial_reason', e.partial_reason, 'done_m', e.done_m,
               'done_pct', e.done_pct, 'coach_note', e.coach_note,
               'updated_by_name', public.register_name(e.updated_by), 'updated_at', e.updated_at,
               'athlete_note', case when n.share then n.note end)
             order by coalesce(e.guest_name, public.register_name(e.athlete_user_id)))
        from register_entries e left join register_notes n on n.entry_id = e.id
       where e.register_id = r.id), '[]'::jsonb));
end $$;

-- ----------------------------------------------------------------------------
-- 8. The grid gets volumes ("C 5500") and entry ids for the drill-down
-- ----------------------------------------------------------------------------
create or replace function public.group_attendance(p_org uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (public.has_group_capability(p_org, 'take_register') or public.is_group_staff(p_org)) then
    raise exception 'NOT_ALLOWED: you don''t take registers or coach this group';
  end if;
  with regs as (
    select r.id, r.starts_at, r.ends_at, r.venue, r.status, g.id as rg_id, g.volume_m, g.summary_text
      from registers r join register_groups g on g.register_id = r.id and g.org_id = p_org
     where r.starts_at >= p_from and r.starts_at < p_to
  ), people as (
    select distinct m.user_id, true as member
      from memberships m join group_roles gr on gr.key = m.role and not gr.is_staff
     where m.org_id = p_org and m.status = 'active'
    union
    select distinct e.athlete_user_id, false
      from register_entries e join regs on regs.rg_id = e.register_group_id
     where e.athlete_user_id is not null
  ), people1 as (
    select user_id, bool_or(member) as member from people group by user_id
  ), cells as (
    select p.user_id, regs.id as reg_id, e.id as entry_id,
           case when e.id is null then 'N' else public.entry_code(e.attendance, e.completion, regs.status) end as code,
           case when e.id is null then null else (public.entry_volume(e.id)->>'m')::int end as m
      from people1 p cross join regs
      left join register_entries e on e.register_id = regs.id and e.athlete_user_id = p.user_id
  )
  select jsonb_build_object(
    'org_id', p_org, 'from', p_from, 'to', p_to,
    'registers', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'starts_at', starts_at, 'ends_at', ends_at,
                    'venue', venue, 'status', status, 'volume_m', volume_m, 'summary_text', summary_text,
                    'guests', (select count(*) from register_entries ge where ge.register_id = regs.id and ge.kind = 'guest' and ge.attendance = 'in'))
                  order by starts_at) from regs), '[]'::jsonb),
    'athletes', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', public.register_name(p.user_id),
                    'is_junior', public.is_junior(p.user_id), 'member', p.member,
                    'cells',   (select coalesce(jsonb_object_agg(c.reg_id, c.code), '{}'::jsonb) from cells c where c.user_id = p.user_id),
                    'vols',    (select coalesce(jsonb_object_agg(c.reg_id, c.m), '{}'::jsonb) from cells c where c.user_id = p.user_id and c.m is not null),
                    'entries', (select coalesce(jsonb_object_agg(c.reg_id, c.entry_id), '{}'::jsonb) from cells c where c.user_id = p.user_id and c.entry_id is not null),
                    'total_m', (select coalesce(sum(c.m), 0) from cells c where c.user_id = p.user_id))
                  order by public.register_name(p.user_id)) from people1 p), '[]'::jsonb))
  into v;
  return v;
end $$;
