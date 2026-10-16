// groups_sponsorship.test.mjs — Groups & Sponsorship migration (+ the private-birthdates
// follow-up, 20261016120000), PGlite, self-contained.
//
// Builds the hand-made base tables as they are on the live DB, applies EVERY
// earlier migration in order, seeds the live shape (Al = root admin, two
// children as athletes with Al as guardian), then applies the new migration
// twice (idempotent) and checks, as real signed-in roles:
//   • renames: sponsorships, roles mapped to the catalogue, Al still root;
//   • groups: anyone creates, creator is TM, limits, last-TM guard;
//   • invites: preview, join, staff roles need approval, juniors need a guardian;
//   • capabilities drive has_log_access (coach read+add, poolside add-only, TM read override);
//   • visibility: group tick AND member tick, juniors hidden, loosening waits for accept;
//   • event log visible to members and guardians;
//   • sponsorship gates new people only; existing accounts must use an invite link.
//
//   node supabase/tests/groups_sponsorship.test.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const DIR = 'supabase/migrations/';
const NEW = '20261015120000_groups_sponsorship.sql';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

const db = new PGlite();
const U = {};

await db.exec(`
  create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon, service_role;
  grant execute on function auth.uid() to authenticated, anon, service_role;

  -- base tables exactly as on the live DB (made by hand before the migrations)
  create table public.users (id uuid primary key default gen_random_uuid(), email text not null unique,
     full_name text, avatar_url text, created_at timestamptz default now());
  create table public.organisations (id uuid primary key default gen_random_uuid(), name text not null,
     org_type text not null, invitation_quota int not null default 0, created_by uuid, created_at timestamptz default now());
  create table public.memberships (id uuid primary key default gen_random_uuid(),
     user_id uuid references public.users(id) on delete cascade,
     org_id uuid references public.organisations(id) on delete cascade,
     role text not null constraint memberships_role_check check (role = any (array['athlete','coach','manager','admin','guardian'])),
     status text not null default 'pending', created_at timestamptz default now(),
     unique (user_id, org_id, role));
`);

const earlier = readdirSync(DIR).filter((f) => f.endsWith('.sql') && f < NEW).sort();
console.log(`\nApplying ${earlier.length} earlier migrations…`);
for (const f of earlier) {
  try { await db.exec(readFileSync(DIR + f, 'utf8')); }
  catch (e) { console.error(`  FAILED on ${f}: ${e.message}`); process.exit(1); }
}
await db.exec(`grant usage on schema public to authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to authenticated, service_role;`);

// ---- live shape: Al (root admin), two children as athletes in root, Al guardian ----
// Before the new migration the date of birth lives on users; after it, in user_birthdates.
async function person(n, dob) {
  const r = await db.query(`insert into users(email, full_name, public_name) values ($1,$2,$3) returning id`,
    [`${n}@x.com`, n[0].toUpperCase() + n.slice(1), n]);
  U[n] = r.rows[0].id;
  if (!dob) return;
  if ((await db.query(`select to_regclass('public.user_birthdates') t`)).rows[0].t)
    await db.query(`insert into user_birthdates(user_id, date_of_birth) values ($1,$2)`, [U[n], dob]);
  else await db.query(`update users set date_of_birth = $2 where id = $1`, [U[n], dob]);
}
const yearsAgo = (y) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); return d.toISOString().slice(0, 10); };
await person('al', '1970-01-01');
await person('kid1', yearsAgo(12));
await person('kid2', yearsAgo(15));
// the old bootstrap_root.sql, as it was run on the live DB
await db.exec(`
  with root_org as (insert into public.organisations (name, org_type) values ('SwimZone', 'root') returning id)
  insert into public.admin_grants (org_id, parent_grant_id, status) select id, null, 'active' from root_org;
  insert into public.memberships (user_id, org_id, role, status)
  select u.id, o.id, 'admin', 'active' from public.users u, public.organisations o
   where u.email = 'al@x.com' and o.org_type = 'root';`);
const rootOrg = (await db.query(`select id from organisations where org_type='root'`)).rows[0].id;
for (const k of ['kid1', 'kid2']) {
  await db.query(`insert into memberships(user_id, org_id, role, status) values ($1,$2,'athlete','active')`, [U[k], rootOrg]);
  await db.query(`insert into log_permissions(owner_user_id, grantee_user_id, can_read, can_add, can_edit, is_guardian, status)
                  values ($1,$2,true,true,true,true,'active')`, [U[k], U.al]);
}
// an old personal share, to be retired
await person('friend', '1980-01-01');
await db.query(`insert into log_permissions(owner_user_id, grantee_user_id, status) values ($1,$2,'active')`, [U.al, U.friend]);

// The groups migration and every Accounts follow-up after it (private birthdates, …), each twice.
const later = readdirSync(DIR).filter((f) => f.endsWith('.sql') && f >= NEW).sort();
for (const f of later) {
  console.log(`\nApplying ${f} (twice)…`);
  for (const n of [1, 2]) {
    try { await db.exec(readFileSync(DIR + f, 'utf8')); console.log(`  applied (${n})`); }
    catch (e) { console.error(`  FAILED (${n}): ${e.message}`); process.exit(1); }
  }
}
await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated, service_role;`);

// ---- helpers ----
async function as(who, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${who ? U[who] : ''}', false);`);
  if (who) await db.exec('set role authenticated');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
const one = async (who, sql, p) => Object.values((await as(who, sql, p)).rows[0] ?? {})[0];
const err = async (who, sql, p) => { try { await as(who, sql, p); return null; } catch (e) { return e.message; } };
const svc = async (sql, p) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false)`); return (await db.query(sql, p)).rows; };

for (const [n, y] of [['coach', 40], ['tm', 45], ['helper', 50], ['parentA', 42], ['parentB', 41], ['adultA', 30], ['adultB', 31], ['stranger', 35], ['juniorC', 13]])
  await person(n, yearsAgo(y));

console.log('\nRenames and live data');
ok('sponsorships table exists, admin_grants gone',
  (await svc(`select to_regclass('public.sponsorships') s, to_regclass('public.admin_grants') a`))[0].a === null);
ok('Al is still root', await one('al', 'select public.is_root()'));
ok('Al can sponsor', await one('al', 'select public.can_sponsor()'));
const roles = (await svc(`select role, count(*)::int n from memberships group by role order by role`)).map((r) => `${r.role}:${r.n}`).join(' ');
ok('roles mapped (admin→team_manager, athlete→member)', roles === 'member:2 team_manager:1', roles);
ok('root group has group_type root', (await svc(`select group_type from organisations where id=$1`, [rootOrg]))[0].group_type === 'root');
ok('old personal share retired', (await svc(`select status from log_permissions where owner_user_id=$1 and grantee_user_id=$2`, [U.al, U.friend]))[0].status === 'revoked');
ok('guardianship still works (Al reads kid1)', await one('al', 'select public.has_log_access($1,$2)', [U.kid1, 'read']));
ok('friend lost access', !(await one('friend', 'select public.has_log_access($1,$2)', [U.al, 'read'])));
ok('old functions dropped', (await svc(`select count(*)::int n from pg_proc where proname in ('can_add_users','is_group_admin','grant_is_effective','share_log','is_org_staff')`))[0].n === 0);
ok('Tests helper still works (Al edits global protocols)', await one('al', 'select public.can_edit_protocol_org(null)'));

console.log('\nCreating a coaching group');
const club = await one('tm', `select public.create_group('Riverside Dev','coaching','club')`);
ok('anyone signed in can create a group', !!club);
ok('creator is Team Manager', await one('tm', `select public.has_group_capability($1,'manage_members')`, [club]));
ok('created event logged', (await svc(`select count(*)::int n from group_events where org_id=$1 and event='created'`, [club]))[0].n === 1);
const tmRow = (await svc(`select id from memberships where org_id=$1 and user_id=$2`, [club, U.tm]))[0].id;
ok('last TM cannot leave', /LAST_TEAM_MANAGER/.test(await err('tm', 'select public.remove_membership($1)', [tmRow])));
ok('stranger cannot change settings', /NOT_ALLOWED/.test(await err('stranger', `select public.update_group_settings($1,'X')`, [club])));

console.log('\nInvites');
const memberCode = await one('tm', `select public.create_group_invite($1)`, [club]);
const coachCode = await one('tm', `select public.create_group_invite($1,'coach')`, [club]);
const poolCode = await one('tm', `select public.create_group_invite($1,'poolside_assistant')`, [club]);
ok('invite code made', /^[0-9A-F]{16}$/.test(memberCode), memberCode);
ok('stranger cannot make invites', /NOT_ALLOWED/.test(await err('stranger', `select public.create_group_invite($1)`, [club])));
const prev = await one('coach', `select public.preview_group_invite($1)`, [coachCode]);
ok('preview shows group name and staff', prev.name === 'Riverside Dev' && prev.staff.length === 1 && prev.staff[0].role_label === 'Team Manager', JSON.stringify(prev));
ok('staff-role invite needs approval', prev.needs_approval === true);
ok('bad code refused', /INVITE_INVALID/.test(await err('coach', `select public.preview_group_invite('NOPE')`)));
ok('invite list hidden from non-managers', (await as('stranger', `select * from group_invites`)).rows.length === 0);

const coachM = await one('coach', `select public.join_group($1)`, [coachCode]);
ok('coach join is pending', (await svc(`select status from memberships where id=$1`, [coachM]))[0].status === 'pending');
ok('pending coach cannot read yet', !(await one('coach', `select public.has_group_capability($1,'read_results')`, [club])));
ok('coach cannot approve self', /NOT_ALLOWED/.test(await err('coach', 'select public.approve_membership($1,true)', [coachM])));
await as('tm', 'select public.approve_membership($1,true)', [coachM]);
ok('TM approves → coach active', (await svc(`select status from memberships where id=$1`, [coachM]))[0].status === 'active');
await as('helper', `select public.join_group($1)`, [poolCode]).then(async (r) =>
  as('tm', 'select public.approve_membership($1,true)', [Object.values(r.rows[0])[0]]));

const aM = await one('adultA', `select public.join_group($1)`, [memberCode]);
ok('adult member joins straight in', (await svc(`select status from memberships where id=$1`, [aM]))[0].status === 'active');
await as('adultB', `select public.join_group($1)`, [memberCode]);
ok('joining twice is a no-op', (await one('adultA', `select public.join_group($1)`, [memberCode])) === aM);

console.log('\nJuniors and guardians');
await svc(`insert into log_permissions(owner_user_id, grantee_user_id, can_read, can_add, can_edit, is_guardian, status)
           values ($1,$2,true,true,true,true,'active')`, [U.juniorC, U.parentA]);
const jM = await one('juniorC', `select public.join_group($1)`, [memberCode]);
ok('under-18 joining alone waits for guardian', (await svc(`select status from memberships where id=$1`, [jM]))[0].status === 'awaiting_guardian');
ok('coach cannot read junior yet', !(await one('coach', 'select public.has_log_access($1,$2)', [U.juniorC, 'read'])));
ok('guardian sees the request', (await as('parentA', `select id from memberships where id=$1`, [jM])).rows.length === 1);
ok('non-guardian cannot approve', /NOT_ALLOWED/.test(await err('parentB', 'select public.approve_junior_membership($1,true)', [jM])));
await as('parentA', 'select public.approve_junior_membership($1,true)', [jM]);
ok('guardian approves → active', (await svc(`select status from memberships where id=$1`, [jM]))[0].status === 'active');
const k1M = await one('al', `select public.join_group($1,$2)`, [memberCode, U.kid1]);
ok('guardian can join their junior directly', (await svc(`select status, guardian_approved_by from memberships where id=$1`, [k1M]))[0].guardian_approved_by === U.al);
ok('non-guardian cannot join someone else', /NOT_ALLOWED/.test(await err('stranger', `select public.join_group($1,$2)`, [memberCode, U.kid2])));
ok('guardian sees the group', (await as('parentA', `select id from organisations where id=$1`, [club])).rows.length === 1);
ok('guardian sees the event log', (await as('parentA', `select id from group_events where org_id=$1`, [club])).rows.length > 0);

console.log('\nResults access by capability');
ok('coach reads a member', await one('coach', 'select public.has_log_access($1,$2)', [U.adultA, 'read']));
ok('coach adds for a member', await one('coach', 'select public.has_log_access($1,$2)', [U.adultA, 'add']));
ok('coach never edits', !(await one('coach', 'select public.has_log_access($1,$2)', [U.adultA, 'edit'])));
ok('poolside assistant adds', await one('helper', 'select public.has_log_access($1,$2)', [U.adultA, 'add']));
ok('poolside assistant cannot read', !(await one('helper', 'select public.has_log_access($1,$2)', [U.adultA, 'read'])));
ok('TM cannot read by default', !(await one('tm', 'select public.has_log_access($1,$2)', [U.adultA, 'read'])));
ok('member cannot read another member (coaching group)', !(await one('adultB', 'select public.has_log_access($1,$2)', [U.adultA, 'read'])));
ok('coach cannot read the TM (staff are not athletes)', !(await one('coach', 'select public.has_log_access($1,$2)', [U.tm, 'read'])));
ok('stranger reads nothing', !(await one('stranger', 'select public.has_log_access($1,$2)', [U.adultA, 'read'])));
await as('tm', `select public.set_member_capability($1,'read_results',true)`, [tmRow]);
ok('TM read switched on → TM reads', await one('tm', 'select public.has_log_access($1,$2)', [U.adultA, 'read']));
ok('capability change logged', (await svc(`select count(*)::int n from group_events where org_id=$1 and event='capability_changed'`, [club]))[0].n === 1);
ok('coach cannot change capabilities', /NOT_ALLOWED/.test(await err('coach', `select public.set_member_capability($1,'read_results',false)`, [tmRow])));
await svc(`insert into performance_results(athlete_user_id, stroke, dist_m, time_sec, kind, effort) values ($1,'FS',100,70.5,'time_trial','maximal')`, [U.adultA]);
ok('RLS: coach sees member\'s swim', (await as('coach', `select id from performance_results where athlete_user_id=$1`, [U.adultA])).rows.length === 1);
ok('RLS: other member does not', (await as('adultB', `select id from performance_results where athlete_user_id=$1`, [U.adultA])).rows.length === 0);
const leaveErr = await err('adultA', `select public.remove_membership($1)`, [aM]);
ok('member can leave', leaveErr === null, leaveErr);
ok('after leaving, coach loses access', !(await one('coach', 'select public.has_log_access($1,$2)', [U.adultA, 'read'])));
ok('left event logged', (await svc(`select count(*)::int n from group_events where org_id=$1 and event='left'`, [club]))[0].n === 1);
await as('adultA', `select public.join_group($1)`, [memberCode]);

console.log('\nVisibility (group tick AND member tick)');
const dirAs = async (who) => (await as(who, `select * from public.group_directory($1)`, [club])).rows;
let d = await dirAs('adultB');
const rowOf = (rows, who) => rows.find((r) => r.user_id === U[who]);
ok('member sees other members by public name', rowOf(d, 'adultA')?.public_name === 'adultA');
ok('member does not see full name or email by default', rowOf(d, 'adultA')?.full_name == null && rowOf(d, 'adultA')?.email == null);
ok('member sees staff full names', rowOf(d, 'coach')?.full_name === 'Coach');
ok('member does not see pending/awaiting rows', d.every((r) => r.status === 'active'));
d = await dirAs('coach');
ok('staff see full name + email', rowOf(d, 'adultA')?.email === 'adultA@x.com');
ok('staff see junior full name', rowOf(d, 'juniorC')?.full_name === 'JuniorC');

await as('tm', `select public.update_group_settings($1, null, null, null, true, true, null)`, [club]);   // loosen: full name + email
d = await dirAs('adultB');
ok('loosening does not expose existing members', rowOf(d, 'adultA')?.email == null);
await as('adultA', `select public.accept_group_settings($1)`, [club]);
d = await dirAs('adultB');
ok('after accepting, adultA shows email', rowOf(d, 'adultA')?.email === 'adultA@x.com');
ok('juniors never show full name/email to members', rowOf(d, 'juniorC')?.full_name == null && rowOf(d, 'juniorC')?.email == null);
ok('junior cannot accept for themself', /NOT_ALLOWED/.test(await err('juniorC', `select public.accept_group_settings($1,$2)`, [club, U.kid1])));
await as('tm', `select public.update_group_settings($1, null, null, null, null, false, null)`, [club]);   // tighten: email off
d = await dirAs('adultB');
ok('tightening applies at once', rowOf(d, 'adultA')?.email == null);
await as('tm', `select public.update_group_settings($1, null, null, false, null, null, null)`, [club]);  // public names off
d = await dirAs('adultB');
ok('public names off → members see only staff and self', d.every((r) => r.is_staff || r.user_id === U.adultB), JSON.stringify(d.map((r) => r.public_name)));
ok('settings changes logged', (await svc(`select count(*)::int n from group_events where org_id=$1 and event='settings_changed'`, [club]))[0].n === 3);
ok('stranger sees no directory', (await dirAs('stranger')).length === 0);
ok('users RLS: member cannot read another member\'s row', (await as('adultB', `select email from users where id=$1`, [U.adultA])).rows.length === 0);
ok('users RLS: coach can', (await as('coach', `select email from users where id=$1`, [U.adultA])).rows.length === 1);

console.log('\nSharing group');
const share = await one('adultA', `select public.create_group('Training buddies','sharing','other')`);
const shareCode = await one('adultA', `select public.create_group_invite($1)`, [share]);
await as('adultB', `select public.join_group($1)`, [shareCode]);
ok('sharing group: creator is TM and member', (await svc(`select count(*)::int n from memberships where org_id=$1 and user_id=$2`, [share, U.adultA]))[0].n === 2);
ok('sharing group: members read each other', await one('adultB', 'select public.has_log_access($1,$2)', [U.adultA, 'read']));
ok('sharing group: but cannot add', !(await one('adultB', 'select public.has_log_access($1,$2)', [U.adultA, 'add'])));
await as('adultA', `select public.set_my_sharing($1,true,false,false,false)`, [share]);
ok('member switches own results off → hidden', !(await one('adultB', 'select public.has_log_access($1,$2)', [U.adultA, 'read'])));

console.log('\nSub-groups');
const squad = await one('tm', `select public.create_group('Riverside Dev — Squad A','coaching','squad',$1)`, [club]);
ok('TM of parent manages sub-group', await one('tm', 'select public.can_manage_group($1)', [squad]));
ok('coach of parent does not get sub-group access', !(await one('coach', `select public.has_group_capability($1,'read_results')`, [squad])));
ok('non-manager cannot create under someone else\'s group', /NOT_ALLOWED/.test(await err('coach', `select public.create_group('X','coaching','squad',$1)`, [club])));

console.log('\nLimits');
await svc(`update system_settings set value='2'::jsonb where key='group_create_daily_limit'`);
const lim = await err('tm', `select public.create_group('Third','coaching','club')`);
ok('daily group limit enforced', /RATE_LIMIT/.test(lim ?? ''), lim);
await svc(`update system_settings set value='10'::jsonb where key='group_create_daily_limit'`);

console.log('\nQualifications');
await as('coach', `select public.add_qualification('Swim England Coach Level 2','Swim England')`);
const p2 = await one('stranger', `select public.preview_group_invite($1)`, [memberCode]);
const coachStaff = p2.staff.find((s) => s.role_label === 'Coach');
ok('qualification shows on the join screen, unverified', coachStaff?.qualifications?.[0]?.verified === false, JSON.stringify(coachStaff));
ok('only root verifies', /NOT_ALLOWED/.test(await err('coach', `select public.verify_qualification(id) from staff_qualifications`)));

console.log('\nSponsorship (new people only)');
ok('TM of an unsponsored group cannot add new people',
  /NOT_ALLOWED/.test((await svc(`select public.validate_athlete_addition($1,$2,$3,'{}') e`, [U.tm, club, '1990-01-01']))[0].e));
await as('al', `select public.join_group($1)`, [memberCode]);
await as('al', 'select public.sponsor_group($1,$2)', [rootOrg, club]);
ok('root sponsors the club → TM can sponsor', await one('tm', 'select public.can_sponsor()'));
ok('existing account must use an invite link',
  /ALREADY_REGISTERED/.test((await svc(`select public.validate_athlete_addition($1,$2,$3,'{}',$4) e`, [U.tm, club, null, U.stranger]))[0].e));
const newId = (await svc(`select gen_random_uuid() id`))[0].id;
await svc(`select public.record_athlete_addition($1,$2,$3,'newkid@x.com','New Kid',$4,$5,true)`, [U.tm, club, newId, yearsAgo(11), ['parentB@x.com']]);
ok('new person added as member', (await svc(`select role from memberships where user_id=$1 and org_id=$2`, [newId, club]))[0]?.role === 'member');
const spId = (await svc(`select id from sponsorships where org_id=$1`, [club]))[0].id;
ok('club TM cannot suspend own sponsorship', /NOT_ALLOWED/.test(await err('tm', `select public.set_sponsorship_status($1,'suspended')`, [spId])));
await as('al', `select public.set_sponsorship_status($1,'suspended')`, [spId]);
ok('suspended → TM can no longer sponsor', !(await one('tm', 'select public.can_sponsor()')));
ok('suspension does not touch group access', await one('coach', 'select public.has_log_access($1,$2)', [U.adultA, 'read']));

console.log('\nApp reads');
const mmB = (await as('adultB', `select * from public.my_memberships()`)).rows;
const clubB = mmB.find((r) => r.org_id === club && r.role === 'member');
ok('my_memberships: role label + capabilities', clubB?.role_label === 'Member' && clubB.read_results === false);
ok('my_memberships: loosened tick not yet accepted is flagged', clubB?.settings_to_accept === true, JSON.stringify(clubB));
const clubA = (await as('adultA', `select * from public.my_memberships()`)).rows.find((r) => r.org_id === club);
ok('my_memberships: rejoined member re-took current ticks → nothing to accept', clubA?.settings_to_accept === false, JSON.stringify(clubA));
const athC = (await as('coach', `select * from public.my_athletes()`)).rows;
ok('my_athletes (coach): members of the group, read + add', athC.some((r) => r.athlete_id === U.adultA && r.can_read && r.can_add && r.via === 'Riverside Dev'));
ok('my_athletes (coach): staff not listed', !athC.some((r) => r.athlete_id === U.tm || r.athlete_id === U.helper));
ok('my_athletes (coach): full names', athC.find((r) => r.athlete_id === U.juniorC)?.name === 'JuniorC');
const athH = (await as('helper', `select * from public.my_athletes()`)).rows;
ok('my_athletes (poolside): add-only rows', athH.length > 0 && athH.every((r) => r.can_add && !r.can_read));
const athAl = (await as('al', `select * from public.my_athletes()`)).rows;
ok('my_athletes (Al): both children as guardian', ['kid1', 'kid2'].every((k) => athAl.find((r) => r.athlete_id === U[k])?.relation === 'guardian'));
ok('my_athletes (stranger): none', (await as('stranger', `select * from public.my_athletes()`)).rows.length === 0);
const asstCode = await one('tm', `select public.create_group_invite($1,'assistant_coach')`, [club]);
await as('parentB', `select public.join_group($1)`, [asstCode]);
const preqTm = (await as('tm', `select * from public.my_pending_requests()`)).rows;
ok('my_pending_requests (TM): the assistant coach request', preqTm.some((r) => r.kind === 'member_approval' && r.user_id === U.parentB && r.role_label === 'Assistant Coach'));
await svc(`insert into log_permissions(owner_user_id, grantee_user_id, can_read, can_add, can_edit, is_guardian, status)
           values ($1,$2,true,true,true,true,'pending')`, [U.juniorC, U.parentB]);
ok('my_pending_requests (parentB): guardianship offered', (await as('parentB', `select * from public.my_pending_requests()`)).rows.some((r) => r.kind === 'guardianship' && r.user_id === U.juniorC));
const log = (await as('adultB', `select * from public.group_event_log($1)`, [club])).rows;
ok('group_event_log: member reads it with names', log.length > 5 && log.some((e) => e.event === 'capability_changed' && e.subject_name === 'tm'));
ok('group_event_log: stranger gets nothing', (await as('stranger', `select * from public.group_event_log($1)`, [club])).rows.length === 0);
const tree = (await as('al', `select * from public.sponsorship_tree()`)).rows;
ok('sponsorship_tree (Al): root + club, club suspended', tree.length === 2 && tree.find((t) => t.org_id === club)?.status === 'suspended' && tree.find((t) => t.org_id === club)?.can_manage === true);
ok('sponsorship_tree (stranger): nothing', (await as('stranger', `select * from public.sponsorship_tree()`)).rows.length === 0);

console.log('\nDeleting a group');
const tmp = await one('stranger', `select public.create_group('Temp','coaching','other')`);
ok('a group can be deleted despite the last-TM guard', (await err(null, `delete from organisations where id='${tmp}'`)) === null);

console.log('\nDates of birth are private');
ok('users no longer has a date_of_birth column',
  (await svc(`select count(*)::int n from information_schema.columns where table_name='users' and column_name='date_of_birth'`))[0].n === 0);
ok('existing dates of birth carried over (Al, both children)',
  (await svc(`select count(*)::int n from user_birthdates where user_id = any($1)`, [[U.al, U.kid1, U.kid2]]))[0].n === 3);
ok('coach cannot read a member\'s date of birth', (await as('coach', `select * from user_birthdates where user_id=$1`, [U.adultA])).rows.length === 0);
ok('…but gets their age', (await one('coach', 'select public.athlete_age($1)', [U.adultA])) === 30);
ok('…and their age on a given date (gala age groups)', (await one('coach', `select public.athlete_age($1, (current_date - interval '1 year')::date)`, [U.adultA])) === 29);
ok('stranger gets no age', (await one('stranger', 'select public.athlete_age($1)', [U.adultA])) === null);
ok('you see your own', (await as('adultA', `select * from user_birthdates where user_id=$1`, [U.adultA])).rows.length === 1);
ok('a guardian sees their child\'s', (await as('al', `select * from user_birthdates where user_id=$1`, [U.kid1])).rows.length === 1);
ok('nobody writes the table directly', /row-level security|permission/.test(await err('adultA', `insert into user_birthdates(user_id, date_of_birth) values ($1,'1990-01-01')`, [U.stranger]) || ''));
ok('setting your own twice is refused', /ALREADY_SET/.test(await err('adultA', `select public.set_my_date_of_birth('1991-01-01')`) || ''));

console.log('\nNew people: no dates of birth from the sponsor; junior waits for the guardian');
await svc(`update sponsorships set status='active' where org_id=$1`, [club]);
const adultNew = (await svc(`select gen_random_uuid() id`))[0].id;
await svc(`select public.record_athlete_addition($1,$2,$3,'newadult@x.com','New Adult',null,'{}',true)`, [U.tm, club, adultNew]);
U.newadult = adultNew;
ok('new adult: active member, no date of birth on record', (await svc(`select status from memberships where user_id=$1 and org_id=$2`, [adultNew, club]))[0].status === 'active'
  && (await svc(`select count(*)::int n from user_birthdates where user_id=$1`, [adultNew]))[0].n === 0);
ok('…not yet an adult for guardian purposes', !(await svc(`select public.is_adult($1) a`, [adultNew]))[0].a);
const kidNew = (await svc(`select gen_random_uuid() id`))[0].id;
ok('cannot name them guardian until they add their date of birth',
  /GUARDIAN_NOT_ADULT/.test((await svc(`select public.validate_athlete_addition($1,$2,null,$3) e`, [U.tm, club, ['newadult@x.com']]))[0].e));
ok('own date of birth: too young refused', /INVALID/.test(await err('newadult', `select public.set_my_date_of_birth(current_date - 1)`) || ''));
ok('own date of birth saved', (await err('newadult', `select public.set_my_date_of_birth('1985-06-01')`)) === null);
const st = await one('newadult', 'select public.my_account_status()');
ok('my_account_status: has date, adult', st.has_date_of_birth && st.is_adult && !st.is_junior, st);
await svc(`select public.record_athlete_addition($1,$2,$3,'kidnew@x.com','Kid New',null,$4,true)`, [U.tm, club, kidNew, ['newadult@x.com']]);
U.kidnew = kidNew;
ok('new junior: declared under 18, waiting for guardian', (await svc(`select public.is_junior($1) j`, [kidNew]))[0].j
  && (await svc(`select status from memberships where user_id=$1 and org_id=$2`, [kidNew, club]))[0].status === 'awaiting_guardian');
ok('coach cannot read the junior yet', !(await one('coach', 'select public.has_log_access($1,$2)', [kidNew, 'read'])));
const gReq = (await as('newadult', `select * from public.my_pending_requests()`)).rows.find((r) => r.kind === 'guardianship');
ok('guardian sees the request, with the group and a date needed', gReq?.user_id === kidNew && gReq.needs_dob && gReq.org_name === 'Riverside Dev', gReq);
ok('no separate join card for a sponsor-added junior', !(await as('newadult', `select * from public.my_pending_requests()`)).rows.some((r) => r.kind === 'junior_join'));
ok('accept without a date → asked for it', /DOB_REQUIRED/.test(await err('newadult', `select public.respond_to_guardianship($1, true)`, [gReq.id]) || ''));
ok('accept with an adult date → refused', /INVALID/.test(await err('newadult', `select public.respond_to_guardianship($1, true, '1990-01-01')`, [gReq.id]) || ''));
ok('accept with the child\'s date', (await err('newadult', `select public.respond_to_guardianship($1, true, $2)`, [gReq.id, yearsAgo(10)])) === null);
ok('junior now active in the group', (await svc(`select status from memberships where user_id=$1 and org_id=$2`, [kidNew, club]))[0].status === 'active');
ok('coach reads the junior, sees age 10', (await one('coach', 'select public.has_log_access($1,$2)', [kidNew, 'read'])) && (await one('coach', 'select public.athlete_age($1)', [kidNew])) === 10);
ok('guardian cannot change the date again', /ALREADY_SET/.test(await err('newadult', `select public.set_junior_date_of_birth($1,$2)`, [kidNew, yearsAgo(9)]) || ''));
ok('root can correct it', (await err('al', `select public.correct_date_of_birth($1,$2)`, [kidNew, yearsAgo(9)])) === null);

console.log('\nNew bootstrap_root.sql (on a fresh database shape)');
await db.exec(`reset role; delete from sponsorships; delete from organisations where group_type = 'root'`);
await person('newroot', '1975-01-01');
const boot = readFileSync('supabase/bootstrap_root.sql', 'utf8').replaceAll('YOUR-EMAIL@example.com', 'newroot@x.com');
let bootErr = null;
try { await db.exec(boot); } catch (e) { bootErr = e.message; }
ok('bootstrap runs', bootErr === null, bootErr);
ok('bootstrapped user is root', await one('newroot', 'select public.is_root()'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
