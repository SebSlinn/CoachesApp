// athlete_max_hr.test.mjs — max HR columns on athlete_profiles, PGlite, self-contained.
//   node supabase/tests/athlete_max_hr.test.mjs
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c || x === undefined ? '' : '  → ' + x)); };
const A = '11111111-1111-4111-8111-111111111111';
const db = new PGlite();
const tryQ = async (sql, p) => { try { return { rows: (await db.query(sql, p)).rows }; } catch (e) { return { error: e.message }; } };

await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create table public.users (id uuid primary key, email text, full_name text);
  create or replace function public.has_log_access(p_owner uuid, p_action text, p_user uuid default auth.uid())
    returns boolean language sql stable as $$ select true $$;
`);
await db.exec(readFileSync('supabase/migrations/20261006120000_athlete_profiles.sql', 'utf8'));
await db.query(`insert into public.users (id) values ($1)`, [A]);
await db.query(`insert into public.athlete_profiles (athlete_user_id, athlete_type) values ($1, 'sprint')`, [A]);

console.log('\nApplying 20261014120000_athlete_max_hr.sql (twice — must be re-runnable)');
const MIG = readFileSync('supabase/migrations/20261014120000_athlete_max_hr.sql', 'utf8');
let applied = await tryQ('select 1').then(async () => { try { await db.exec(MIG); await db.exec(MIG); return true; } catch (e) { return e.message; } });
ok('applies cleanly, twice', applied === true, applied);
const r0 = await tryQ(`select athlete_type, max_hr from public.athlete_profiles where athlete_user_id = $1`, [A]);
ok('existing profile untouched, max HR empty', r0.rows?.[0]?.athlete_type === 'sprint' && r0.rows[0].max_hr === null);
const r1 = await tryQ(`update public.athlete_profiles set max_hr = 201, max_hr_source = 'test', max_hr_on = '2026-10-01' where athlete_user_id = $1 returning max_hr, max_hr_source`, [A]);
ok('saves a max HR from a test', r1.rows?.[0]?.max_hr === 201 && r1.rows[0].max_hr_source === 'test', r1.error);
ok('rejects an impossible max HR', !!(await tryQ(`update public.athlete_profiles set max_hr = 40 where athlete_user_id = $1`, [A])).error);
ok('accepts 240 (young children), rejects 241', !(await tryQ(`update public.athlete_profiles set max_hr = 240 where athlete_user_id = $1`, [A])).error && !!(await tryQ(`update public.athlete_profiles set max_hr = 241 where athlete_user_id = $1`, [A])).error);
ok('rejects an unknown source', !!(await tryQ(`update public.athlete_profiles set max_hr_source = 'guess' where athlete_user_id = $1`, [A])).error);
ok('clearing it is allowed', !(await tryQ(`update public.athlete_profiles set max_hr = null, max_hr_source = null where athlete_user_id = $1`, [A])).error);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
