-- 20261009130000_move_endurance_runs_to_ladder.sql
-- Runs saved against the retired endurance tests ("30×100 Free on 1:20" =
-- end-30x100, "20×100 Free on 1:40" = end-20x100) were kept when the 100s Ladder
-- replaced them (20261006140000 only removes unused tests), so they never show
-- in the ladder's history. Where the set swum is EXACTLY a ladder level, the run
-- is moved onto the ladder at that level:
--
--   end-30x100 on 1:20  → L3  (Club 3 — 30×100 on 1:20)
--   end-20x100 on 1:30  → L1  (Club 1 — 20×100 on 1:30)
--   end-20x100 on 1:40  → J3  (Junior 3 — 20×100 on 1:40; needs 20261009120000_ladder_bands.sql)
--
-- Same reps, same send-off, straight 100 Free — so like-for-like. Anything else
-- (another send-off) is NOT a ladder level and is left where it is, with a notice.
-- The reps themselves are untouched. The run's stored summary is cleared because
-- it was worked out by the old test's analyser; the app recalculates it with the
-- ladder's (summaries are derived — reps are the truth). The old send-off is kept
-- in conditions.movedFrom. Moving a run locks the ladder version (trigger).
-- Then the old tests are removed if nothing uses them any more.
-- Re-running is a no-op.

begin;

do $$
declare
  lad record;
  r record;
  v_send text;
  v_level text;
  n_moved int := 0;
begin
  select * into lad from public.test_protocols
   where key = 'ladder-100s' and owner_org_id is null
   order by version desc limit 1;
  if not found then
    raise notice 'ladder-100s is not in the library — nothing moved';
    return;
  end if;

  for r in
    select se.id, se.swum_on, se.conditions, se.set_json, tp.key, tp.version
      from public.set_efforts se
      join public.test_protocols tp on tp.id = se.protocol_id
     where tp.owner_org_id is null and tp.key in ('end-20x100', 'end-30x100')
  loop
    -- the send-off actually swum: the chosen param, else the snapshot's line
    v_send := coalesce(r.conditions -> 'params' ->> 'sendOff',
                       r.set_json -> 'blocks' -> 0 -> 'lines' -> 0 -> 'interval' ->> 'onTime');
    v_level := case
      when r.key = 'end-30x100' and v_send = '1:20' then 'L3'
      when r.key = 'end-20x100' and v_send = '1:30' then 'L1'
      when r.key = 'end-20x100' and v_send = '1:40' then 'J3'
    end;
    if v_level is null or not exists (
         select 1 from jsonb_array_elements(lad.params -> 'level' -> 'options') o where o ->> 'value' = v_level) then
      raise notice 'KEPT run % (% on %, %) — not a level on the ladder', r.id, r.key, coalesce(v_send, '?'), r.swum_on;
      continue;
    end if;
    update public.set_efforts
       set protocol_id = lad.id,
           conditions  = (coalesce(r.conditions, '{}'::jsonb) - 'params')
                         || jsonb_build_object('params', jsonb_build_object('level', v_level),
                                               'movedFrom', format('%s v%s on %s', r.key, r.version, v_send)),
           summary     = null
     where id = r.id;
    n_moved := n_moved + 1;
    raise notice 'moved run % (%, %) → ladder-100s v% at %', r.id, r.key, r.swum_on, lad.version, v_level;
  end loop;

  delete from public.test_protocols tp
   where tp.owner_org_id is null and tp.key in ('end-20x100', 'end-30x100')
     and not exists (select 1 from public.set_efforts se where se.protocol_id = tp.id);

  raise notice '% run(s) moved onto the 100s Ladder', n_moved;
end $$;

commit;
