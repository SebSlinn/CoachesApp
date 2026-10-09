// move_endurance_runs.test.mjs — 20261009130000_move_endurance_runs_to_ladder.sql
// Replays the real history in PGlite: endurance tests added → a 30×100 on 1:20
// swum against end-30x100 → ladder added → endurance tests retired (the used one
// kept) → ladder bands → the move. Then checks the run is on the ladder at L3.
//
//   node supabase/tests/move_endurance_runs.test.mjs
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };
const M = (f) => readFileSync('supabase/migrations/' + f, 'utf8');
const ATH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
  for (const f of ['20260927120000_athlete_records.sql', '20260928120000_drop_import_dedup.sql', '20260929120000_test_protocols.sql',
    '20261005130000_add_endurance_tests.sql']) await db.exec(M(f));
  await db.query(`insert into public.users (id) values ($1)`, [ATH]);
  return db;
}
const proto = async (db, key) => (await db.query(`select * from public.test_protocols where key=$1 order by version desc limit 1`, [key])).rows[0];
async function swim(db, key, sendOff, date) {
  const p = await proto(db, key);
  const e = (await db.query(`insert into public.set_efforts (athlete_user_id, swum_on, protocol_id, set_json, conditions, summary)
    values ($1, $2, $3, $4, $5, '{"analyser":"series","v":1,"n":30,"meanSec":72.1}') returning id`,
    [ATH, date, p.id, p.set_json, JSON.stringify({ params: sendOff ? { sendOff } : {}, poolType: '25SC' })])).rows[0].id;
  await db.query(`insert into public.performance_results (athlete_user_id, effort_id, rep_no, swum_on, kind, effort, stroke, dist_m, time_sec)
    select $1, $2, g, $3, 'training', 'submaximal', 'FS', 100, 72 + g * 0.05 from generate_series(1, 3) g`, [ATH, e, date]);
  return e;
}
const later = async (db) => { for (const f of ['20261006130000_ladder_100s.sql', '20261006140000_remove_endurance_100s.sql', '20261009120000_ladder_bands.sql']) await db.exec(M(f)); };
const MOVE = M('20261009130000_move_endurance_runs_to_ladder.sql');
const effort = async (db, id) => (await db.query(`select se.*, tp.key, tp.version from public.set_efforts se join public.test_protocols tp on tp.id = se.protocol_id where se.id=$1`, [id])).rows[0];

async function run() {
  console.log('\nyour case: 30×100 on 1:20 swum before the ladder');
  {
    const db = await fresh();
    const e = await swim(db, 'end-30x100', '1:20', '2026-10-02');
    await later(db);
    ok('before: run still on end-30x100 (kept by the retire step)', (await effort(db, e)).key === 'end-30x100');
    await db.exec(MOVE);
    const x = await effort(db, e);
    ok('moved onto the 100s Ladder', x.key === 'ladder-100s', x.key);
    ok('at Club 3 (L3)', x.conditions.params.level === 'L3', x.conditions);
    ok('where it came from is kept', /end-30x100 v1 on 1:20/.test(x.conditions.movedFrom), x.conditions.movedFrom);
    ok('other conditions kept (pool)', x.conditions.poolType === '25SC');
    ok('old summary cleared for the ladder analyser', x.summary === null);
    const reps = (await db.query(`select count(*)::int n from public.performance_results where effort_id=$1`, [e])).rows[0].n;
    ok('reps untouched', reps === 3);
    ok('old test removed now nothing uses it', !(await proto(db, 'end-30x100')));
    const lad = await proto(db, 'ladder-100s');
    ok('ladder locked now it has a run', lad.locked === true);
    await db.exec(MOVE);
    ok('re-running is a no-op', (await effort(db, e)).key === 'ladder-100s');
  }

  console.log('\nonly exact ladder levels move');
  {
    const db = await fresh();
    const a = await swim(db, 'end-20x100', null, '2026-09-20');      // default send-off 1:40 → J3
    const b = await swim(db, 'end-20x100', '1:30', '2026-09-27');    // → L1
    const c = await swim(db, 'end-30x100', '1:15', '2026-10-01');    // not a ladder level
    await later(db);
    await db.exec(MOVE);
    ok('20×100 on 1:40 (default) → Junior 3', (await effort(db, a)).conditions.params.level === 'J3');
    ok('20×100 on 1:30 → Club 1', (await effort(db, b)).conditions.params.level === 'L1');
    const cc = await effort(db, c);
    ok('30×100 on 1:15 kept on its own test', cc.key === 'end-30x100' && cc.conditions.params.sendOff === '1:15', cc.key);
    ok('a test still in use is not removed', !!(await proto(db, 'end-30x100')) && !(await proto(db, 'end-20x100')));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
