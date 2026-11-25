// ladder_open.test.mjs — 20261125120000_ladder_open.sql (the ladder without levels), PGlite.
//   A. ladder not used yet  → changed in place (no levels, one open line, up to 60)
//   B. ladder already used  → old versions untouched and locked, next version added
// Re-running is a no-op in both. Then the app's view of it: prescription, hand-off,
// analyser, one history across versions. Uses the real migration chain.
//
//   node supabase/tests/ladder_open.test.mjs
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { validateProtocol, prescribe, buildHandoff, analyse, editableRepLines } from '../../src/session/protocolFormat.js';
import { compatibleSet, highestHeld } from '../../src/records/testVersions.js';
import { buildRunView, compareRuns } from '../../src/records/testReport.js';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };
const OPEN = 'supabase/migrations/20261125120000_ladder_open.sql';
const CHAIN = ['20260927120000_athlete_records.sql', '20260928120000_drop_import_dedup.sql', '20260929120000_test_protocols.sql',
  '20261006130000_ladder_100s.sql', '20261009120000_ladder_bands.sql', '20261009140000_ladder_level_names.sql'];

async function fresh() {
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
  for (const m of CHAIN) await db.exec(readFileSync('supabase/migrations/' + m, 'utf8'));
  return db;
}
const ladders = async (db) => (await db.query(`select id, version, name, locked, params, set_json, measures, analyser, owner_org_id
  from public.test_protocols where key='ladder-100s' order by version`)).rows;
const asProtocol = (r) => ({ id: r.id, key: 'ladder-100s', version: r.version, name: r.name, set: r.set_json, measures: r.measures,
  params: r.params, analyser: r.analyser, ownerOrgId: r.owner_org_id, locked: r.locked });
const line = (r) => r.set_json.blocks[0].lines[0];

async function run() {
  console.log('\nA. not used yet → changed in place');
  {
    const db = await fresh();
    await db.exec(readFileSync(OPEN, 'utf8'));
    const rows = await ladders(db);
    const r = rows[0];
    ok('still one version', rows.length === 1 && r.version === 1, rows.map((x) => x.version));
    ok('no levels — a send-off instead', !('level' in r.params) && r.params.sendOff.kind === 'onTime' && r.params.sendOff.default === '1:30', r.params);
    ok('send-offs 1:00 → 2:30 in 5 s', r.params.sendOff.options[0] === '1:00' && r.params.sendOff.options.at(-1) === '2:30' && r.params.sendOff.options.includes('2:00') && r.params.sendOff.options.length === 19);
    ok('one open line of 100s Free, up to 60', line(r).open === true && line(r).qty === 60 && line(r).distM === 100 && line(r).stroke === 'FS');
    ok('the line takes the send-off param', line(r).interval.type === 'fixed' && line(r).interval.param === 'sendOff');
    ok('valid protocol for the app', validateProtocol(asProtocol(r)) === null, validateProtocol(asProtocol(r)));
    await db.exec(readFileSync(OPEN, 'utf8'));
    ok('re-running is a no-op', (await ladders(db)).length === 1);
  }

  console.log('\nB. already used → next version');
  let lad, oldV;
  {
    const db = await fresh();
    const athlete = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await db.query(`insert into public.users (id) values ($1)`, [athlete]);
    const v1 = (await ladders(db))[0];
    await db.query(`insert into public.set_efforts (athlete_user_id, swum_on, protocol_id, set_json, conditions)
      values ($1, '2026-10-03', $2, $3, '{"params":{"level":"L3"}}')`, [athlete, v1.id, v1.set_json]);
    ok('a saved run locks v1', (await ladders(db))[0].locked === true);
    await db.exec(readFileSync(OPEN, 'utf8'));
    const rows = await ladders(db);
    ok('v2 added', rows.length === 2 && rows[1].version === 2, rows.map((x) => x.version));
    ok('v1 untouched: its levels, still locked', 'level' in rows[0].params && rows[0].locked && line(rows[0]).qty === 20);
    ok('v2: open line, send-off, same measures and analyser', line(rows[1]).open === true && 'sendOff' in rows[1].params &&
      rows[1].measures.join() === rows[0].measures.join() && rows[1].analyser === 'ladder');
    await db.exec(readFileSync(OPEN, 'utf8'));
    ok('re-running is a no-op (no v3)', (await ladders(db)).length === 2);
    oldV = asProtocol(rows[0]); lad = asProtocol(rows[1]);
  }

  console.log('\nC. ladder missing → no error');
  {
    const db = await fresh();
    await db.exec(`delete from public.test_protocols where key='ladder-100s'`);
    let err = null; try { await db.exec(readFileSync(OPEN, 'utf8')); } catch (e) { err = e.message; }
    ok('applies cleanly with a notice', err === null, err);
  }

  console.log('\nD. the open ladder in the app');
  {
    const athlete = { id: 'a1', name: 'Esmee', pbByEvent: { FS100: 62, FS200: 130, FS400: 280 } };
    const pr = prescribe(lad, { chosen: { sendOff: '2:00' }, athlete });
    const reps = pr.athletes[0].reps;
    ok('prescription: up to 60, every rep open, on 2:00', reps.length === 60 && reps.every((x) => x.open) && reps[0].interval.onTime === '2:00' && pr.params.sendOff === '2:00');
    ok('no reps box: an open line has no set number', editableRepLines(lad.set, lad.params).length === 0);
    const hand = buildHandoff(pr, 'a1');
    ok('hand-off reps carry open', hand.reps.length === 60 && hand.reps.every((x) => x.open) && hand.reps[59].interval.onTime === '2:00');
    ok('an unlisted send-off still works (1:22)', prescribe(lad, { chosen: { sendOff: '1:22' } }).reps[0].interval.onTime === '1:22');

    // Today's set: 16 × 100 on 2:00, start times 2:00 apart
    const t0 = Date.parse('2026-11-25T05:30:00Z');
    const swum = Array.from({ length: 16 }, (_, i) => ({ repNo: i + 1, distM: 100, stroke: 'FS', timeSec: 78 + 0.2 * i,
      startedAt: new Date(t0 + i * 120000).toISOString(), metrics: { sc: 40 + Math.floor(i / 5) } }));
    const s = analyse('ladder', swum, { set: pr.set, params: pr.params });
    ok('16 × 100 @ 2:00: label, swum, no prescribed count', s.label === '16 × 100 @ 2:00' && s.swum === 16 && s.prescribed === null && s.completed === null && s.open === true, s);
    ok('held: every rep well inside 2:00', s.held === true && s.sendOffSec === 120 && s.minRestSec === 39, s);
    ok('send-off swum measured from start times', s.measuredSendOffSec === 120, s.measuredSendOffSec);
    ok('fade over the reps swum', s.first5MeanSec === 78.4 && s.last5MeanSec === 80.6 && s.fadeSec === 2.2, s);
    const tight = analyse('ladder', swum, { set: prescribe(lad, { chosen: { sendOff: '1:22' } }).set, params: { sendOff: '1:22' } });
    ok('on 1:22 the last reps get under 5 s → not held', tight.held === false && tight.label === '16 × 100 @ 1:22', tight);
    ok('nothing swum → held unknown', analyse('ladder', [], { set: pr.set }).held === null);

    const { newest, versions } = compatibleSet([oldV, lad]);
    ok('old level version and the open one are one history', newest.version === 2 && versions.length === 2);
  }

  console.log('\nE. results: 16 on 2:00 beside an old 30 on 1:20');
  {
    const L3set = JSON.parse(JSON.stringify(oldV.set)); L3set.blocks[0].lines[0].qty = 30; L3set.blocks[0].lines[0].interval.onTime = '1:20';
    const mk = (n, base, step) => Array.from({ length: n }, (_, i) => ({ repNo: i + 1, distM: 100, stroke: 'FS', timeSec: Math.round((base + step * i) * 100) / 100, metrics: {} }));
    const old30 = { id: 'e30', swumOn: '2026-11-20', set: L3set, conditions: { params: { level: 'L3' } }, reps: mk(30, 74, 0.15) };
    const openSet = prescribe(lad, { chosen: { sendOff: '2:00' } }).set;
    const new16 = { id: 'e16', swumOn: '2026-11-25', set: openSet, conditions: { params: { sendOff: '2:00' } }, reps: mk(16, 73, 0.05) };
    const v30 = buildRunView(lad, old30), v16 = buildRunView(lad, new16);
    ok('old level run reads 30 × 100 @ 1:20', v30.levelLabel === '30 × 100 @ 1:20' && v30.prescribed === 30, v30.levelLabel);
    ok('open run reads 16 × 100 @ 2:00, asks for no set number', v16.levelLabel === '16 × 100 @ 2:00' && v16.prescribed === 0 && v16.swum === 16, [v16.levelLabel, v16.prescribed]);
    ok('open run recalculated (no stored summary) → held', v16.summary.held === true && v16.summary.open === true, v16.summary);
    const cmp = compareRuns([v30, v16]);
    ok('side by side: 30 rows, rep 16 in both, rep 17+ only in the 30', cmp.reps.length === 30 && cmp.reps[15].times.every((x) => x != null) && cmp.reps[16].times[1] == null);
    ok('flagged as different sets', cmp.levelsDiffer === true && cmp.labels[1] === '25 Nov 2026 · 16 × 100 @ 2:00', cmp.labels);
    const only16 = compareRuns([v16]);
    ok('an open run alone has just its 16 rows, not 60', only16.reps.length === 16, only16.reps.length);
    const hh = highestHeld(lad, [v30, v16]);
    ok('tightest held picks the run that was held', hh && hh.label === (v30.summary.held ? '30 × 100 @ 1:20' : '16 × 100 @ 2:00'), [hh, v30.summary.held]);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
