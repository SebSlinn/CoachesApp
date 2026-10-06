// athlete_profiles.test.mjs — per-athlete profile migration, PGlite, self-contained.
//
// Stubs public.users and has_log_access (a coach-grant table stands in for the
// accounts grant tree), applies ONLY the athlete-profiles migration, and checks
// RLS as real signed-in roles:
//   • the athlete and a coach with 'edit' access can save + read the profile;
//   • a coach with only 'read' access can read but not change it;
//   • a stranger sees nothing and can't write;
//   • one row per athlete (upsert), checks on type/PHV values, updated_at moves.
//
//   node supabase/tests/athlete_profiles.test.mjs

import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = process.argv[2] || 'supabase/migrations/20261006120000_athlete_profiles.sql';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

const U = {
  swim:   '11111111-1111-4111-8111-111111111111',
  coach:  '22222222-2222-4222-8222-222222222222',
  viewer: '33333333-3333-4333-8333-333333333333',
  other:  '44444444-4444-4444-8444-444444444444',
};

const db = new PGlite();

async function bootstrap() {
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
    create table public.users (id uuid primary key, email text, full_name text);
    -- stand-in for the accounts log-sharing grant tree
    create table public.test_log_grants (owner uuid, grantee uuid, mode text);
    create or replace function public.has_log_access(p_owner uuid, p_action text, p_user uuid default auth.uid())
      returns boolean language sql stable security definer set search_path = public as $$
        select exists (select 1 from test_log_grants g where g.owner = p_owner and g.grantee = p_user
          and (g.mode = p_action or (g.mode = 'edit' and p_action in ('read','add'))
               or (g.mode = 'add' and p_action = 'read'))); $$;
    create role authenticated;
  `);
}

async function seed() {
  for (const [k, id] of Object.entries(U))
    await db.query(`insert into public.users (id, email, full_name) values ($1,$2,$3)`, [id, `${k}@x.test`, k]);
  await db.query(`insert into public.test_log_grants values ($1,$2,'edit'), ($1,$3,'read')`, [U.swim, U.coach, U.viewer]);
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    grant all on all tables in schema public to authenticated;
    grant execute on all functions in schema public, auth to authenticated;`);
}

async function as(user, fn) {
  await db.exec(`set test.uid = '${user}'; set role authenticated;`);
  try { return await fn(); }
  finally { await db.exec(`reset role; set test.uid = '';`); }
}
const tryQ = async (sql, params) => { try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: e.message }; } };

const UPSERT = `insert into public.athlete_profiles (athlete_user_id, athlete_type, phv_status, derived_profile, se_number, club)
  values ($1,$2,$3,$4,$5,$6)
  on conflict (athlete_user_id) do update set athlete_type = excluded.athlete_type, phv_status = excluded.phv_status,
    derived_profile = excluded.derived_profile, se_number = excluded.se_number, club = excluded.club
  returning *`;

async function run() {
  await bootstrap();
  console.log('\nApplying migration ' + MIGRATION + '…');
  try { await db.exec(readFileSync(MIGRATION, 'utf8')); console.log('  applied'); }
  catch (e) { console.error('  FAILED: ' + e.message); process.exit(1); }
  await seed();

  console.log('\nCoach with edit access');
  const derived = JSON.stringify({ type: 'sprint', label: 'Sprint', aiPct: 7.1 });
  const c1 = await as(U.coach, () => tryQ(UPSERT, [U.swim, 'allround', 'developing', derived, '1234567', 'EPASC']));
  ok('can save the profile (coach override of a sprint suggestion)', c1.rows?.[0]?.athlete_type === 'allround', c1.error);
  ok('updated_by records the coach', c1.rows?.[0]?.updated_by === U.coach, c1.rows?.[0]?.updated_by);
  ok('derived snapshot kept', c1.rows?.[0]?.derived_profile?.type === 'sprint');
  const t0 = c1.rows?.[0]?.updated_at;
  await new Promise((r) => setTimeout(r, 15));
  const c2 = await as(U.coach, () => tryQ(UPSERT, [U.swim, 'allround', 'post', derived, '1234567', 'EPASC']));
  ok('second save updates the same row (one per athlete)', c2.rows?.[0]?.phv_status === 'post');
  ok('updated_at moves on update', c2.rows?.[0] && new Date(c2.rows[0].updated_at) > new Date(t0));
  const n = (await db.query(`select count(*)::int n from public.athlete_profiles`)).rows[0].n;
  ok('still exactly one row', n === 1, n);

  console.log('\nAthlete themself');
  const a = await as(U.swim, () => tryQ(`select phv_status from public.athlete_profiles where athlete_user_id = $1`, [U.swim]));
  ok('athlete can read their own profile', a.rows?.[0]?.phv_status === 'post');

  console.log('\nRead-only grantee');
  const v1 = await as(U.viewer, () => tryQ(`select athlete_type from public.athlete_profiles where athlete_user_id = $1`, [U.swim]));
  ok('read grantee can see it', v1.rows?.length === 1);
  const v2 = await as(U.viewer, () => tryQ(`update public.athlete_profiles set athlete_type = 'endurance' where athlete_user_id = $1 returning *`, [U.swim]));
  ok('read grantee cannot change it', !v2.error && v2.rows.length === 0, v2.error);

  console.log('\nStranger');
  const s1 = await as(U.other, () => tryQ(`select * from public.athlete_profiles`));
  ok('sees nothing', s1.rows?.length === 0);
  const s2 = await as(U.other, () => tryQ(UPSERT, [U.swim, 'sprint', 'pre', null, null, null]));
  ok('cannot write another athlete\'s profile', !!s2.error, JSON.stringify(s2.rows));
  const own = await as(U.other, () => tryQ(UPSERT, [U.other, 'endurance', 'pre', null, null, null]));
  ok('can save their own', own.rows?.[0]?.athlete_type === 'endurance', own.error);

  console.log('\nValue checks');
  const bad1 = await tryQ(UPSERT, [U.viewer, 'middle', 'post', null, null, null]);
  ok('rejects unknown athlete type', !!bad1.error);
  const bad2 = await tryQ(UPSERT, [U.viewer, 'sprint', 'late', null, null, null]);
  ok('rejects unknown PHV status', !!bad2.error);
  const nulls = await tryQ(UPSERT, [U.viewer, null, null, null, null, null]);
  ok('allows undecided (null) type / PHV', nulls.rows?.length === 1, nulls.error);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
