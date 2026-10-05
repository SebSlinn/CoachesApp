-- 20261005130000_add_endurance_tests.sql
-- Three more tests in the GLOBAL Test Set Library (owner_org_id null → every
-- coach sees them). Same shape as the seeds in 20260929120000_test_protocols.sql.
-- Re-running is a no-op (unique owner/key/version). They stay editable until a run
-- is saved against them (then they lock, like every library test).
--
--   bbm30-10x400   10×400 Free at 30 BBM (30 beats below max HR), on 5:00
--   end-20x100     20×100 Free, best average, on 1:40
--   end-30x100     30×100 Free, best average, on 1:20
--
-- The send-off is a per-run knob (param "sendOff") so a group can be put on a
-- slightly different clock without creating a new test.

insert into public.test_protocols (key, version, name, description, set_json, measures, params, analyser)
values
-- 10×400 @ 30 BBM -----------------------------------------------------------
('bbm30-10x400', 1, '10×400 @ 30 BBM',
 'Ten 400 Free on 5:00, held at 30 beats below max heart rate. Mean, spread and drift of the times; HR per rep and per length (HR1/HR2) from a sensor show whether the effort stayed at 30 BBM.',
 $j${"fmt":"swimzone.set/1","name":"10×400 @ 30 BBM","poolType":"25SC","note":"30 BBM = 30 beats below max heart rate","blocks":[{"repeats":1,"lines":[
  {"type":"swim","stroke":"FS","distM":400,"qty":10,"targetRule":{"base":"A3"},"interval":{"type":"fixed","onTime":"5:00","param":"sendOff"},"intensity":"A3","note":"30 BBM"}
 ]}]}$j$::jsonb,
 array['time','splits','hr','rpe'],
 $j${"sendOff":{"label":"Send-off","kind":"onTime","default":"5:00","options":["4:45","5:00","5:15","5:30"]}}$j$::jsonb,
 'series'),

-- 20×100 on 1:40 ------------------------------------------------------------
('end-20x100', 1, '20×100 Free on 1:40',
 'Twenty 100 Free on 1:40, best average. Mean, spread and drift across the set.',
 $j${"fmt":"swimzone.set/1","name":"20×100 on 1:40","poolType":"25SC","note":"","blocks":[{"repeats":1,"lines":[
  {"type":"swim","stroke":"FS","distM":100,"qty":20,"targetRule":{"base":"bestAverage"},"interval":{"type":"fixed","onTime":"1:40","param":"sendOff"},"intensity":"AT","note":""}
 ]}]}$j$::jsonb,
 array['time','sc','hr','rpe'],
 $j${"sendOff":{"label":"Send-off","kind":"onTime","default":"1:40","options":["1:30","1:35","1:40","1:45","1:50"]}}$j$::jsonb,
 'series'),

-- 30×100 on 1:20 ------------------------------------------------------------
('end-30x100', 1, '30×100 Free on 1:20',
 'Thirty 100 Free on 1:20, best average. Mean, spread and drift across the set.',
 $j${"fmt":"swimzone.set/1","name":"30×100 on 1:20","poolType":"25SC","note":"","blocks":[{"repeats":1,"lines":[
  {"type":"swim","stroke":"FS","distM":100,"qty":30,"targetRule":{"base":"bestAverage"},"interval":{"type":"fixed","onTime":"1:20","param":"sendOff"},"intensity":"AT","note":""}
 ]}]}$j$::jsonb,
 array['time','sc','hr','rpe'],
 $j${"sendOff":{"label":"Send-off","kind":"onTime","default":"1:20","options":["1:10","1:15","1:20","1:25","1:30"]}}$j$::jsonb,
 'series')
on conflict do nothing;
