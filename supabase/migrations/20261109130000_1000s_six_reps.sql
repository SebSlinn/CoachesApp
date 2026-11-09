-- 20261109130000_1000s_six_reps.sql — the 4×1000 becomes 6×1000 on 12:30 (Al, 2026-11-09).
-- Six is the most the set will be; swim fewer on the day by setting Reps for the run
-- (Test Sets) or stopping early in Poolside. Runs line up rep by rep, so a 4-rep run
-- sits beside a 6-rep run with reps 5–6 blank, and they compare up to the reps done.
-- The key no longer carries the count: end-4x1000 → end-1000s.
--   unused (not locked) → changed in place
--   already has a run   → end-4x1000 retired (its runs stay), end-1000s added
-- Idempotent. Follows 20261109120000_add_4x1000.sql, so a fresh database ends the same.

do $$
declare
  v_set    jsonb := $j${"fmt":"swimzone.set/1","name":"6×1000 on 12:30","poolType":"25SC","note":"","blocks":[{"repeats":1,"lines":[
    {"type":"swim","stroke":"FS","distM":1000,"qty":6,"targetRule":{"base":"bestAverage"},"interval":{"type":"fixed","onTime":"12:30","param":"sendOff"},"intensity":"A3","note":"best average"}
  ]}]}$j$::jsonb;
  v_name   text := '6×1000 on 12:30';
  v_desc   text := 'Up to six 1000 Free on 12:30, best average. Swim fewer on the day (set Reps for the run, or stop early in Poolside): '
                   'runs line up rep by rep, so they compare up to the reps done. Mean, spread and drift; splits, stroke counts '
                   'and HR per rep show where each 1000 slowed.';
  v_cur    record;
begin
  if exists (select 1 from public.test_protocols where owner_org_id is null and key = 'end-1000s') then
    return;                                          -- already done
  end if;
  select * into v_cur from public.test_protocols where owner_org_id is null and key = 'end-4x1000' order by version desc limit 1;
  if found and not v_cur.locked then
    update public.test_protocols set key = 'end-1000s', name = v_name, description = v_desc, set_json = v_set
     where id = v_cur.id;
  else
    if found then
      update public.test_protocols set retired = true where owner_org_id is null and key = 'end-4x1000';
    end if;
    insert into public.test_protocols (key, version, name, description, owner_org_id, set_json, measures, params, analyser)
    values ('end-1000s', 1, v_name, v_desc, null, v_set, array['time','splits','sc','hr','rpe'],
            $j${"sendOff":{"label":"Send-off","kind":"onTime","default":"12:30","options":["12:00","12:30","13:00","13:30","14:00"]}}$j$::jsonb,
            'series');
  end if;
end $$;
