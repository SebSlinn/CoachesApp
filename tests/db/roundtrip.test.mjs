// tests/db/roundtrip.test.mjs — results go IN through the app's own code and come
// back OUT, against the real database schema.
//
//   PGlite (Postgres) + the FULL migration chain in supabase/migrations/ (accounts →
//   athlete records → test protocols → export views) + the real services/results.js
//   and the real Supabase repositories, talking to Postgres through
//   tests/db/fakeSupabase.js as a signed-in user — so Row Level Security,
//   constraints and triggers are the real ones.
//
// Fixtures are real Poolside output (simulated HR sensor):
//   poolside-test-hr.json    a test run (2 × 25 m lengths, SC/SR/HR per length, hrStream)
//   poolside-free-hr.json    a free session, 100 m, sensor
//   poolside-free-nohr.json  the same without a sensor
//
//   node tests/db/run.mjs
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { attach, signIn } from './fakeSupabase.js';
import * as R from '../../src/services/results.js';
import * as P from '../../src/services/protocols.js';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };
const fx = (f) => JSON.parse(fs.readFileSync(new URL('./fixtures/' + f, import.meta.url)));
const MIG = 'supabase/migrations';

// ---------------------------------------------------------------------------
console.log('\nDatabase: full migration chain');
const db = new PGlite();
await db.exec(`
  create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon, service_role;
  grant execute on function auth.uid() to authenticated, anon, service_role;
  -- the tables that existed before the first migration (as in the live project)
  create table public.users (id uuid primary key, email text, full_name text, avatar_url text, created_at timestamptz default now());
  create table public.organisations (id uuid primary key default gen_random_uuid(), name text, org_type text,
     invitation_quota int, created_by uuid, created_at timestamptz default now());
  create table public.memberships (id uuid primary key default gen_random_uuid(),
     user_id uuid references public.users(id), org_id uuid references public.organisations(id),
     role text constraint memberships_role_check check (role = any (array['athlete','coach','manager','admin','guardian'])),
     status text default 'active' constraint memberships_status_check check (status = any (array['pending','active','suspended'])),
     created_at timestamptz default now());
`);
const files = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  try { await db.exec(fs.readFileSync(`${MIG}/${f}`, 'utf8')); ok(`applied ${f}`, true); }
  catch (e) { ok(`applied ${f}`, false, e.message); }
}
await db.exec(`grant usage on schema public to authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to authenticated, service_role;`);

// people: Al (root), a coach, Esmee (adult swimmer) who shares her log with the coach, a stranger
const U = {};
for (const n of ['al', 'coach', 'esmee', 'stranger']) {
  U[n] = (await db.query(`insert into users(id,email,full_name,date_of_birth) values (gen_random_uuid(), $1, $2, '1990-01-01') returning id`,
    [`${n}@x.com`, n])).rows[0].id;
}
await db.exec(fs.readFileSync('supabase/bootstrap_root.sql', 'utf8').replace(/alsonline@outlook\.com/g, 'al@x.com'));
await db.query(`insert into log_permissions(owner_user_id, grantee_user_id, can_read, can_add, can_edit, status)
                values ($1, $2, true, true, false, 'active')`, [U.esmee, U.coach]);
attach(db);

// ---------------------------------------------------------------------------
console.log('\nA test protocol to run (root adds it to the global library)');
signIn(U.al);
const testFile = fx('poolside-test-hr.json');
const proto = await P.createProtocol(null, { key: 'mini-hr', name: testFile.protocolName, set: testFile.set,
  measures: ['time', 'hr', 'rpe', 'sc', 'sr'], params: {}, analyser: 'series' });
ok('protocol saved', proto.data && proto.data.id, proto.error);

// ---------------------------------------------------------------------------
console.log('\nIN: coach imports the Poolside TEST file for Esmee');
signIn(U.coach);
const file = { ...testFile, protocolId: proto.data.id, athleteId: U.esmee };
const imp = await R.ingestPoolsideSetResult(file, { expectAthleteId: U.esmee });
ok('saved', imp.data && imp.data.reps === file.reps.length && !imp.data.alreadyPresent, imp.error || imp.data);
ok('summary computed by the analyser', imp.data?.summary?.analyser === 'series', imp.data?.summary);
const again = await R.ingestPoolsideSetResult(file, { expectAthleteId: U.esmee });
ok('importing the same file again saves nothing new', again.data?.alreadyPresent === true, again);

console.log('\nOUT: the run read back through the app (Test Sets → Previous runs)');
const runs = (await R.getSetResultsByProtocol(proto.data.id, U.esmee)).data || [];
ok('one run on record', runs.length === 1, runs.length);
const run = runs[0] || { reps: [] };
const rep = (run.reps || [])[0] || {};
const want = file.reps[0];
ok('rep time kept to the hundredth', Number(rep.timeSec) === want.timeSec, [rep.timeSec, want.timeSec]);
ok('rep heart rate stored: HR-Start, min, avg, max, HR-End', ['hrStart', 'hrMin', 'hrAvg', 'hrPeak', 'hrEnd']
  .every((k) => rep.metrics?.[k] != null), rep.metrics);
ok('typed readings kept (RPE)', rep.metrics?.rpe === want.metrics.rpe, rep.metrics);
ok('per-length splits stored with SC, SR, HR1, HR2', Array.isArray(rep.splits) && rep.splits.length === 2 &&
  rep.splits.every((s) => s.sc != null && s.sr != null && s.hrFirst != null && s.hrLast != null), rep.splits);
ok('per length holds first/last only (no min/avg/max)', rep.splits?.every((s) => !('hrAvg' in s) && !('hrPeak' in s)), rep.splits);
ok('raw heart-rate stream kept with the run', run.conditions?.hrStream?.samples?.length === file.hrStream.samples.length,
  run.conditions?.hrStream?.samples?.length);
ok('stored HR matches the stream, re-derived on save', rep.metrics?.hrEnd === want.metrics.hrEnd && rep.metrics?.hrPeak === want.metrics.hrPeak,
  [rep.metrics, want.metrics]);
ok('protocol locked after first use', (await P.getProtocol(proto.data.id)).data?.locked === true);

console.log('\nRep start times (for measured rest)');
ok('rep start time saved and read back', rep.startedAt && Date.parse(rep.startedAt) === Date.parse(want.startedAt), [rep.startedAt, want.startedAt]);
// a run saved before start times were kept: clear them, then re-import the same file
await db.query(`update performance_results set started_at = null where effort_id = $1`, [run.id]);
signIn(U.stranger);
const notMine = await R.ingestPoolsideSetResult(file, {});
ok("a stranger's re-import fills nothing", !notMine.data?.startsFilled, notMine);
signIn(U.coach);
const refill = await R.ingestPoolsideSetResult(file, { expectAthleteId: U.esmee });
ok('re-importing the file fills the missing start times', refill.data?.alreadyPresent === true && refill.data?.startsFilled === file.reps.length, refill.data);
const back = ((await R.getSetResultsByProtocol(proto.data.id, U.esmee)).data || [])[0]?.reps?.[0] || {};
ok('…and they read back', Date.parse(back.startedAt) === Date.parse(want.startedAt), back.startedAt);
ok('…without changing the time', Number(back.timeSec) === want.timeSec);
const third = await R.ingestPoolsideSetResult(file, { expectAthleteId: U.esmee });
ok('a third import fills nothing (only empty start times are set)', third.data?.startsFilled === 0, third.data);

// ---------------------------------------------------------------------------
console.log('\nIN: coach imports two FREE Poolside sessions (with and without a sensor)');
const freeHr = fx('poolside-free-hr.json');
const freeNo = fx('poolside-free-nohr.json');
const f1 = await R.ingestPoolsideExport(U.esmee, freeHr);
const f2 = await R.ingestPoolsideExport(U.esmee, freeNo);
ok('free session with HR saved', f1.data?.added === freeHr.records.length, f1);
ok('free session without HR saved', f2.data?.added === freeNo.records.length, f2);
ok('re-import is a no-op', (await R.ingestPoolsideExport(U.esmee, freeHr)).data?.added === 0);

console.log('\nOUT: Esmee\'s swim log through the app');
const log = (await R.getResults(U.esmee, {})).data || [];
ok('both training swims in the log (set reps kept separate)', log.length === 2, log.map((r) => r.timeSec));
const withHr = log.find((r) => r.metrics?.hrAvg != null);
const noHr = log.find((r) => r.metrics?.hrAvg == null);
ok('swim with sensor carries rep HR + per-length HR1/HR2', withHr && withHr.splits?.every((s) => s.hrFirst != null), withHr);
ok('swim without sensor saved cleanly (no HR, splits intact)', noHr && noHr.splits?.length === 4 && noHr.splits.every((s) => s.hrFirst == null), noHr);
ok('training swims are submaximal — they never touch PBs', log.every((r) => r.effort === 'submaximal'), log.map((r) => r.effort));
const bests = (await R.getAthleteBests(U.esmee, {})).data;
ok('bests unchanged by training/test swims', !bests || (bests.bests || []).length === 0, bests);

// ---------------------------------------------------------------------------
console.log('\nOUT: the export views (what a spreadsheet / SQL export reads)');
async function asUser(uid, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
}
const vr = await asUser(U.coach, `select * from v_set_rep_metrics where athlete_user_id = '${U.esmee}' order by rep_no`);
ok('v_set_rep_metrics: test rep with HR columns', vr.length === 1 && Number(vr[0].hr_end) === want.metrics.hrEnd && vr[0].protocol_key === 'mini-hr', vr[0]);
const vs = await asUser(U.coach, `select * from v_swim_metrics where athlete_user_id = '${U.esmee}' order by created_at`);
ok('v_swim_metrics: all 3 swims (1 test rep + 2 training)', vs.length === 3, vs.map((x) => [x.kind, x.time_sec]));
const vl = await asUser(U.coach, `select * from v_length_metrics where athlete_user_id = '${U.esmee}' order by swum_on, result_id, length_no`);
ok('v_length_metrics: 2 + 4 + 4 lengths', vl.length === 10, vl.length);
const tl = vl.filter((x) => x.protocol_key === 'mini-hr');
ok('test lengths: lap times from cumulative splits', tl.length === 2 && Number(tl[1].lap_sec) === Math.round((want.splits[1].sec - want.splits[0].sec) * 100) / 100,
  tl.map((x) => [x.lap_sec, x.cum_sec]));
ok('test lengths: SC / SR / HR1 / HR2 as columns', Number(tl[0].sc) === want.splits[0].sc && Number(tl[0].hr1) === want.splits[0].hrFirst && Number(tl[0].hr2) === want.splits[0].hrLast, tl[0]);
const fl = vl.filter((x) => x.effort_id == null && x.hr1 != null);   // single swims (test reps are 'training' too, but have an effort)
ok('free-swim lengths: lap from ms, HR1/HR2 present', fl.length === 4 && Number(fl[0].lap_sec) === Math.round(freeHr.records[0].splits[0].ms / 10) / 100, fl.map((x) => x.lap_sec));
ok('free-swim lengths without a sensor: HR blank, times present', vl.filter((x) => x.effort_id == null && x.hr1 == null && x.lap_sec != null).length === 4);

// ---------------------------------------------------------------------------
console.log('\nPrivacy (Row Level Security)');
ok('Esmee sees her own swims', (await asUser(U.esmee, `select count(*)::int n from v_swim_metrics`))[0].n === 3);
ok('a stranger sees none of them', (await asUser(U.stranger, `select count(*)::int n from v_swim_metrics`))[0].n === 0);
ok('a stranger sees no lengths', (await asUser(U.stranger, `select count(*)::int n from v_length_metrics`))[0].n === 0);
signIn(U.stranger);
const sneaky = await R.ingestPoolsideExport(U.esmee, { ...freeHr, records: freeHr.records.map((r) => ({ ...r, id: crypto.randomUUID() })) });
ok('a stranger cannot add swims to Esmee\'s log', !!sneaky.error && /row-level security/i.test(sneaky.error.message), sneaky);
ok('nor read her runs through the app', ((await R.getSetResultsByProtocol(proto.data.id, U.esmee)).data || []).length === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
