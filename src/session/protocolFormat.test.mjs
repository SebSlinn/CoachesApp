// protocolFormat.test.mjs — checks the Test Set Library code against the REAL
// seeded protocols (read out of the migration via PGlite), so the SQL seeds and
// the JS analysers can't drift apart.
//
//   node src/session/protocolFormat.test.mjs
//
// Needs @electric-sql/pglite (already a dependency).

import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  validateProtocol, resolveParams, expandReps, prescribe, prescribeGroup,
  cleanMetrics, lineMeasures, checkConstraints, analyse, ANALYSERS,
  buildHandoff, encodeHandoff, decodeHandoff, levelOption, paramValueLabel, LADDER_MIN_REST_SEC,
} from './protocolFormat.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

// ---- load the seeded library out of the migration ---------------------------
async function loadSeeds() {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create role authenticated;
    create table public.users (id uuid primary key);
    create table public.organisations (id uuid primary key);
    create table public.memberships (id uuid primary key, user_id uuid, org_id uuid, role text, status text);
    create table public.performance_results (id uuid primary key default gen_random_uuid(),
      athlete_user_id uuid references public.users(id), swum_on date, kind text, stroke text, dist_m int,
      pool_type text, time_sec numeric, splits jsonb, location text, notes text, source text,
      created_by uuid, updated_by uuid, created_at timestamptz, updated_at timestamptz);
    create function public.has_log_access(o uuid, m text) returns boolean language sql as $$ select false $$;
    create function public.is_org_staff(o uuid, u uuid default null) returns boolean language sql as $$ select false $$;
    create function public.is_root(u uuid default null) returns boolean language sql as $$ select false $$;
    create function public.can_manage_group(o uuid, u uuid default null) returns boolean language sql as $$ select false $$;
    create function public.org_grant(o uuid) returns uuid language sql as $$ select null::uuid $$;
    create function public.grant_ancestors(g uuid) returns table (grant_id uuid, org_id uuid)
      language sql as $$ select null::uuid, null::uuid where false $$;`);
  for (const m of ['20260927120000_athlete_records.sql', '20260928120000_drop_import_dedup.sql', '20260929120000_test_protocols.sql',
                   '20261005130000_add_endurance_tests.sql', '20261006130000_ladder_100s.sql',
                   '20261009120000_ladder_bands.sql'])
    await db.exec(readFileSync('supabase/migrations/' + m, 'utf8'));
  const { rows } = await db.query(`select id, key, version, name, set_json, measures, params, analyser from public.test_protocols`);
  return Object.fromEntries(rows.map((r) => [r.key, {
    id: r.id, key: r.key, version: r.version, name: r.name, set: r.set_json,
    measures: r.measures, params: r.params, analyser: r.analyser,
  }]));
}

const athlete = { id: 'a1', name: 'Sam', pbByEvent: { FS200: 130, FS400: 280, FS100: 62, FS50: 29 } };

async function run() {
  const P = await loadSeeds();

  console.log('\nSeeds are valid protocols');
  for (const [k, p] of Object.entries(P)) ok(`${k} validates`, validateProtocol(p) === null, validateProtocol(p));
  for (const [k, p] of Object.entries(P)) ok(`${k} analyser "${p.analyser}" exists`, !!ANALYSERS[p.analyser]);

  console.log('\nValidation catches mistakes');
  const step = P['step-7x200'];
  ok('bad key', validateProtocol({ ...step, key: 'Step Test' }) !== null);
  ok('unknown measure', validateProtocol({ ...step, measures: ['time', 'vo2'] }) !== null);
  ok('unknown analyser', validateProtocol({ ...step, analyser: 'magic' }) !== null);
  ok('line param with no matching protocol param', validateProtocol({ ...step, params: {} }) !== null);
  ok('param kind must fit the interval type',
     validateProtocol({ ...step, params: { sendOff: { kind: 'restSec', default: 30 } } }) !== null);
  ok('bad param default', validateProtocol({ ...step, params: { sendOff: { kind: 'onTime', default: 'soon' } } }) !== null);

  console.log('\nParams');
  const r1 = resolveParams(step.set, step.params, { sendOff: '5:30' });
  ok('chosen send-off applied to every opted-in line', r1.set.blocks[0].lines.every((l) => l.interval.onTime === '5:30'));
  ok('used params reported', r1.params.sendOff === '5:30');
  ok('stored set not mutated', step.set.blocks[0].lines[0].interval.onTime === '5:00');
  const r2 = resolveParams(step.set, step.params, { sendOff: 'rubbish' });
  ok('invalid choice falls back to default', r2.params.sendOff === '5:00');
  const turn = P['turn-20x100'];
  const r3 = resolveParams(turn.set, turn.params, { sendOff: '1:25' });
  ok('20×100: the 100s change, the BK 200 keeps 4:00',
     r3.set.blocks[0].lines[0].interval.onTime === '1:25' && r3.set.blocks[0].lines[1].interval.onTime === '4:00'
     && r3.set.blocks[0].lines[2].interval.onTime === '1:25');
  const t10 = P['t10x400'];
  ok('restSec param applied', resolveParams(t10.set, t10.params, { rest: 45 }).set.blocks[0].lines[0].interval.restSec === 45);

  console.log('\nExpansion + measures');
  const turnReps = expandReps(turn.set, turn);
  ok('20×100 expands to 21 reps', turnReps.length === 21, turnReps.length);
  ok('rep 11 is the BK 200 and measures nothing', turnReps[10].stroke === 'BK' && turnReps[10].measures.length === 0, turnReps[10]);
  ok('AT reps measure time + sc', JSON.stringify(turnReps[0].measures) === '["time","sc"]');
  ok('line without measures inherits protocol default', JSON.stringify(lineMeasures(step, step.set.blocks[0].lines[0])) === JSON.stringify(step.measures));

  console.log('\nPrescription');
  const pr = prescribe(step, { chosen: { sendOff: '5:00' }, athlete });
  const reps = pr.athletes[0].reps;
  ok('7 reps for Sam', reps.length === 7);
  ok('step 1 target = PB+30 = 2:40', reps[0].targetTime === '2:40', reps[0].targetTime);
  ok('step 7 target = PB = 2:10', reps[6].targetTime === '2:10', reps[6].targetTime);
  ok('rest on 5:00 after a 2:40 = 140 s', reps[0].restSec === 140, reps[0].restSec);
  ok('pbAtSwim frozen on each rep', reps.every((r) => r.pbAtSwim === 130));
  ok('prescription carries protocol id/key/version', pr.protocolId === step.id && pr.key === 'step-7x200' && pr.version === 1);
  const noPb = prescribe(step, { athlete: { id: 'b', name: 'New', pbByEvent: {} } }).athletes[0].reps[0];
  ok('no PB → unresolved, shows the rule', noPb.target.resolved === false && noPb.target.display === 'PB+30', noPb.target);
  const grp = prescribeGroup(step, { athletes: [athlete, { id: 'a2', name: 'Jo', pbByEvent: { FS200: 140 } }] });
  ok('group: one set, two athletes, own targets', grp.athletes.length === 2 && grp.athletes[1].reps[6].targetTime === '2:20');
  ok('no athletes → preview reps', Array.isArray(prescribeGroup(step, {}).reps) && prescribeGroup(step, {}).reps.length === 7);

  console.log('\nMetrics + constraints');
  ok('cleanMetrics keeps known numeric keys', JSON.stringify(cleanMetrics({ hr: '162', sc: 14, vo2: 50, rpe: '' })) === '{"sc":14,"hr":162}');
  ok('cleanMetrics keeps sensor HR figures', JSON.stringify(cleanMetrics({ hr: 170, hrPeak: 176, hrRec30: 141, hrCoverage: 0.8, bogus: 1 })) === '{"hr":170,"hrPeak":176,"hrRec30":141,"hrCoverage":0.8}');
  const broken = checkConstraints({ scMax: 16, hrMin: 150 }, { sc: 18, hr: 140 });
  ok('constraints flag both breaches', broken.length === 2, broken);
  ok('constraints: none broken', checkConstraints({ scMax: 16 }, { sc: 15 }).length === 0);

  console.log('\nAnalysers');
  // Step: 7 × 200, getting faster, HR and lactate rising.
  const stepSwum = [160, 155, 150, 145, 140, 135, 130].map((ts, i) => ({
    repNo: i + 1, distM: 200, stroke: 'FS', timeSec: ts,
    metrics: { hr: 130 + i * 10, lactate: [1.2, 1.4, 1.8, 2.5, 3.4, 5.0, 8.1][i] },
  }));
  const s1 = analyse('step', stepSwum);
  ok('step: 7 steps', s1.steps.length === 7);
  ok('step: speed at 4 mmol lies between steps 5 and 6', s1.speedAt4mmol > 200 / 140 && s1.speedAt4mmol < 200 / 135, s1.speedAt4mmol);
  ok('step: peak HR 190', s1.peakHr === 190);
  ok('step: HR rises with speed', s1.hrPerSpeed > 0, s1.hrPerSpeed);

  const c = analyse('css', [{ repNo: 1, distM: 400, timeSec: 280 }, { repNo: 2, distM: 200, timeSec: 130 }]);
  ok('css: 200/(280−130) = 1.333 m/s → 1:15.0 per 100', c.cssMs === 1.333 && c.cssPer100Sec === 75, c);
  ok('css: missing 200 reported, not thrown', !!analyse('css', [{ distM: 400, timeSec: 280 }]).error);

  const dd = analyse('double-distance', [{ repNo: 1, distM: 400, timeSec: 290, targetTime: '4:45',
    splits: [{ dist: 100, sec: 70 }, { dist: 200, sec: 142 }, { dist: 300, sec: 216 }, { dist: 400, sec: 290 }] }]);
  ok('double-distance: +5 s vs target', dd.vsTargetSec === 5, dd);
  ok('double-distance: fade = 148 − 142 = 6 s', dd.firstHalfSec === 142 && dd.fadeSec === 6, dd);
  const ddLaps = analyse('double-distance', [{ distM: 400, timeSec: 290,
    splits: [{ dist: 100, sec: 70 }, { dist: 100, sec: 72 }, { dist: 100, sec: 74 }, { dist: 100, sec: 74 }] }]);
  ok('double-distance: lap splits understood too', ddLaps.firstHalfSec === 142, ddLaps);

  const turnSwum = turnReps.map((r) => ({ ...r,
    timeSec: r.stroke === 'BK' ? 170 : (r.repNo <= 10 ? 75 : 77),
    metrics: r.stroke === 'BK' ? {} : { sc: r.repNo <= 10 ? 40 : 43 } }));
  const b = analyse('blocks', turnSwum, { set: turn.set });
  ok('blocks: recovery 200 excluded (2 blocks)', b.blocks.length === 2, b.blocks);
  ok('blocks: set 2 is 2 s slower', b.dropOffSec === 2, b.dropOffSec);
  ok('blocks: 3 more strokes in set 2', b.dropOffSc === 3, b.dropOffSc);

  const sw = analyse('swolf', [30, 31, 32].map((ts, i) => ({ repNo: i + 1, distM: 50, timeSec: ts, metrics: { sc: 36 - i } })));
  ok('swolf: 66, 66, 66 → best 66', sw.bestSwolf === 66 && sw.meanSwolf === 66, sw);

  const mh = analyse('maxhr', [{ repNo: 1, metrics: { hr: 170 } }, { repNo: 4, metrics: { hr: 196 } }]);
  ok('maxhr: 196 on rep 4', mh.peakHr === 196 && mh.peakRepNo === 4);
  const mh2 = analyse('maxhr', [{ repNo: 1, metrics: { hr: 190 } }, { repNo: 2, metrics: { hr: 188, hrPeak: 199 } }]);
  ok('maxhr v2: sensor in-rep peak counts', mh2.peakHr === 199 && mh2.peakRepNo === 2 && mh2.v === 2, mh2);

  const se = analyse('series', [290, 292, 294, 296].map((ts, i) => ({ repNo: i + 1, distM: 400, timeSec: ts, metrics: { hr: 160 } })));
  ok('series: mean 293, spread 6, drift +2 s/rep', se.meanSec === 293 && se.spreadSec === 6 && se.driftSecPerRep === 2, se);
  ok('unknown analyser falls back to series', analyse('nope', []).analyser === 'series');
  ok('analyse stamps analyser + version', s1.analyser === 'step' && s1.v === 1);

  console.log('\nPoolside hand-off');
  const grp2 = prescribeGroup(turn, { chosen: { sendOff: '1:25' }, athletes: [athlete, { id: 'a2', name: 'Jo', pbByEvent: {} }] });
  const h = buildHandoff(grp2, 'a2', { sessionId: 'sess-1' });
  ok('hand-off is for the chosen swimmer', h.athlete.id === 'a2' && h.athlete.name === 'Jo');
  ok('hand-off carries 21 reps with measures and resolved send-off',
     h.reps.length === 21 && h.reps[10].measures.length === 0 && h.reps[0].interval.onTime === '1:25');
  ok('hand-off carries protocol identity', h.protocol.key === 'turn-20x100' && h.protocol.id === turn.id && h.sessionId === 'sess-1');
  const enc = await encodeHandoff(h);
  ok('encoded compactly (deflate) for a URL', enc.startsWith('z.') && enc.length < 2500 && /^[A-Za-z0-9._-]+$/.test(enc), enc.length);
  ok('decodes back to the same object', JSON.stringify(await decodeHandoff(enc)) === JSON.stringify(h));
  const stepH = buildHandoff(prescribe(step, { athlete }), 'a1');
  ok('step hand-off has targets as labels', stepH.reps[0].targetLabel === '2:40' && stepH.reps[0].targetTime === '2:40');
  let threw = false; try { await decodeHandoff('x.abc'); } catch (e) { threw = true; }
  ok('rejects a non-SwimZone string', threw);

  console.log('\nLadder levels (100s ladder)');
  const lad = P['ladder-100s'];
  ok('ladder seed validates', lad && validateProtocol(lad) === null, lad && validateProtocol(lad));
  const L2 = resolveParams(lad.set, lad.params, { level: 'L2' });
  ok('level 2 sets 25 reps on 1:25', L2.set.blocks[0].lines[0].qty === 25 && L2.set.blocks[0].lines[0].interval.onTime === '1:25' && L2.params.level === 'L2', L2.set.blocks[0].lines[0]);
  const L3 = resolveParams(lad.set, lad.params, { level: 'L3' });
  ok('level 3 sets 30 reps on 1:20', L3.set.blocks[0].lines[0].qty === 30 && L3.set.blocks[0].lines[0].interval.onTime === '1:20');
  ok('unknown level falls back to level 1', resolveParams(lad.set, lad.params, { level: 'L9' }).params.level === 'L1');
  ok('stored ladder set not mutated', lad.set.blocks[0].lines[0].qty === 20);
  const J1 = resolveParams(lad.set, lad.params, { level: 'J1' }).set.blocks[0].lines[0];
  ok('junior 1 sets 10 reps on 2:00', J1.qty === 10 && J1.interval.onTime === '2:00', J1);
  const N2 = resolveParams(lad.set, lad.params, { level: 'N2' }).set.blocks[0].lines[0];
  ok('national 2 sets 40 reps on 1:10', N2.qty === 40 && N2.interval.onTime === '1:10', N2);
  ok('levels run junior → club → national', lad.params.level.options.map((o) => o.value).join() === 'J1,J2,J3,L1,L2,L3,N1,N2');
  ok('prescription at level 3 has 30 reps', prescribe(lad, { chosen: { level: 'L3' }, athlete }).athletes[0].reps.length === 30);
  ok('level labels for the dropdown', paramValueLabel(lad.params.level, 'L2') === 'Club 2 — 25×100 on 1:25' && levelOption(lad.params.level, 'L3').qty === 30);
  ok('level with no qty rejected', validateProtocol({ ...lad, params: { level: { kind: 'level', default: 'A', options: [{ value: 'A', onTime: '1:30' }] } } }) !== null);
  ok('level default must be one of its levels', validateProtocol({ ...lad, params: { level: { ...lad.params.level, default: 'L7' } } }) !== null);
  ok('level on a rest line needs restSec', validateProtocol({ ...lad, set: { ...lad.set, blocks: [{ repeats: 1, lines: [{ ...lad.set.blocks[0].lines[0], interval: { type: 'rest', restSec: 10, param: 'level' } }] }] } }) !== null);
  const hand = buildHandoff(prescribe(lad, { chosen: { level: 'L2' }, athlete }), 'a1');
  ok('Poolside hand-off carries 25 reps on 1:25', hand.reps.length === 25 && hand.reps[24].interval.onTime === '1:25' && hand.params.level === 'L2');

  // swum ladders
  const swim = (n, base, slope, sc0) => Array.from({ length: n }, (_, i) => ({ repNo: i + 1, distM: 100, stroke: 'FS', timeSec: base + slope * i, metrics: { sc: sc0 + Math.floor(i / 5) } }));
  const a1 = analyse('ladder', swim(20, 75, 0.1, 40), { set: resolveParams(lad.set, lad.params, { level: 'L1' }).set, params: { level: 'L1' } });
  ok('L1: all 20 swum, ≥5 s rest every rep → held', a1.level === 'L1' && a1.prescribed === 20 && a1.swum === 20 && a1.completed && a1.held === true, a1);
  ok('L1: per-100 pace, first-5/last-5 fade', a1.per100Sec === 75.95 && a1.first5MeanSec === 75.2 && a1.last5MeanSec === 76.7 && a1.fadeSec === 1.5, a1);
  ok('L1: rest gained on 1:30', a1.sendOffSec === 90 && a1.minRestSec === 13.1 && a1.repsInsideSendOff === 20, a1);
  ok('L1: stroke count change first-5 vs last-5', a1.first5Sc === 40 && a1.last5Sc === 43 && a1.scFade === 3, a1);
  const a3 = analyse('ladder', swim(30, 76, 0.2, 41), { set: L3.set, params: { level: 'L3' } });
  ok('L3: last reps under 5 s rest → not held', a3.completed && a3.held === false && a3.minRestSec < LADDER_MIN_REST_SEC, a3);
  ok('L3: fade uses the same 5-rep windows (comparable with L1)', a3.first5MeanSec === 76.4 && a3.last5MeanSec === 81.4 && a3.fadeSec === 5, a3);
  const a2 = analyse('ladder', swim(18, 74, 0, 40), { set: L2.set, params: { level: 'L2' } });
  ok('L2 stopped at 18 of 25 → not completed, not held', a2.completed === false && a2.held === false && a2.swum === 18 && a2.prescribed === 25, a2);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
