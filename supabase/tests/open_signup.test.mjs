// open_signup.test.mjs — root's open sign-up switch (20261025120000), PGlite.
//   • off by default; only root switches it; anyone (even signed out) can ask if it's on;
//   • parent sign-up: refused when closed, for a known email, and past the daily limit;
//   • add my child: needs open (or sponsorship), an adult parent, an under-18 date of birth, a new email;
//     the parent is guardian at once; the child's date of birth is stored privately; per-parent limit;
//   • only the service role (the Edge Function) can call the validate_/record_ functions.
//
//   node supabase/tests/open_signup.test.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const DIR = 'supabase/migrations/';
const NEW = '20261025120000_open_signup.sql';
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
await db.exec(`grant usage on schema public to authenticated, anon, service_role;
  grant select, insert, update, delete on all tables in schema public to authenticated, service_role;`);

const U = {};
const yearsAgo = (y) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); return d.toISOString().slice(0, 10); };
async function person(n, years) {
  U[n] = (await db.query(`insert into users(email, full_name) values ($1,$2) returning id`, [n + '@x.com', n])).rows[0].id;
  if (years) await db.query(`insert into user_birthdates(user_id, date_of_birth) values ($1,$2)`, [U[n], yearsAgo(years)]);
}
await person('al', 50); await person('parent', 40); await person('nodob'); await person('stranger', 30);
// Al is root (the bootstrap)
await db.exec(`
  with root_org as (insert into organisations (name, org_type, group_type) values ('SwimZone', 'root', 'root') returning id)
  insert into sponsorships (org_id, parent_sponsorship_id, status) select id, null, 'active' from root_org;`);
const rootOrg = (await db.query(`select id from organisations where org_type='root'`)).rows[0].id;
await db.query(`insert into memberships(user_id, org_id, role, status) values ($1,$2,'team_manager','active')`, [U.al, rootOrg]);

async function as(who, sql, p = []) {
  const role = who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated';
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${U[who] || ''}', false); set role ${role};`);
  try { return await db.query(sql, p); } finally { await db.exec('reset role'); }
}
const one = async (who, sql, p) => Object.values((await as(who, sql, p)).rows[0] ?? {})[0];
const err = async (who, sql, p) => { try { await as(who, sql, p); return null; } catch (e) { return e.message; } };
const uuid = () => crypto.randomUUID();
async function newAuthUser(email) { const id = uuid(); return { id, email }; }   // stands in for inviteUserByEmail

console.log('\nThe switch');
ok('off by default', (await one('anon', `select public.is_open_signup()`)) === false);
ok('signed-out visitors can ask', (await err('anon', `select public.is_open_signup()`)) === null);
ok('only root can switch it', /NOT_ALLOWED/.test(await err('parent', `select public.set_open_signup(true)`)));
ok('closed: sign-up refused', /SIGNUP_CLOSED/.test(await one('service', `select public.validate_self_signup('new@x.com')`)));
ok('closed: adding a child refused', /SIGNUP_CLOSED/.test(await one('service', `select public.validate_child_addition($1,'kid@x.com',$2)`, [U.parent, yearsAgo(10)])));
ok('root opens it', (await one('al', `select public.set_open_signup(true)`)) === true && (await one('anon', `select public.is_open_signup()`)) === true);

console.log('\nParent sign-up');
ok('fine for a new email', (await one('service', `select public.validate_self_signup('mum@x.com')`)) === null);
ok('known email → use Forgot password', /ALREADY_REGISTERED/.test(await one('service', `select public.validate_self_signup('parent@x.com')`)));
const mum = await newAuthUser('mum@x.com');
ok('record it', (await err('service', `select public.record_self_signup($1,$2,' Mum Smith ')`, [mum.id, mum.email])) === null);
ok('users row with the name', (await db.query(`select full_name from users where id=$1`, [mum.id])).rows[0]?.full_name === 'Mum Smith');
ok('logged as a parent sign-up', (await db.query(`select kind from self_signups where user_id=$1`, [mum.id])).rows[0]?.kind === 'parent');
ok('signed-in users cannot call it directly', /permission denied/.test(await err('parent', `select public.record_self_signup($1,'x@x.com','X')`, [uuid()])));
ok('nor can signed-out visitors', /permission denied/.test(await err('anon', `select public.validate_self_signup('x@x.com')`)));
await db.exec(`update system_settings set value = '1'::jsonb where key = 'signup_daily_limit'`);
ok('daily limit', /RATE_LIMIT/.test(await one('service', `select public.validate_self_signup('dad@x.com')`)));
await db.exec(`update system_settings set value = '30'::jsonb where key = 'signup_daily_limit'`);

console.log('\nAdd my child');
ok('parent without a date of birth → add yours first', /GUARDIAN_NOT_ADULT/.test(await one('service', `select public.validate_child_addition($1,'k@x.com',$2)`, [U.nodob, yearsAgo(9)])));
ok('child must be under 18', /INVALID/.test(await one('service', `select public.validate_child_addition($1,'k@x.com',$2)`, [U.parent, yearsAgo(19)])));
ok('no date of birth → refused', /INVALID/.test(await one('service', `select public.validate_child_addition($1,'k@x.com',null)`, [U.parent])));
ok('known email → refused', /ALREADY_REGISTERED/.test(await one('service', `select public.validate_child_addition($1,'stranger@x.com',$2)`, [U.parent, yearsAgo(9)])));
const kid = await newAuthUser('parent+sam@x.com');
const res = await one('service', `select public.record_child_addition($1,$2,$3,'Sam Smith',$4)`, [U.parent, kid.id, kid.email, yearsAgo(11)]);
ok('child added', res?.user_id === kid.id, res);
ok('child marked junior', (await db.query(`select declared_junior from users where id=$1`, [kid.id])).rows[0].declared_junior === true);
ok('date of birth stored privately (set by the parent)', (await db.query(`select set_by from user_birthdates where user_id=$1`, [kid.id])).rows[0]?.set_by === U.parent);
ok('parent is guardian at once', await one('parent', `select public.is_active_guardian($1)`, [kid.id]));
ok('parent can read and add to the child\'s log', await one('parent', `select public.has_log_access($1,'add')`, [kid.id]));
ok('a stranger cannot', !(await one('stranger', `select public.has_log_access($1,'read')`, [kid.id])));
await db.exec(`update system_settings set value = '1'::jsonb where key = 'child_daily_limit'`);
ok('per-parent daily limit', /RATE_LIMIT/.test(await one('service', `select public.validate_child_addition($1,'k2@x.com',$2)`, [U.parent, yearsAgo(8)])));
await db.exec(`update system_settings set value = '6'::jsonb where key = 'child_daily_limit'`);

console.log('\nRoot\'s view and closing again');
const recent = (await as('al', `select * from public.recent_self_signups()`)).rows;
ok('root sees who signed up', recent.length === 2 && recent.some((r) => r.kind === 'child' && r.added_by_name === 'parent'), recent);
ok('others see nothing', (await as('parent', `select * from public.recent_self_signups()`)).rows.length === 0);
await as('al', `select public.set_open_signup(false)`);
ok('closed again', (await one('anon', `select public.is_open_signup()`)) === false);
ok('a sponsor can still add a child while closed', (await one('service', `select public.validate_child_addition($1,'k3@x.com',$2)`, [U.al, yearsAgo(7)])) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
