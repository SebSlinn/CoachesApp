-- 20261022150000_register_scan_guests.sql — Registers: scanning, visitors, guests, comments, the
-- attendance grid. (claude-docs/teams/REGISTERS.md; DECISIONS 2026-10-22, the later lines.)
--
--   register_cards       codes that identify a person at the door: their SwimZone QR, or a barcode /
--                        RFID card linked to them. A reader that types like a keyboard, or the phone
--                        camera reading a QR, gives the register a code; scan_register does the rest.
--   scan_register        code → person → tick in; a second scan 10+ min later signs them out (full);
--                        a repeat inside 10 min is ignored. Someone on SwimZone who isn't in the
--                        register's groups is added as a VISITOR: presenting their own code is the
--                        consent. The coach sees their attendance on that register, nothing else.
--   guests               a typed name only (trial swimmer, someone not on SwimZone). Nothing else
--                        stored; never on anyone's training record. Works offline (sync_register).
--   comments             registers.comment (the session) and set_entry_comment (one swimmer).
--   group_attendance     whole group × a date range: C complete · P partial · I in, not signed out ·
--                        A absent (incl. no-show on a closed register) · Ap apologies · E expected
--                        (register still open) · N not booked.
--
-- Supersedes the 2026-10-22 rule "a register contains only members of its groups": members are still
-- the expected list; visitors come only by scanning their own code; guests are names.
-- Depends on 20261022140000_register_sync. Idempotent.

-- ----------------------------------------------------------------------------
-- 1. Entries: member | visitor | guest
-- ----------------------------------------------------------------------------
alter table public.register_entries add column if not exists kind text not null default 'member';
alter table public.register_entries add column if not exists guest_name text;
alter table public.register_entries add column if not exists client_uuid uuid;
alter table public.register_entries alter column athlete_user_id drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'register_entries_kind_check') then
    alter table public.register_entries add constraint register_entries_kind_check
      check (kind in ('member','visitor','guest'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'register_entries_guest_shape') then
    alter table public.register_entries add constraint register_entries_guest_shape
      check ((kind = 'guest') = (athlete_user_id is null)
             and (kind <> 'guest' or nullif(btrim(guest_name), '') is not null));
  end if;
end $$;
create unique index if not exists register_entries_client_uuid_key on public.register_entries (client_uuid);

alter table public.registers add column if not exists comment text;

-- Members must be members; visitors only arrive through scan_register (which sets sz.register_visitor);
-- guests are names.
create or replace function public.guard_register_entry() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_reg uuid;
begin
  select org_id, register_id into v_org, v_reg from register_groups where id = new.register_group_id;
  if v_reg is distinct from new.register_id then
    raise exception 'INVALID: entry group is not on that register';
  end if;
  if tg_op = 'INSERT' or new.register_group_id is distinct from old.register_group_id
     or new.athlete_user_id is distinct from old.athlete_user_id or new.kind is distinct from old.kind then
    if new.kind = 'member' and not public.is_group_athlete(v_org, new.athlete_user_id) then
      raise exception 'NOT_A_MEMBER: only active members of the register''s groups can be on it';
    end if;
    if new.kind = 'visitor' and coalesce(current_setting('sz.register_visitor', true), '') <> 'on' then
      raise exception 'NOT_A_MEMBER: someone outside the groups can only be added by scanning their own code';
    end if;
  end if;
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Cards (codes)
-- ----------------------------------------------------------------------------
create table if not exists public.register_cards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  kind       text not null default 'qr' check (kind in ('qr','barcode','rfid','other')),
  code       text not null,                          -- normalised: upper case, no spaces
  label      text,                                   -- "Leisure card", "Blue fob"
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists register_cards_live_code on public.register_cards (code) where revoked_at is null;
create index if not exists register_cards_user_idx on public.register_cards (user_id);
alter table public.register_cards enable row level security;   -- no policies: RPCs only

create or replace function public.normalise_card_code(p_code text) returns text
language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')), '') $$;

-- Who may see / issue / link codes for a person: themself, their guardian, or someone who takes
-- registers in a group they are an athlete-side member of (to print cards, link a club card).
create or replace function public.can_manage_cards_for(p_user uuid, p_by uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user = p_by or public.is_active_guardian(p_user, p_by)
      or exists (select 1 from memberships m join group_roles r on r.key = m.role and not r.is_staff
                  where m.user_id = p_user and m.status = 'active'
                    and public.has_group_capability(m.org_id, 'take_register', p_by));
$$;

-- The person's SwimZone QR code, made on first ask. → 'SZ…'
create or replace function public.register_qr_code(p_user uuid default auth.uid()) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if p_user is null or not public.can_manage_cards_for(p_user) then raise exception 'NOT_ALLOWED: not your code to see'; end if;
  select code into v from register_cards where user_id = p_user and kind = 'qr' and revoked_at is null order by created_at limit 1;
  if v is null then
    loop
      v := 'SZ' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      exit when not exists (select 1 from register_cards where code = v and revoked_at is null);
    end loop;
    insert into register_cards (user_id, kind, code, label, created_by) values (p_user, 'qr', v, 'SwimZone QR', auth.uid());
  end if;
  return v;
end $$;

-- Every athlete-side member of a group with their QR code (made if missing), for printing cards.
create or replace function public.group_register_qr_codes(p_org uuid)
returns table (user_id uuid, name text, is_junior boolean, code text)
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if not public.has_group_capability(p_org, 'take_register') then raise exception 'NOT_ALLOWED: you don''t take registers for this group'; end if;
  for m in select distinct x.user_id from memberships x join group_roles r on r.key = x.role and not r.is_staff
            where x.org_id = p_org and x.status = 'active'
  loop
    user_id := m.user_id; name := public.register_name(m.user_id); is_junior := public.is_junior(m.user_id);
    code := public.register_qr_code(m.user_id);
    return next;
  end loop;
end $$;

-- Link a barcode / RFID card (or another code) to a person.
create or replace function public.link_register_card(p_user uuid, p_code text, p_kind text default 'other', p_label text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_code text := public.normalise_card_code(p_code); v_id uuid; v_owner uuid;
begin
  if not public.can_manage_cards_for(p_user) then raise exception 'NOT_ALLOWED: you can''t link cards for this person'; end if;
  if v_code is null then raise exception 'INVALID: the card code is empty'; end if;
  select user_id into v_owner from register_cards where code = v_code and revoked_at is null;
  if v_owner = p_user then return (select id from register_cards where code = v_code and revoked_at is null); end if;
  if v_owner is not null then raise exception 'CARD_IN_USE: that card is already linked to someone else'; end if;
  insert into register_cards (user_id, kind, code, label, created_by)
  values (p_user, coalesce(nullif(p_kind, ''), 'other'), v_code, nullif(btrim(p_label), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.revoke_register_card(p_card uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  select user_id into v_user from register_cards where id = p_card;
  if v_user is null or not public.can_manage_cards_for(v_user) then raise exception 'NOT_ALLOWED: not your card'; end if;
  update register_cards set revoked_at = now() where id = p_card and revoked_at is null;
end $$;

create or replace function public.list_register_cards(p_user uuid default auth.uid())
returns table (id uuid, kind text, code text, label text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.code, c.label, c.created_at from register_cards c
   where c.user_id = p_user and c.revoked_at is null and public.can_manage_cards_for(p_user)
   order by c.created_at;
$$;

-- ----------------------------------------------------------------------------
-- 3. Scanning
-- ----------------------------------------------------------------------------
-- → { result: in | out | already_in | already_out | unknown_card, name, entry_id, visitor, code }
-- p_org: which group to put a visitor in (default: the first group you take). Online only.
create or replace function public.scan_register(p_register uuid, p_code text, p_at timestamptz default null,
                                                p_org uuid default null, p_client_uuid uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code text := public.normalise_card_code(p_code);
  v_at timestamptz := least(coalesce(p_at, now()), now() + interval '10 minutes');
  v_user uuid; v_rg uuid; e register_entries%rowtype; v_visitor boolean := false; v_result text;
begin
  if not exists (select 1 from register_groups g where g.register_id = p_register and public.can_take_register_group(g.id)) then
    raise exception 'NOT_ALLOWED: you cannot take this register';
  end if;
  if (select status from registers where id = p_register) <> 'open' then raise exception 'CLOSED: the register is closed'; end if;
  select user_id into v_user from register_cards where code = v_code and revoked_at is null;
  if v_user is null then return jsonb_build_object('result', 'unknown_card', 'code', v_code); end if;

  select * into e from register_entries where register_id = p_register and athlete_user_id = v_user;
  if not found then
    -- A member of one of the groups I take → under that group. Otherwise a visitor.
    select g.id into v_rg from register_groups g
     where g.register_id = p_register and public.can_take_register_group(g.id) and public.is_group_athlete(g.org_id, v_user)
     order by g.sort limit 1;
    if v_rg is null then
      select g.id into v_rg from register_groups g
       where g.register_id = p_register and public.can_take_register_group(g.id) and (p_org is null or g.org_id = p_org)
       order by g.sort limit 1;
      if v_rg is null then raise exception 'NOT_ALLOWED: you cannot take that group'; end if;
      v_visitor := true;
      perform set_config('sz.register_visitor', 'on', true);
    end if;
    insert into register_entries (register_id, register_group_id, athlete_user_id, expected, kind, updated_by)
    values (p_register, v_rg, v_user, false, case when v_visitor then 'visitor' else 'member' end, auth.uid())
    returning * into e;
    perform set_config('sz.register_visitor', '', true);
    insert into register_events (register_id, entry_id, event, at, by_user_id, detail)
    values (p_register, e.id, 'added', v_at, auth.uid(), jsonb_build_object('via', 'scan', 'visitor', v_visitor));
  end if;
  if not public.can_take_register_group(e.register_group_id) then
    raise exception 'NOT_ALLOWED: they are on another group''s list that you don''t take';
  end if;

  if e.attendance <> 'in' then
    perform public.mark_register_entry(e.id, 'in', v_at, jsonb_build_object('via', 'scan'), p_client_uuid);
    v_result := 'in';
  elsif e.completion is null and e.in_at <= v_at - interval '10 minutes' then
    perform public.mark_register_entry(e.id, 'out_full', v_at, jsonb_build_object('via', 'scan'), p_client_uuid);
    v_result := 'out';
  elsif e.completion is null then v_result := 'already_in';
  else v_result := 'already_out';
  end if;
  return jsonb_build_object('result', v_result, 'name', public.register_name(v_user), 'entry_id', e.id,
                            'visitor', e.kind = 'visitor', 'code', v_code);
end $$;

-- ----------------------------------------------------------------------------
-- 4. Guests and comments
-- ----------------------------------------------------------------------------
-- A typed name. p_tick_in: they're here now (the usual case). p_client_uuid: the phone's id for them
-- (offline adds), so a resend finds the same guest.
create or replace function public.add_register_guest(p_register_group uuid, p_name text, p_tick_in boolean default true,
                                                     p_client_uuid uuid default null, p_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_reg uuid; v_id uuid; v_name text := nullif(btrim(p_name), '');
begin
  select register_id into v_reg from register_groups where id = p_register_group;
  if v_reg is null or not public.can_take_register_group(p_register_group) then
    raise exception 'NOT_ALLOWED: you cannot take this group''s register';
  end if;
  if v_name is null then raise exception 'INVALID: type the guest''s name'; end if;
  if p_client_uuid is not null then
    select id into v_id from register_entries where client_uuid = p_client_uuid;
    if v_id is not null then return v_id; end if;
  end if;
  insert into register_entries (register_id, register_group_id, athlete_user_id, kind, guest_name, expected, client_uuid, updated_by)
  values (v_reg, p_register_group, null, 'guest', left(v_name, 80), false, p_client_uuid, auth.uid())
  returning id into v_id;
  insert into register_events (register_id, entry_id, event, at, by_user_id, detail)
  values (v_reg, v_id, 'added', coalesce(p_at, now()), auth.uid(), jsonb_build_object('guest', true));
  if coalesce(p_tick_in, true) then perform public.mark_register_entry(v_id, 'in', p_at, '{}'::jsonb, null); end if;
  return v_id;
end $$;

create or replace function public.set_register_comment(p_register uuid, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from register_groups g where g.register_id = p_register and public.can_take_register_group(g.id)) then
    raise exception 'NOT_ALLOWED: you cannot take this register';
  end if;
  update registers set comment = nullif(btrim(p_comment), '') where id = p_register;
  insert into register_events (register_id, event, at, by_user_id, detail)
  values (p_register, 'comment', now(), auth.uid(), jsonb_build_object('comment', nullif(btrim(p_comment), '')));
end $$;

create or replace function public.set_entry_comment(p_entry uuid, p_comment text, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare e register_entries%rowtype;
begin
  select * into e from register_entries where id = p_entry;
  if not found then raise exception 'NOT_FOUND: no such register entry'; end if;
  if not public.can_take_register_group(e.register_group_id) then raise exception 'NOT_ALLOWED: you cannot take this group''s register'; end if;
  update register_entries set coach_note = nullif(btrim(p_comment), ''), updated_by = auth.uid(), updated_at = now() where id = p_entry;
  insert into register_events (register_id, entry_id, event, at, by_user_id, detail)
  values (e.register_id, e.id, 'comment', coalesce(p_at, now()), auth.uid(), jsonb_build_object('comment', nullif(btrim(p_comment), '')));
end $$;

-- ----------------------------------------------------------------------------
-- 5. The sheet: kinds, guest names, a stable person_key for the phone
-- ----------------------------------------------------------------------------
-- person_key = the athlete's id, or 'guest:<client_uuid or entry id>' — what the phone's queued taps use.
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
-- 6. Offline sync learns guests and comments
-- ----------------------------------------------------------------------------
-- ops[].athlete_user_id is the person_key: an athlete id, or 'guest:<uuid>'.
--   action 'guest'   { detail: { name } }  makes the guest (once), ticked in at op.at
--   action 'comment' { detail: { comment } } the coach's comment on that swimmer
-- Everything else as in 20261022140000.
create or replace function public.sync_register(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_reg uuid := nullif(p->>'register_id', '')::uuid;
  c jsonb := p->'create';
  op jsonb;
  v_results jsonb := '[]'::jsonb;
  v_close jsonb := null;
  v_entry uuid; v_rg uuid; v_athlete uuid; v_org uuid; v_cu uuid; v_key text; v_guest uuid;
begin
  if auth.uid() is null then raise exception 'NOT_ALLOWED: sign in first'; end if;

  if v_reg is null then
    if c is null then raise exception 'INVALID: register_id or create is required'; end if;
    v_reg := public.create_register(
      (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(c->'org_ids') x),
      (c->>'starts_at')::timestamptz, nullif(c->>'ends_at', '')::timestamptz,
      c->>'venue', nullif(c->>'pool_type', ''), nullif(c->>'client_uuid', '')::uuid);
  elsif not public.can_see_register(v_reg) then
    raise exception 'NOT_ALLOWED: you cannot see this register';
  end if;

  if p ? 'comment' and jsonb_typeof(p->'comment') = 'string' then
    perform public.set_register_comment(v_reg, p->>'comment');
  end if;

  for op in select value from jsonb_array_elements(coalesce(p->'ops', '[]'::jsonb))
             order by (value->>'at')::timestamptz nulls last
  loop
    v_cu := nullif(op->>'client_uuid', '')::uuid;
    begin
      v_key := op->>'athlete_user_id';
      v_org := nullif(op->>'org_id', '')::uuid;
      v_entry := null;

      if v_key like 'guest:%' then
        v_guest := substr(v_key, 7)::uuid;
        select id into v_entry from register_entries where register_id = v_reg and (client_uuid = v_guest or id = v_guest);
        if v_entry is null then
          if op->>'action' <> 'guest' then raise exception 'NOT_FOUND: that guest isn''t on the register'; end if;
          select g.id into v_rg from register_groups g
           where g.register_id = v_reg and (v_org is null or g.org_id = v_org) and public.can_take_register_group(g.id)
           order by g.sort limit 1;
          if v_rg is null then raise exception 'NOT_ALLOWED: you cannot take that group'; end if;
          v_entry := public.add_register_guest(v_rg, op->'detail'->>'name', true, v_guest, (op->>'at')::timestamptz);
        end if;
      else
        v_athlete := v_key::uuid;
        select id into v_entry from register_entries where register_id = v_reg and athlete_user_id = v_athlete;
        if v_entry is null then
          select g.id into v_rg from register_groups g
           where g.register_id = v_reg and (v_org is null or g.org_id = v_org)
             and public.is_group_athlete(g.org_id, v_athlete)
           order by g.sort limit 1;
          if v_rg is null then
            raise exception 'NOT_A_MEMBER: only active members of the register''s groups can be on it';
          end if;
          v_entry := public.add_register_entry(v_rg, v_athlete);
        end if;
      end if;

      if op->>'action' = 'comment' then
        perform public.set_entry_comment(v_entry, op->'detail'->>'comment', (op->>'at')::timestamptz);
      elsif op->>'action' not in ('add', 'guest') then
        perform public.mark_register_entry(v_entry, op->>'action', (op->>'at')::timestamptz,
                                           coalesce(op->'detail', '{}'::jsonb), v_cu);
      end if;
      v_results := v_results || jsonb_build_object('client_uuid', v_cu, 'ok', true);
    exception when others then
      v_results := v_results || jsonb_build_object('client_uuid', v_cu, 'ok', false, 'error', sqlerrm);
    end;
  end loop;

  if p ? 'close' and p->'close' is not null and jsonb_typeof(p->'close') = 'object' then
    begin
      perform public.close_register(v_reg, coalesce((p->'close'->>'force')::boolean, false));
      v_close := jsonb_build_object('ok', true);
    exception when others then
      v_close := jsonb_build_object('ok', false, 'error', sqlerrm);
    end;
  end if;

  return jsonb_build_object('register_id', v_reg, 'results', v_results, 'close', v_close,
                            'sheet', public.register_sheet(v_reg));
end $$;

-- ----------------------------------------------------------------------------
-- 7. The attendance grid
-- ----------------------------------------------------------------------------
-- One group over a date range. Columns = registers that include the group; rows = its athlete-side
-- members now, plus anyone (visitors, ex-members) who was on one of those registers under this group.
-- Guests are counted per register, not listed. Cells: C P I A Ap E N (see the header).
create or replace function public.group_attendance(p_org uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (public.has_group_capability(p_org, 'take_register') or public.is_group_staff(p_org)) then
    raise exception 'NOT_ALLOWED: you don''t take registers or coach this group';
  end if;
  with regs as (
    select r.id, r.starts_at, r.ends_at, r.venue, r.status, g.id as rg_id
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
  )
  select jsonb_build_object(
    'org_id', p_org, 'from', p_from, 'to', p_to,
    'registers', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'starts_at', starts_at, 'ends_at', ends_at,
                    'venue', venue, 'status', status,
                    'guests', (select count(*) from register_entries ge where ge.register_id = regs.id and ge.kind = 'guest' and ge.attendance = 'in'))
                  order by starts_at) from regs), '[]'::jsonb),
    'athletes', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', public.register_name(p.user_id),
                    'is_junior', public.is_junior(p.user_id), 'member', p.member,
                    'cells', (select coalesce(jsonb_object_agg(regs.id, (
                        select case
                                 when e.id is null then 'N'
                                 when e.completion = 'full' then 'C'
                                 when e.completion = 'partial' then 'P'
                                 when e.attendance = 'in' then 'I'
                                 when e.attendance = 'apologies' then 'Ap'
                                 when e.attendance = 'absent' then 'A'
                                 when regs.status = 'closed' then 'A'
                                 else 'E' end
                          from (select 1) one
                          left join register_entries e on e.register_id = regs.id and e.athlete_user_id = p.user_id)), '{}'::jsonb)
                      from regs))
                  order by public.register_name(p.user_id)) from people1 p), '[]'::jsonb))
  into v;
  return v;
end $$;

-- ----------------------------------------------------------------------------
-- 8. The athlete's log gets the register's status and the entry kind (for the same letters as the grid)
-- ----------------------------------------------------------------------------
drop function if exists public.my_register_entries(uuid, timestamptz, timestamptz);
create or replace function public.my_register_entries(p_athlete uuid default auth.uid(),
                                                       p_from timestamptz default null, p_to timestamptz default null)
returns table (entry_id uuid, register_id uuid, starts_at timestamptz, venue text, group_name text,
               attendance text, in_at timestamptz, out_at timestamptz, completion text, partial_reason text,
               done_m int, done_pct int, plan_title text, plan_summary jsonb, note text, share boolean,
               register_status text, kind text)
language sql stable security definer set search_path = public as $$
  select e.id, r.id, r.starts_at, r.venue, o.name, e.attendance, e.in_at, e.out_at, e.completion,
         e.partial_reason, e.done_m, e.done_pct, g.plan_title, g.plan_summary, n.note, coalesce(n.share, false),
         r.status, e.kind
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
