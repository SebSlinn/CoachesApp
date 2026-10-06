-- 20261006130000_ladder_100s.sql
-- The 100s ladder: one test with three levels, chosen per run (param "level"),
-- each setting BOTH the number of 100s and the send-off:
--
--   L1  20×100 Free on 1:30
--   L2  25×100 Free on 1:25
--   L3  30×100 Free on 1:20
--
-- Straight 100s, no recovery swim in the middle. Runs at the same level compare
-- exactly; across levels the ladder analyser reports per-100 pace, slowing per
-- rep, first-5 vs last-5, stroke-count change, rest gained, and whether the level
-- was HELD (all reps swum, every one at least 5 s inside the send-off).
--
-- Global library (owner_org_id null). Re-running is a no-op. Editable until the
-- first run is saved against it (then it locks, like every library test).
-- Needs the 'level' param kind, which lives in code (protocolFormat.js) — no
-- schema change.

insert into public.test_protocols (key, version, name, description, set_json, measures, params, analyser)
values
('ladder-100s', 1, '100s Ladder (20 · 25 · 30)',
 'Straight 100 Free at AT. Level 1: 20 on 1:30 · Level 2: 25 on 1:25 · Level 3: 30 on 1:20. '
 'Move up a level once the current one is held (every rep swum with at least 5 s rest). '
 'Compare pace, fade and stroke count across the season, with the level marked.',
 $j${"fmt":"swimzone.set/1","name":"100s Ladder","poolType":"25SC","note":"","blocks":[{"repeats":1,"lines":[
  {"type":"swim","stroke":"FS","distM":100,"qty":20,"targetRule":{"base":"AT"},"interval":{"type":"fixed","onTime":"1:30","param":"level"},"intensity":"AT","measures":["time","sc"],"note":""}
 ]}]}$j$::jsonb,
 array['time','sc','hr','rpe'],
 $j${"level":{"label":"Level","kind":"level","default":"L1","options":[
   {"value":"L1","label":"Level 1 — 20×100 on 1:30","qty":20,"onTime":"1:30"},
   {"value":"L2","label":"Level 2 — 25×100 on 1:25","qty":25,"onTime":"1:25"},
   {"value":"L3","label":"Level 3 — 30×100 on 1:20","qty":30,"onTime":"1:20"}
 ]}}$j$::jsonb,
 'ladder')
on conflict do nothing;
