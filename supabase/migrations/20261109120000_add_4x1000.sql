-- 20261109120000_add_4x1000.sql — 4×1000 on 12:30 in the GLOBAL Test Set Library (Al, 2026-11-09).
-- Same shape as 20261005130000_add_endurance_tests.sql: owner_org_id null → every coach sees it.
-- The send-off is a per-run knob (param "sendOff"), so a group can go on a different clock
-- without a new test. Stays editable until a run is saved against it, then locks.
-- Re-running is a no-op (unique owner/key/version).

insert into public.test_protocols (key, version, name, description, owner_org_id, set_json, measures, params, analyser)
values
('end-4x1000', 1, '4×1000 on 12:30',
 'Four 1000 Free on 12:30, best average. Mean, spread and drift across the set; splits, stroke counts and HR '
 'per rep show where each 1000 slowed.',
 null,
 $j${"fmt":"swimzone.set/1","name":"4×1000 on 12:30","poolType":"25SC","note":"","blocks":[{"repeats":1,"lines":[
  {"type":"swim","stroke":"FS","distM":1000,"qty":4,"targetRule":{"base":"bestAverage"},"interval":{"type":"fixed","onTime":"12:30","param":"sendOff"},"intensity":"A3","note":"best average"}
 ]}]}$j$::jsonb,
 array['time','splits','sc','hr','rpe'],
 $j${"sendOff":{"label":"Send-off","kind":"onTime","default":"12:30","options":["12:00","12:30","13:00","13:30","14:00"]}}$j$::jsonb,
 'series')
on conflict on constraint test_protocols_owner_key_version_uq do nothing;
