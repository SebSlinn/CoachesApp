import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };

// ---- Supabase-like prelude + the EXISTING SwimZone tables ----
await db.exec(`
  create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon, service_role;
  grant execute on function auth.uid() to authenticated, anon, service_role;

  create table public.users (id uuid primary key, email text, full_name text, avatar_url text, created_at timestamptz default now());
  create table public.organisations (id uuid primary key default gen_random_uuid(), name text, org_type text,
     invitation_quota int, created_by uuid, created_at timestamptz default now());
  create table public.memberships (id uuid primary key default gen_random_uuid(),
     user_id uuid references public.users(id), org_id uuid references public.organisations(id),
     role text constraint memberships_role_check check (role = any (array['athlete','coach','manager','admin','guardian'])),
     status text default 'active' constraint memberships_status_check check (status = any (array['pending','active','suspended'])),
     created_at timestamptz default now());
`);

await db.exec(fs.readFileSync(process.argv[2], 'utf8'));
await db.exec(`grant usage on schema public to authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to authenticated, service_role;`);

// ---- people ----
const U = {};
const people = [
  ['al', '1970-01-01'], ['region', '1975-05-05'], ['club', '1980-03-03'], ['coach', '1985-02-02'],
  ['parent', '1982-06-06'], ['adult', '1995-09-09'], ['kid17', null], ['stranger', '1990-01-01'],
];
for (const [n, dob] of people) {
  const r = await db.query(`insert into users(id,email,full_name,date_of_birth)
     values (gen_random_uuid(), $1, $2, $3) returning id`, [`${n}@x.com`, n, dob]);
  U[n] = r.rows[0].id;
}
// bootstrap (as superuser = dashboard)
await db.exec(fs.readFileSync(process.argv[3], 'utf8').replace('YOUR-EMAIL@example.com', 'al@x.com'));

async function as(who, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${who ? U[who] : ''}', false);`);
  if (who) await db.exec('set role authenticated');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
async function err(who, sql, params = []) {
  try { await as(who, sql, params); return null; } catch (e) { return e.message; }
}
const one = async (who, sql, p) => Object.values((await as(who, sql, p)).rows[0])[0];
const svc = async (sql, p) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false)`);
  return (await db.query(sql, p)).rows[0]; };
async function addAthlete(actor, org, email, name, dob, guardians = []) {
  const id = (await db.query('select gen_random_uuid() id')).rows[0].id;
  const v = (await svc('select public.validate_athlete_addition($1,$2,$3,$4) e', [U[actor], org, dob, guardians])).e;
  if (v) return { error: v };
  const r = await svc('select public.record_athlete_addition($1,$2,$3,$4,$5,$6,$7,true) r',
    [U[actor], org, id, email, name, dob, guardians]);
  U[name] = id; return r.r;
}

const rootOrg = (await svc(`select id from organisations where org_type='root'`)).id;
ok('Al is root', await one('al', 'select public.is_root()'));
ok('Al can add users', await one('al', 'select public.can_add_users()'));
ok('stranger cannot add users', !(await one('stranger', 'select public.can_add_users()')));

// Tree: root -> North Region -> Riverside SC
const regionOrg = await one('al', `select public.create_subgroup($1,'North Region','region','region@x.com')`, [rootOrg]);
ok('region admin pending cannot add yet', !(await one('region', 'select public.can_add_users()')));
const rm = (await as('region', `select id from memberships where user_id=auth.uid() and status='pending'`)).rows[0].id;
await as('region', 'select public.respond_to_membership($1,true)', [rm]);
ok('region admin accepted -> can add', await one('region', 'select public.can_add_users()'));

const clubOrg = await one('region', `select public.create_subgroup($1,'Riverside SC','club','club@x.com')`, [regionOrg]);
const cm = (await as('club', `select id from memberships where user_id=auth.uid() and status='pending'`)).rows[0].id;
await as('club', 'select public.respond_to_membership($1,true)', [cm]);
ok('club admin can add', await one('club', 'select public.can_add_users()'));
ok('stranger cannot create subgroup', /NOT_ALLOWED/.test(await err('stranger', `select public.create_subgroup($1,'x')`, [clubOrg])));
ok('club cannot suspend its own grant', /NOT_ALLOWED/.test(await err('club',
  'select public.set_grant_status(public.org_grant($1),$2)', [clubOrg, 'suspended'])));

// Add athletes
const r1 = await addAthlete('club', clubOrg, 'swimmer@x.com', 'swimmer', '2000-01-01');
ok('club adds adult athlete', r1.user_id);
const r2 = await addAthlete('club', clubOrg, 'junior@x.com', 'junior', '2013-04-04');
ok('junior without guardian refused', /GUARDIAN_REQUIRED/.test(r2.error));
const r3 = await addAthlete('club', clubOrg, 'junior@x.com', 'junior', '2013-04-04', ['kid17@x.com']);
ok('guardian with no DOB refused', /GUARDIAN_NOT_ADULT/.test(r3.error));
const r4 = await addAthlete('club', clubOrg, 'junior@x.com', 'junior', '2013-04-04', ['parent@x.com']);
ok('junior with adult guardian added', r4.user_id && r4.pending_guardians.length === 1);
ok('stranger cannot add via club', /NOT_ALLOWED/.test((await addAthlete('stranger', clubOrg, 'z@x.com', 'z', '2000-01-01')).error));

// Guardian accepts; manages sharing
ok('pending guardian cannot share yet', /NOT_ALLOWED/.test(await err('parent',
  `select public.share_log($1,'coach@x.com',true)`, [U.junior])));
const gp = (await as('parent', `select id from log_permissions where grantee_user_id=auth.uid() and status='pending'`)).rows[0].id;
await as('parent', 'select public.respond_to_guardianship($1,true)', [gp]);
ok('junior cannot share own log', /NOT_ALLOWED/.test(await err('junior',
  `select public.share_log($1,'coach@x.com',true)`, [U.junior])));
await as('parent', `select public.share_log($1,'coach@x.com',true,false,false)`, [U.junior]);

// Results
await as('junior', `insert into performance_results(athlete_user_id,stroke,dist_m,time_sec) values ($1,'FS',100,68.4)`, [U.junior]);
await as('parent', `insert into performance_results(athlete_user_id,stroke,dist_m,time_sec,kind) values ($1,'BK',200,160.1,'meet')`, [U.junior]);
ok('coach (read) sees 2 results', (await as('coach', 'select * from performance_results where athlete_user_id=$1', [U.junior])).rows.length === 2);
ok('coach (read only) cannot add', /row-level security/.test(await err('coach',
  `insert into performance_results(athlete_user_id,stroke,dist_m,time_sec) values ($1,'FS',50,30)`, [U.junior])));
const upd = await as('coach', 'update performance_results set time_sec=1 where athlete_user_id=$1', [U.junior]);
ok('coach (read only) cannot edit', upd.affectedRows === 0);
ok('root Al sees none of the junior\'s results', (await as('al', 'select * from performance_results where athlete_user_id=$1', [U.junior])).rows.length === 0);
ok('club admin (adder) sees none', (await as('club', 'select * from performance_results where athlete_user_id=$1', [U.junior])).rows.length === 0);
const stamp = (await svc(`select created_by from performance_results where kind='meet'`)).created_by;
ok('result stamped with who added it (guardian)', stamp === U.parent);

// Upgrade coach to add+edit
await as('parent', `select public.share_log($1,'coach@x.com',true,true,true)`, [U.junior]);
await as('coach', `insert into performance_results(athlete_user_id,stroke,dist_m,time_sec) values ($1,'Fly',50,29.9)`, [U.junior]);
ok('coach with add can add', (await as('junior', 'select * from performance_results where athlete_user_id=auth.uid()')).rows.length === 3);

// Adult controls own sharing
await as('swimmer', `select public.share_log(auth.uid(),'coach@x.com',true)`);
ok('adult shares own log', (await as('coach', `select public.has_log_access($1,'read')`, [U.swimmer])).rows[0].has_log_access);

// Last guardian protection
ok('last guardian cannot be revoked', /LAST_GUARDIAN/.test(await err('parent', 'select public.revoke_log_permission($1)', [gp])));
ok('last guardian cannot step away', /LAST_GUARDIAN/.test(await err('parent', 'select public.revoke_log_permission($1)', [gp])));
await as('club', `select public.nominate_guardian($1,'adult@x.com')`, [U.junior]);
const gp2 = (await as('adult', `select id from log_permissions where grantee_user_id=auth.uid() and status='pending'`)).rows[0].id;
await as('adult', 'select public.respond_to_guardianship($1,true)', [gp2]);
ok('with 2nd guardian, first can step away', (await err('parent', 'select public.revoke_log_permission($1)', [gp])) === null);

// Cascade suspend / restore
await as('al', 'select public.set_grant_status(public.org_grant($1),$2)', [regionOrg, 'suspended']);
ok('region suspended -> club loses adding', !(await one('club', 'select public.can_add_users()')));
ok('region suspended -> region loses adding', !(await one('region', 'select public.can_add_users()')));
ok('adds via club refused while suspended', /NOT_ALLOWED/.test((await addAthlete('club', clubOrg, 'q@x.com', 'q', '2000-01-01')).error));
ok('athletes unaffected: junior still reads own log', (await as('junior', 'select * from performance_results where athlete_user_id=auth.uid()')).rows.length === 3);
await as('al', 'select public.set_grant_status(public.org_grant($1),$2)', [regionOrg, 'active']);
ok('region restored -> club adding back', await one('club', 'select public.can_add_users()'));

// Removing a person never cascades (region admin goes AWOL)
const regionM = (await svc(`select id from memberships where user_id=$1 and org_id=$2`, [U.region, regionOrg])).id;
await as('al', 'select public.remove_membership($1)', [regionM]);
ok('region admin removed -> region admin cannot add', !(await one('region', 'select public.can_add_users()')));
ok('...but club below still can', await one('club', 'select public.can_add_users()'));
await as('al', `select public.nominate_group_admin($1,'stranger@x.com')`, [regionOrg]);
ok('root can nominate replacement region admin', (await svc(`select count(*)::int c from memberships where user_id=$1 and status='pending'`, [U.stranger])).c === 1);

// Athlete leaves club (dissociates)
const sm = (await as('swimmer', `select id from memberships where user_id=auth.uid() and role='athlete'`)).rows[0].id;
await as('swimmer', 'select public.remove_membership($1)', [sm]);
ok('athlete left club, still owns log & sharing', (await as('coach', `select public.has_log_access($1,'read')`, [U.swimmer])).rows[0].has_log_access);

// Rate limit
await as('al', 'select public.set_daily_add_limit(3)');
// club has made 2 successful adds today (swimmer, junior)
ok('3rd add ok', (await addAthlete('club', clubOrg, 'a3@x.com', 'a3', '2000-01-01')).user_id);
ok('4th add hits rate limit', /RATE_LIMIT/.test((await addAthlete('club', clubOrg, 'a4@x.com', 'a4', '2000-01-01')).error));
ok('sub-group creation counts too', /RATE_LIMIT/.test(await err('club', `select public.create_subgroup($1,'Squad A')`, [clubOrg])));
await as('al', 'select public.set_group_daily_limit($1, 100)', [clubOrg]);
ok('root override lifts it for that group', (await addAthlete('club', clubOrg, 'a4@x.com', 'a4', '2000-01-01')).user_id);
ok('non-root cannot change limit', /NOT_ALLOWED/.test(await err('club', 'select public.set_daily_add_limit(1000000)')));

// Privileges: clients cannot call the service-only function
ok('client cannot call record_athlete_addition', /permission denied/.test(await err('club',
  `select public.record_athlete_addition($1,$2,$1,'x','x','2000-01-01','{}',true)`, [U.club, clubOrg])));
// Writes to grants only via RPC
ok('client cannot insert grants directly', /row-level security/.test(await err('club',
  `insert into admin_grants(org_id) values ($1)`, [rootOrg])) || false);
ok('client cannot edit own DOB once set', /NOT_ALLOWED/.test(await err('adult', `update users set date_of_birth='2015-01-01' where id=auth.uid()`)));
ok('visibility: club admin sees Riverside memberships', (await as('club', 'select * from memberships where org_id=$1', [clubOrg])).rows.length >= 3);
ok('visibility: stranger sees no grants below root', (await as('stranger', 'select * from admin_grants')).rows.length === 0);
ok('coach can see junior name (shared)', (await as('coach', 'select full_name from users where id=$1', [U.junior])).rows.length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
