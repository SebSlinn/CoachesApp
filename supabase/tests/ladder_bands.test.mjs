// ladder_bands.test.mjs — 20261009120000_ladder_bands.sql, both paths, PGlite.
//   A. ladder not used yet  → updated in place (still v1, 8 levels)
//   B. ladder already used  → v1 untouched and locked, v2 added with 8 levels
// Re-running is a no-op in both. Uses the real migration chain.
//
//   node supabase/tests/ladder_bands.test.mjs
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { validateProtocol } from '../../src/session/protocolFormat.js';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };
const BANDS = 'supabase/migrations/20261009120000_ladder_bands.sql';
const CHAIN = ['20260927120000_athlete_records.sql', '20260928120000_drop_import_dedup.sql', '20260929120000_test_protocols.sql',
  '20261006130000_ladder_100s.sql'];

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
const ladders = async (db) => (await db.query(`select id, version, name, locked, params, set_json, measures, analyser
  from public.test_protocols where key='ladder-100s' order by version`)).rows;
const levels = (row) => row.params.level.options.map((o) => o.value).join(',');
const asProtocol = (r) => ({ key: 'ladder-100s', version: r.version, name: r.name, set: r.set_json, measures: r.measures, params: r.params, analyser: r.analyser });
const EIGHT = 'J1,J2,J3,L1,L2,L3,N1,N2';

async function run() {
  console.log('\nA. not used yet → updated in place');
  {
    const db = await fresh();
    await db.exec(readFileSync(BANDS, 'utf8'));
    const rows = await ladders(db);
    ok('still one version', rows.length === 1 && rows[0].version === 1, rows.map((r) => r.version));
    ok('eight levels, lowest first', levels(rows[0]) === EIGHT, levels(rows[0]));
    ok('club levels keep their sets', JSON.stringify(rows[0].params.level.options.slice(3, 6).map((o) => [o.value, o.qty, o.onTime])) ===
      JSON.stringify([['L1', 20, '1:30'], ['L2', 25, '1:25'], ['L3', 30, '1:20']]));
    ok('default still L1', rows[0].params.level.default === 'L1');
    ok('renamed "100s Ladder"', rows[0].name === '100s Ladder');
    ok('valid protocol for the app', validateProtocol(asProtocol(rows[0])) === null, validateProtocol(asProtocol(rows[0])));
    await db.exec(readFileSync(BANDS, 'utf8'));
    ok('re-running is a no-op', (await ladders(db)).length === 1);
  }

  console.log('\nB. already used → version 2');
  {
    const db = await fresh();
    const athlete = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await db.query(`insert into public.users (id) values ($1)`, [athlete]);
    const v1 = (await ladders(db))[0];
    await db.query(`insert into public.set_efforts (athlete_user_id, swum_on, protocol_id, set_json, conditions)
      values ($1, '2026-10-03', $2, $3, '{"params":{"level":"L2"}}')`, [athlete, v1.id, v1.set_json]);
    ok('a saved run locks v1', (await ladders(db))[0].locked === true);
    await db.exec(readFileSync(BANDS, 'utf8'));
    const rows = await ladders(db);
    ok('v2 added', rows.length === 2 && rows[1].version === 2, rows.map((r) => r.version));
    ok('v1 untouched: three levels, still locked', levels(rows[0]) === 'L1,L2,L3' && rows[0].locked, levels(rows[0]));
    ok('v2 has the eight levels, unlocked', levels(rows[1]) === EIGHT && !rows[1].locked);
    ok('v2 same set, measures and analyser', JSON.stringify(rows[1].set_json) === JSON.stringify(rows[0].set_json) &&
      rows[1].measures.join() === rows[0].measures.join() && rows[1].analyser === rows[0].analyser);
    ok('v2 valid protocol for the app', validateProtocol(asProtocol(rows[1])) === null, validateProtocol(asProtocol(rows[1])));
    await db.exec(readFileSync(BANDS, 'utf8'));
    ok('re-running is a no-op (no v3)', (await ladders(db)).length === 2);
  }

  console.log('\nC. ladder missing → no error');
  {
    const db = await fresh();
    await db.exec(`delete from public.test_protocols where key='ladder-100s'`);
    let err = null; try { await db.exec(readFileSync(BANDS, 'utf8')); } catch (e) { err = e.message; }
    ok('applies cleanly with a notice', err === null, err);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
