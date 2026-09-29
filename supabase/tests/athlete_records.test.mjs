// athlete_records.test.mjs — Part A migration checks, PGlite, self-contained.
//
// SELF-CONTAINED: it stubs the few things the athlete-records migration depends
// on (public.users, a base public.performance_results, and has_log_access) and
// then applies ONLY the athlete-records migration. It does NOT need the accounts
// migration chain (those alter pre-existing base tables and would need the whole
// accounts harness). Run it simply as:
//
//   npm i @electric-sql/pglite
//   node supabase/tests/athlete_records.test.mjs
//
// (Optionally pass a different migration path as the first arg.)
//
// Focus: the two guarantees the design hangs on —
//   1. comp import is append-only + idempotent via a deterministic client_uuid;
//   2. set reps never leak into PB/CS ("maximal single swim") queries.

import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = process.argv[2] || 'supabase/migrations/20260927120000_athlete_records.sql';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

const db = new PGlite();

// Deterministic uuid from a natural key (test-local), mirroring how the app
// assigns client_uuid to imported swims.
function keyUuid(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) h = (Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0);
  const x = ('0000000' + h.toString(16)).slice(-8);
  return `${x}-${x.slice(0, 4)}-4${x.slice(1, 4)}-8${x.slice(0, 3)}-${x}${x.slice(0, 4)}`;
}

async function bootstrapPrereqs() {
  // auth.uid() stub (RLS bodies reference it). gen_random_uuid() is core PG13+.
  await db.exec(`create schema if not exists auth;`);
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable
                 as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;`);
  // Pre-existing base tables the athlete-records migration builds on. Shapes per
  // LOGIN-MEMBERSHIPS-CONTEXT (only what this migration touches).
  await db.exec(`create table public.users (
    id uuid primary key, email text, full_name text, avatar_url text, created_at timestamptz default now());`);
  await db.exec(`create table public.performance_results (
    id uuid primary key default gen_random_uuid(),
    athlete_user_id uuid not null references public.users(id) on delete cascade,
    swum_on date not null, kind text, stroke text, dist_m int, pool_type text,
    time_sec numeric, splits jsonb, location text, notes text, source text,
    created_by uuid, updated_by uuid, created_at timestamptz default now(), updated_at timestamptz);`);
  // has_log_access is a SECURITY DEFINER helper from the accounts migration; stub it.
  await db.exec(`create or replace function public.has_log_access(o uuid, m text) returns boolean
                 language sql stable as $$ select false $$;`);
}

async function run() {
  await bootstrapPrereqs();

  console.log('\nApplying migration ' + MIGRATION + '…');
  try { await db.exec(readFileSync(MIGRATION, 'utf8')); console.log('  applied'); }
  catch (e) { console.error('  FAILED: ' + e.message); process.exit(1); }

  // ---- structural checks ---------------------------------------------------
  console.log('\nSchema');
  const cols = (await db.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='performance_results'`)).rows.map(r => r.column_name);
  for (const c of ['client_uuid','effort','effort_id','rep_no','pb_at_swim_sec',
                   'sanctioned','awarding_body','country','meet_name','import_ref']) {
    ok(`performance_results.${c} exists`, cols.includes(c));
  }
  const se = (await db.query(`
    select count(*)::int n from information_schema.tables
    where table_schema='public' and table_name='set_efforts'`)).rows[0].n;
  ok('set_efforts table exists', se === 1);

  const idx = (await db.query(`
    select indexname from pg_indexes where schemaname='public'
    and tablename='performance_results'`)).rows.map(r => r.indexname);
  ok('client_uuid unique index exists', idx.includes('performance_results_client_uuid_key'));

  const chk = (await db.query(`
    select 1 from information_schema.check_constraints c
    join information_schema.constraint_column_usage u using (constraint_name)
    where u.table_name='performance_results' and u.column_name='effort'`)).rows.length;
  ok('effort has a check constraint', chk > 0);

  // ---- seed a user ---------------------------------------------------------
  const uid = '00000000-0000-0000-0000-0000000000a1';
  await db.query(`insert into public.users (id, email, full_name) values ($1,$2,$3)`,
    [uid, 'al@example.com', 'Al']);

  // ---- guarantee 1: append-only import, idempotent via client_uuid ---------
  console.log('\nAppend-only comp import (deterministic client_uuid dedup)');
  async function importRow(dateStr, timeSec, meet) {
    return db.query(`
      insert into public.performance_results
        (athlete_user_id, client_uuid, swum_on, kind, stroke, dist_m, pool_type, time_sec,
         source, effort, meet_name, import_ref)
      values ($1,$2,$3,'meet','FS',1500,'50LC',$4,'import','maximal',$5,$6)
      on conflict (client_uuid) do nothing returning id`,
      [uid, keyUuid(`${dateStr}|${meet}`), dateStr, timeSec, meet, `ref:${dateStr}:${timeSec}`]);
  }
  ok('first import inserts', (await importRow('2026-01-18', 1110, 'Winter Open')).rows.length === 1);
  ok('re-import of the same swim is a no-op', (await importRow('2026-01-18', 1110, 'Winter Open')).rows.length === 0);
  ok('a faster later race APPENDS (not overwrite)', (await importRow('2026-03-02', 1098, 'Spring Meet')).rows.length === 1);
  ok('a slower later race is also kept', (await importRow('2026-04-10', 1125, 'April Gala')).rows.length === 1);
  const count1500 = (await db.query(`
    select count(*)::int n from public.performance_results
    where athlete_user_id=$1 and dist_m=1500 and source='import'`, [uid])).rows[0].n;
  ok('all three distinct 1500 races retained (history kept)', count1500 === 3, `got ${count1500}`);

  const man1 = await db.query(`insert into public.performance_results
    (athlete_user_id, swum_on, kind, stroke, dist_m, pool_type, time_sec, source, effort)
    values ($1,'2026-01-18','time_trial','FS',1500,'50LC',1112,'manual','maximal') returning id`, [uid]);
  const man2 = await db.query(`insert into public.performance_results
    (athlete_user_id, swum_on, kind, stroke, dist_m, pool_type, time_sec, source, effort)
    values ($1,'2026-01-18','time_trial','FS',1500,'50LC',1113,'manual','maximal') returning id`, [uid]);
  ok('manual entries are never blocked', man1.rows.length === 1 && man2.rows.length === 1);

  // ---- guarantee 2: set reps don't poison PB queries -----------------------
  console.log('\nSet reps vs PB queries');
  const eff = await db.query(`insert into public.set_efforts
    (athlete_user_id, swum_on, set_json, conditions, source, client_uuid)
    values ($1,'2026-05-10','{"fmt":"swimzone.set/1"}','{}','stopwatch',$2) returning id`,
    [uid, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
  const effId = eff.rows[0].id;
  for (let i = 1; i <= 3; i++) {
    await db.query(`insert into public.performance_results
      (athlete_user_id, swum_on, kind, stroke, dist_m, pool_type, time_sec, source, effort, effort_id, rep_no)
      values ($1,'2026-05-10','training','FS',100,'25SC',$2,'stopwatch','submaximal',$3,$4)`,
      [uid, 58 + i, effId, i]);
  }
  await db.query(`insert into public.performance_results
    (athlete_user_id, swum_on, kind, stroke, dist_m, pool_type, time_sec, source, effort)
    values ($1,'2026-05-11','meet','FS',100,'25SC',64,'manual','maximal')`, [uid]);

  const best = (await db.query(`select min(time_sec)::float m from public.performance_results
    where athlete_user_id=$1 and stroke='FS' and dist_m=100
      and effort_id is null and effort='maximal'`, [uid])).rows[0].m;
  ok('PB query ignores set reps (best 100 = 64, not 59)', best === 64, `got ${best}`);
  const repCount = (await db.query(`select count(*)::int n from public.performance_results where effort_id=$1`, [effId])).rows[0].n;
  ok('set reps are stored (3 children under the effort)', repCount === 3, `got ${repCount}`);
  await db.query(`delete from public.set_efforts where id=$1`, [effId]);
  const orphans = (await db.query(`select count(*)::int n from public.performance_results where effort_id=$1`, [effId])).rows[0].n;
  ok('deleting a set_effort cascades to its reps', orphans === 0, `got ${orphans}`);

  // ---- backfill: existing meet/TT rows became maximal ----------------------
  console.log('\nEffort backfill');
  // (the migration ran on an empty table here; assert the UPDATE statement is present)
  const sql = readFileSync(MIGRATION, 'utf8');
  ok('migration backfills meet/time_trial → maximal', /update\s+public\.performance_results[\s\S]*effort\s*=\s*'maximal'[\s\S]*kind\s+in\s*\(\s*'meet'\s*,\s*'time_trial'\s*\)/i.test(sql));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
