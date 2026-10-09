-- 20261009120000_ladder_bands.sql
-- The 100s Ladder gets three bands on ONE scale, so a swimmer's whole history
-- (junior → club → national) stays in one test and "highest level held" is a
-- single number across their career:
--
--   Junior    J1 10×100 on 2:00 · J2 15×100 on 1:50 · J3 20×100 on 1:40
--   Club      L1 20×100 on 1:30 · L2 25×100 on 1:25 · L3 30×100 on 1:20   (unchanged codes)
--   National  N1 35×100 on 1:15 · N2 40×100 on 1:10
--
-- The order of the options IS the order of the levels (lowest first). L1–L3 keep
-- their codes and their sets, so runs already saved at those levels mean exactly
-- what they did. Only the labels change ("Level 1" → "Club 1").
--
-- Works whether or not the ladder has been swum yet:
--   • not used yet (unlocked)  → updated in place;
--   • already used (locked)    → version 2 is added (same set, measures and
--     analyser; only levels added). The app treats versions that only add levels
--     as one test, so v1 and v2 runs show together (records/testVersions.js).
-- Re-running is a no-op. Needs 20261006130000_ladder_100s.sql first.

begin;

do $$
declare
  v_params jsonb := $j${"level":{"label":"Level","kind":"level","default":"L1","options":[
    {"value":"J1","label":"Junior 1 — 10×100 on 2:00","qty":10,"onTime":"2:00"},
    {"value":"J2","label":"Junior 2 — 15×100 on 1:50","qty":15,"onTime":"1:50"},
    {"value":"J3","label":"Junior 3 — 20×100 on 1:40","qty":20,"onTime":"1:40"},
    {"value":"L1","label":"Club 1 — 20×100 on 1:30","qty":20,"onTime":"1:30"},
    {"value":"L2","label":"Club 2 — 25×100 on 1:25","qty":25,"onTime":"1:25"},
    {"value":"L3","label":"Club 3 — 30×100 on 1:20","qty":30,"onTime":"1:20"},
    {"value":"N1","label":"National 1 — 35×100 on 1:15","qty":35,"onTime":"1:15"},
    {"value":"N2","label":"National 2 — 40×100 on 1:10","qty":40,"onTime":"1:10"}
  ]}}$j$::jsonb;
  v_name text := '100s Ladder';
  v_desc text := 'Straight 100 Free at AT, one ladder in three bands. '
    'Junior: 10 on 2:00 · 15 on 1:50 · 20 on 1:40. Club: 20 on 1:30 · 25 on 1:25 · 30 on 1:20. '
    'National: 35 on 1:15 · 40 on 1:10. '
    'Move up a level once the current one is held (every rep swum with at least 5 s rest). '
    'Compare pace, fade and stroke count across the season, with the level marked.';
  p record;
begin
  select * into p from public.test_protocols
   where key = 'ladder-100s' and owner_org_id is null
   order by version desc limit 1;

  if not found then
    raise notice 'ladder-100s is not in the library — apply 20261006130000_ladder_100s.sql first';
    return;
  end if;

  if p.params = v_params then
    return;                                           -- already applied
  end if;

  if not p.locked then
    update public.test_protocols
       set params = v_params, name = v_name, description = v_desc
     where id = p.id;
    raise notice 'ladder-100s v% updated in place (not used yet)', p.version;
  else
    insert into public.test_protocols (key, version, name, description, owner_org_id, set_json, measures, params, analyser)
    values (p.key, p.version + 1, v_name, v_desc, null, p.set_json, p.measures, v_params, p.analyser);
    raise notice 'ladder-100s v% is in use — added v% with the bands', p.version, p.version + 1;
  end if;
end $$;

commit;
