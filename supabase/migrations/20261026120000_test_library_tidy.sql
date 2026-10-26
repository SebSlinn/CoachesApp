-- 20261026120000_test_library_tidy.sql — Test Set Library tidy-up (DECISIONS 2026-10-26, Al).
--
-- 1. `retired`: a used (locked) test can't be deleted — its results point at it — so it is
--    retired instead: hidden from the Test Sets picker, runs kept and still shown on the
--    results pages. The lock trigger only guards the definition, so `retired` can be switched
--    on a locked test by whoever may edit it (root: global library; group staff: own tests).
-- 2. Retired: the 20×100 turn set (the 100s ladder
--    covers it), CSS 400+200, Double-Distance 400, Max Heart Rate.
-- 3. 8×50 Efficiency rewritten to the book (Sweetenham & Atkinson, Championship Swim Training,
--    "8 × 50 Meter Efficiency Test"): 2:30 cycle, push start, descending — targets PB+15, +13,
--    +11, +9, +7, +5, +3, +1, the last one maximum effort; time, stroke count, stroke rate and
--    HR every swim. Updated in place if never used, otherwise as version 2.
-- 4. New, from the club's weekly "Training emphasis" (Darren):
--      ANP 100s max — 5×100 maximum effort, No1 stroke, race suit, long rest (reps can be
--        changed for the run, e.g. up to 10).
--      ANC 50s max  — 20×50 maximum effort on 1:00, two sets of 10, No1 stroke, race suit.
--    "No1 stroke" = a stroke choice made for the run (param kind 'stroke', line.strokeParam).
-- Idempotent.

alter table public.test_protocols add column if not exists retired boolean not null default false;
comment on column public.test_protocols.retired is
  'Hidden from the Test Sets picker; results kept and still shown. Any version of a key retires the key.';

-- 2. retire (never delete: re-running the 20260929 seed would bring a deleted test back)
update public.test_protocols set retired = true
 where owner_org_id is null and key in ('turn-20x100', 'css-400-200', 'double-distance-400', 'max-hr') and not retired;

-- 3. 8×50 Efficiency to the book
do $$
declare
  v_set    jsonb := $j${"fmt": "swimzone.set/1", "name": "8×50 Efficiency", "blocks": [{"repeats": 1, "lines": [{"type": "swim", "qty": 1, "distM": 50, "stroke": "FS", "strokeParam": "stroke", "interval": {"type": "fixed", "onTime": "2:30", "param": "sendOff"}, "intensity": "A2", "targetRule": {"base": "PB", "plusFrom": 15, "plusTo": 15}, "note": "PB+15"}, {"type": "swim", "qty": 1, "distM": 50, "stroke": "FS", "strokeParam": "stroke", "interval": {"type": "fixed", "onTime": "2:30", "param": "sendOff"}, "intensity": "A3", "targetRule": {"base": "PB", "plusFrom": 13, "plusTo": 13}, "note": "PB+13"}, {"type": "swim", "qty": 1, "distM": 50, "stroke": "FS", "strokeParam": "stroke", "interval": {"type": "fixed", "onTime": "2:30", "param": "sendOff"}, "intensity": "A3", "targetRule": {"base": "PB", "plusFrom": 11, "plusTo": 11}, "note": "PB+11"}, {"type": "swim", "qty": 1, "distM": 50, "stroke": "FS", "strokeParam": "stroke", "interval": {"type": "fixed", "onTime": "2:30", "param": "sendOff"}, "intensity": "AT", "targetRule": {"base": "PB", "plusFrom": 9, "plusTo": 9}, "note": "PB+9"}, {"type": "swim", "qty": 1, "distM": 50, "stroke": "FS", "strokeParam": "stroke", "interval": {"type": "fixed", "onTime": "2:30", "param": "sendOff"}, "intensity": "AT", "targetRule": {"base": "PB", "plusFrom": 7, "plusTo": 7}, "note": "PB+7"}, {"type": "swim", "qty": 1, "distM": 50, "stroke": "FS", "strokeParam": "stroke", "interval": {"type": "fixed", "onTime": "2:30", "param": "sendOff"}, "intensity": "LT", "targetRule": {"base": "PB", "plusFrom": 5, "plusTo": 5}, "note": "PB+5"}, {"type": "swim", "qty": 1, "distM": 50, "stroke": "FS", "strokeParam": "stroke", "interval": {"type": "fixed", "onTime": "2:30", "param": "sendOff"}, "intensity": "LP", "targetRule": {"base": "PB", "plusFrom": 3, "plusTo": 3}, "note": "PB+3"}, {"type": "swim", "qty": 1, "distM": 50, "stroke": "FS", "strokeParam": "stroke", "interval": {"type": "fixed", "onTime": "2:30", "param": "sendOff"}, "intensity": "HVO", "targetRule": {"base": "PB", "plusFrom": 1, "plusTo": 1}, "note": "max — PB+1 or faster"}]}]}$j$::jsonb;
  v_params jsonb := $j${"sendOff": {"kind": "onTime", "label": "Cycle", "default": "2:30", "options": ["2:00", "2:30", "3:00"]}, "stroke": {"kind": "stroke", "label": "Stroke (No1)", "default": "FS", "options": ["FS", "BK", "BR", "Fly"]}}$j$::jsonb;
  v_name   text  := '8×50 Efficiency';
  v_desc   text  := 'From the book (Sweetenham & Atkinson): 8×50 on a 2:30 cycle from a push start, each about 2 s faster — '
                    'targets PB+15, +13, +11, +9, +7, +5, +3, then PB+1 or faster flat out. Record time, stroke count, '
                    'stroke rate and heart rate every swim; plot stroke count and stroke rate against speed to set '
                    'efficiency targets (e.g. 10×50 holding a time at a set stroke count).';
  v_meas   text[] := array['time','sc','sr','hr'];
  v_cur    record;
begin
  select * into v_cur from public.test_protocols where owner_org_id is null and key = 'eff-8x50' order by version desc limit 1;
  if not found then
    insert into public.test_protocols (key, version, name, description, owner_org_id, set_json, measures, params, analyser)
    values ('eff-8x50', 1, v_name, v_desc, null, v_set, v_meas, v_params, 'swolf');
  elsif v_cur.set_json = v_set then
    null;                                            -- already done
  elsif not v_cur.locked then
    update public.test_protocols set name = v_name, description = v_desc, set_json = v_set, measures = v_meas,
           params = v_params, analyser = 'swolf' where id = v_cur.id;
  else
    insert into public.test_protocols (key, version, name, description, owner_org_id, set_json, measures, params, analyser)
    values ('eff-8x50', v_cur.version + 1, v_name, v_desc, null, v_set, v_meas, v_params, 'swolf');
  end if;
end $$;

-- 4. ANP and ANC
insert into public.test_protocols (key, version, name, description, owner_org_id, set_json, measures, params, analyser) values
  ('anp-100s', 1, 'ANP 100s max (No1)',
   'Anaerobic power: 5×100 maximum effort, No1 stroke, race suit, long rest (the rest is recorded as it happens). '
   'Change the reps for the day — up to 10. Compared with PB: 10–15 s slower than PB suggests it wasn''t a maximum effort.',
   null, $j${"fmt": "swimzone.set/1", "name": "ANP 100s max", "blocks": [{"repeats": 1, "lines": [{"type": "swim", "qty": 5, "distM": 100, "stroke": "FS", "strokeParam": "stroke", "interval": {"type": "rest", "restSec": 180, "param": "rest"}, "intensity": "HVO", "targetRule": {"base": "PB", "plusFrom": 0, "plusTo": 0}, "note": "max, race suit"}]}]}$j$::jsonb, array['time','splits','hr'], $j${"rest": {"kind": "restSec", "label": "Rest (guide)", "default": 180, "options": [120, 180, 240, 300]}, "stroke": {"kind": "stroke", "label": "Stroke (No1)", "default": "FS", "options": ["FS", "BK", "BR", "Fly"]}}$j$::jsonb, 'series'),
  ('anc-50s', 1, 'ANC 20×50 max (No1)',
   'Anaerobic capacity: 20×50 maximum effort on 1:00, in two sets of 10 with an easy swim between, No1 stroke, race suit. '
   'Set 1 is compared with set 2.',
   null, $j${"fmt": "swimzone.set/1", "name": "ANC 50s max", "blocks": [{"repeats": 2, "lines": [{"type": "swim", "qty": 10, "distM": 50, "stroke": "FS", "strokeParam": "stroke", "interval": {"type": "fixed", "onTime": "1:00", "param": "sendOff"}, "intensity": "HVO", "targetRule": {"base": "PB", "plusFrom": 0, "plusTo": 0}, "note": "max, race suit"}, {"type": "rest", "note": "easy swim between the two sets"}]}]}$j$::jsonb, array['time','sc','hr'], $j${"sendOff": {"kind": "onTime", "label": "Send-off", "default": "1:00", "options": ["0:55", "1:00", "1:05", "1:10"]}, "stroke": {"kind": "stroke", "label": "Stroke (No1)", "default": "FS", "options": ["FS", "BK", "BR", "Fly"]}}$j$::jsonb, 'blocks')
on conflict on constraint test_protocols_owner_key_version_uq do nothing;
