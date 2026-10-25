// user_settings.test.mjs — per-person settings (20261023130000), PGlite, as real signed-in users.
//   • you read and write only your own row; nobody else's;
//   • the zone scheme must be an object, size-capped; null = default;
//   • idempotent (applied twice).
//
//   node supabase/tests/user_settings.test.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const DIR = 'supabase/migrations/';
const NEW = '20261023130000_user_settings.sql';
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };

const db = new PGlite();
await db.exec(`
  create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon, service_role;
  grant execute on function auth.uid() to authenticated, anon, service_role;
  create table public.users (id uuid primary key default gen_random_uuid(), email text not null unique, full_name text, avatar_url text, created_at timestamptz default now());
  create table public.organisations (id uuid primary key default gen_random_uuid(), name text not null, org_type text not null,
     invitation_quota int not null default 0, created_by uuid, created_at timestamptz default now());
  create table public.memberships (id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id) on delete cascade,
     org_id uuid references public.organisations(id) on delete cascade,
     role text not null constraint memberships_role_check check (role = any (array['athlete','coach','manager','admin','guardian'])),
     status text not null default 'pending', created_at timestamptz default now(), unique (user_id, org_id, role));
`);
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
  for (const k of f === NEW ? [1, 2] : [1]) {
    try { await db.exec(readFileSync(DIR + f, 'utf8')); } catch (e) { console.error(`FAILED on ${f} (${k}): ${e.message}`); process.exit(1); }
  }
}
await db.exec(`grant usage on schema public to authenticated;`);

const U = {};
for (const n of ['al', 'coach']) U[n] = (await db.query(`insert into users(email) values ($1) returning id`, [n + '@x.com'])).rows[0].id;
async function as(who, sql, p = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${U[who]}', false); set role authenticated;`);
  try { return await db.query(sql, p); } finally { await db.exec('reset role'); }
}
const err = async (who, sql, p) => { try { await as(who, sql, p); return null; } catch (e) { return e.message; } };

console.log('\nuser_settings');
ok('save my scheme', (await err('al', `insert into user_settings(user_id, zone_scheme) values ($1, '{"id":"urbanchek"}')`, [U.al])) === null);
ok('read it back', (await as('al', `select zone_scheme from user_settings`)).rows[0]?.zone_scheme?.id === 'urbanchek');
ok('upsert (change it)', (await err('al', `insert into user_settings(user_id, zone_scheme) values ($1, '{"id":"maglischo"}')
  on conflict (user_id) do update set zone_scheme = excluded.zone_scheme, updated_at = now()`, [U.al])) === null
  && (await as('al', `select zone_scheme from user_settings`)).rows[0].zone_scheme.id === 'maglischo');
ok('null = back to the default', (await err('al', `update user_settings set zone_scheme = null where user_id = $1`, [U.al])) === null);
ok('someone else cannot read my row', (await as('coach', `select * from user_settings`)).rows.length === 0);
ok('someone else cannot write my row', /row-level security/.test(await err('coach', `insert into user_settings(user_id, zone_scheme) values ($1, '{}')`, [U.al])));
ok('someone else cannot change my row', (await as('coach', `update user_settings set zone_scheme = '{"id":"x"}' where user_id = $1 returning user_id`, [U.al])).rows.length === 0);
ok('not an object → refused', /check/.test(await err('al', `update user_settings set zone_scheme = '"red"' where user_id = $1`, [U.al])));
ok('too big → refused', /check/.test(await err('al', `update user_settings set zone_scheme = $2::jsonb where user_id = $1`,
  [U.al, JSON.stringify({ x: 'y'.repeat(21000) })])));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
