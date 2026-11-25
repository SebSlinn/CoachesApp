-- 20261125120000_ladder_open.sql
-- The 100s Ladder loses its levels (Al, 2026-11-25). The coach picks a send-off;
-- the swimmer swims 100s on it until they stop, up to 60. The run records the
-- reps swum and the send-off, and reads as "16 × 100 @ 2:00" everywhere.
--
--   set    one OPEN line (swimzone.set/1 line.open = true): qty 60 is the most,
--          not the set — reps not swum are not "missing"
--   params sendOff (kind onTime), 1:00 → 2:30 in 5 s steps, default 1:30
--
-- The ladder has been swum, so its newest version is locked: this adds the next
-- version. Old versions and their runs are untouched (their level stays stored);
-- the app shows every ladder version as one history (records/testVersions.js).
-- If the newest version was never used, it is changed in place instead.
-- Re-running is a no-op. Needs 20261006130000_ladder_100s.sql first.

begin;

do $$
declare
  v_set jsonb := $j${"fmt":"swimzone.set/1","name":"100s Ladder","poolType":"25SC","note":"","blocks":[{"repeats":1,"lines":[
    {"type":"swim","stroke":"FS","distM":100,"qty":60,"open":true,"targetRule":{"base":"AT"},"interval":{"type":"fixed","onTime":"1:30","param":"sendOff"},"intensity":"AT","measures":["time","sc"],"note":""}
  ]}]}$j$::jsonb;
  v_params jsonb := $j${"sendOff":{"label":"Send-off","kind":"onTime","default":"1:30","options":["1:00","1:05","1:10","1:15","1:20","1:25","1:30","1:35","1:40","1:45","1:50","1:55","2:00","2:05","2:10","2:15","2:20","2:25","2:30"]}}$j$::jsonb;
  v_name text := '100s Ladder';
  v_desc text := 'Straight 100 Free at AT on the send-off you choose, until they stop (up to 60). '
    'The run is what was swum, e.g. 16 × 100 @ 2:00 or 30 × 100 @ 1:20. '
    'Held = every rep finished at least 5 s inside the send-off. '
    'Compare pace, fade, rest and stroke count across runs, rep by rep.';
  p record;
begin
  select * into p from public.test_protocols
   where key = 'ladder-100s' and owner_org_id is null
   order by version desc limit 1;

  if not found then
    raise notice 'ladder-100s is not in the library — apply 20261006130000_ladder_100s.sql first';
    return;
  end if;

  if p.set_json = v_set and p.params = v_params then
    return;                                           -- already applied
  end if;

  if not p.locked then
    update public.test_protocols
       set set_json = v_set, params = v_params, name = v_name, description = v_desc
     where id = p.id;
    raise notice 'ladder-100s v% changed in place (not used yet)', p.version;
  else
    insert into public.test_protocols (key, version, name, description, owner_org_id, set_json, measures, params, analyser)
    values (p.key, p.version + 1, v_name, v_desc, null, v_set, p.measures, v_params, p.analyser);
    raise notice 'ladder-100s v% is in use — added v% (no levels, open reps)', p.version, p.version + 1;
  end if;
end $$;

commit;
