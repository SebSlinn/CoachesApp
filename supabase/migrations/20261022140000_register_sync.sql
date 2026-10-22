-- 20261022140000_register_sync.sql — Registers offline (claude-docs/teams/REGISTERS.md, "Offline")
--
-- The register works with no internet: the phone keeps the group lists, records every tap
-- locally with its own time and a client_uuid, and sends the queue when signal returns.
--
--   register_prepare()      one call before going poolside: my registerable groups with their
--                           members, plus the sheets of recent/upcoming registers I can see
--   sync_register(payload)  one call per register when back online: creates the register if the
--                           phone made it offline, applies the queued taps in time order, closes
--                           it if asked, and returns the sheet as it now stands
--
-- Every tap still goes through mark_register_entry, so the rules are the same online and off:
-- permissions, members only, latest device time wins, and the same client_uuid twice is a no-op
-- (so sending a queue twice is harmless). One bad tap never blocks the rest: each op is applied
-- in its own sub-transaction and reported back.
--
-- Depends on 20261022130000_registers. Idempotent.

-- ----------------------------------------------------------------------------
-- 0. The sheet carries the tap times
-- ----------------------------------------------------------------------------
-- Everything the coach screen needs for one register. Re-created from 20261022130000 with
-- attendance_at / out_state_at added, so the phone can apply "latest tap wins" itself offline.
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
               'attendance_at', e.attendance_at, 'out_state_at', e.out_state_at,
               'completion', e.completion, 'partial_reason', e.partial_reason, 'done_m', e.done_m,
               'done_pct', e.done_pct, 'coach_note', e.coach_note,
               'updated_by_name', public.register_name(e.updated_by), 'updated_at', e.updated_at,
               'athlete_note', case when n.share then n.note end)
             order by public.register_name(e.athlete_user_id))
        from register_entries e left join register_notes n on n.entry_id = e.id
       where e.register_id = r.id), '[]'::jsonb));
end $$;

-- ----------------------------------------------------------------------------
-- 1. Before going poolside
-- ----------------------------------------------------------------------------
create or replace function public.register_prepare(p_days_back int default 1, p_days_ahead int default 7)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_ALLOWED: sign in first'; end if;
  return jsonb_build_object(
    'user_id', v_uid,
    'prepared_at', now(),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'org_id', o.id, 'name', o.name,
               'members', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'athlete_user_id', x.user_id, 'name', public.register_name(x.user_id),
                          'is_junior', public.is_junior(x.user_id)) order by public.register_name(x.user_id))
                   from (select distinct m.user_id
                           from memberships m join group_roles r on r.key = m.role and not r.is_staff
                          where m.org_id = o.id and m.status = 'active') x), '[]'::jsonb))
             order by o.name)
        from organisations o
       where public.has_group_capability(o.id, 'take_register', v_uid)), '[]'::jsonb),
    'registers', coalesce((
      select jsonb_agg(public.register_sheet(r.id) order by r.starts_at)
        from registers r
       where public.can_see_register(r.id, v_uid)
         and r.starts_at >= now() - make_interval(days => greatest(p_days_back, 0))
         and r.starts_at <  now() + make_interval(days => greatest(p_days_ahead, 0))), '[]'::jsonb));
end $$;

-- ----------------------------------------------------------------------------
-- 2. Back online: one register's queue
-- ----------------------------------------------------------------------------
-- p: {
--   register_id?  uuid                         -- an existing register, or…
--   create?       { client_uuid, org_ids[], starts_at, ends_at?, venue?, pool_type? }   -- …one made offline
--   ops:          [{ client_uuid, athlete_user_id, org_id?, action, at, detail? }]
--                 action = add | in | undo_in | absent | apologies | expected | out_full | out_partial | undo_out
--                 (org_id says which group to put someone in if they aren't on the register yet)
--   close?        { force: bool }
-- }
-- → { register_id, results: [{ client_uuid, ok, error? }], close: { ok, error? } | null, sheet }
create or replace function public.sync_register(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_reg uuid := nullif(p->>'register_id', '')::uuid;
  c jsonb := p->'create';
  op jsonb;
  v_results jsonb := '[]'::jsonb;
  v_close jsonb := null;
  v_entry uuid;
  v_rg uuid;
  v_athlete uuid;
  v_org uuid;
  v_cu uuid;
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

  for op in select value from jsonb_array_elements(coalesce(p->'ops', '[]'::jsonb))
             order by (value->>'at')::timestamptz nulls last
  loop
    v_cu := nullif(op->>'client_uuid', '')::uuid;
    begin
      v_athlete := (op->>'athlete_user_id')::uuid;
      v_org := nullif(op->>'org_id', '')::uuid;
      select id into v_entry from register_entries where register_id = v_reg and athlete_user_id = v_athlete;

      if v_entry is null then
        -- Not on the register yet (added offline, or joined the group since): put them in the
        -- group the phone said, else the first of the register's groups they are a member of.
        select g.id into v_rg from register_groups g
         where g.register_id = v_reg and (v_org is null or g.org_id = v_org)
           and public.is_group_athlete(g.org_id, v_athlete)
         order by g.sort limit 1;
        if v_rg is null then
          raise exception 'NOT_A_MEMBER: only active members of the register''s groups can be on it';
        end if;
        v_entry := public.add_register_entry(v_rg, v_athlete);
      end if;

      if op->>'action' <> 'add' then
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
