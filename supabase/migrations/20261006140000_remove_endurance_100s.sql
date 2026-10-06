-- 20261006140000_remove_endurance_100s.sql
-- Remove "20×100 Free on 1:40" (end-20x100) and "30×100 Free on 1:20"
-- (end-30x100) from the global library — replaced by the 100s Ladder
-- (ladder-100s), whose levels cover 20 / 25 / 30 × 100.
--
-- SAFE BY DESIGN: only removes a test that has NO runs saved against it. A test
-- with results is locked and kept (its results must stay comparable); in that
-- case the NOTICE below says so and nothing is deleted for that test.
-- (20261005130000_add_endurance_tests.sql still adds them on a fresh setup; this
-- migration then removes them again, so both routes end in the same place.)

do $$
declare
  r record;
begin
  for r in
    select tp.id, tp.key, tp.version,
           exists (select 1 from public.set_efforts se where se.protocol_id = tp.id) as used
      from public.test_protocols tp
     where tp.owner_org_id is null and tp.key in ('end-20x100', 'end-30x100')
  loop
    if r.used then
      raise notice 'KEPT % v% — it has saved runs against it', r.key, r.version;
    else
      delete from public.test_protocols where id = r.id;
      raise notice 'removed % v%', r.key, r.version;
    end if;
  end loop;
end $$;
