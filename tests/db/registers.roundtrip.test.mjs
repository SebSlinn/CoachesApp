// tests/db/registers.roundtrip.test.mjs — Registers end to end: the REAL services/registers.js
// and SupabaseRegisterRepository, against PGlite with the FULL migration chain, signed in as
// each person in turn (so RLS and the SECURITY DEFINER rules are real). Also checks the pure
// helpers in services/registerLabels.js on real rows, and take_register through the groups service.
//
//   node tests/db/run.mjs registers.roundtrip.test.mjs
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { attach, signIn } from './fakeSupabase.js';
import * as G from '../../src/services/groups.js';
import * as R from '../../src/services/registers.js';
import { getMemberships } from '../../src/services/users.js';
import { hasCapability, describeCapabilities } from '../../src/services/groupLabels.js';
import { rollCall, registerableGroups, entryStatus, copyOf, todayLocal, toIso } from '../../src/services/registerLabels.js';
import { errorText } from '../../src/services/accountErrors.js';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };
const MIG = 'supabase/migrations';

const db = new PGlite();
await db.exec(`
  create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon, service_role;
  grant execute on function auth.uid() to authenticated, anon, service_role;
  create table public.users (id uuid primary key, email text not null unique, full_name text, avatar_url text, created_at timestamptz default now());
  create table public.organisations (id uuid primary key default gen_random_uuid(), name text not null, org_type text not null,
     invitation_quota int not null default 0, created_by uuid, created_at timestamptz default now());
  create table public.memberships (id uuid primary key default gen_random_uuid(),
     user_id uuid references public.users(id) on delete cascade, org_id uuid references public.organisations(id) on delete cascade,
     role text not null constraint memberships_role_check check (role = any (array['athlete','coach','manager','admin','guardian'])),
     status text not null default 'pending', created_at timestamptz default now(), unique (user_id, org_id, role));
`);
for (const f of fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(`${MIG}/${f}`, 'utf8'));
await db.exec(`grant usage on schema public to authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to authenticated, service_role;`);

const U = {};
const yearsAgo = (y) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); return d.toISOString().slice(0, 10); };
for (const [n, age] of [['coach', 40], ['parent', 42], ['swimmer', 30], ['kid', 11], ['stranger', 33]]) {
  U[n] = (await db.query(`insert into users(id, email, full_name, public_name) values (gen_random_uuid(), $1, $2, $3) returning id`,
    [`${n}@x.com`, n[0].toUpperCase() + n.slice(1) + ' Smith', n])).rows[0].id;
  await db.query(`insert into user_birthdates(user_id, date_of_birth) values ($1,$2)`, [U[n], yearsAgo(age)]);
}
await db.query(`insert into log_permissions(owner_user_id, grantee_user_id, can_read, can_add, can_edit, is_guardian, status)
                values ($1,$2,true,true,true,true,'active')`, [U.kid, U.parent]);
attach(db);

console.log('\nA coach sets up two squads');
signIn(U.coach);
const A = (await G.createGroup({ name: 'Squad A', groupType: 'coaching', orgType: 'squad' })).data;
const B = (await G.createGroup({ name: 'Squad B', groupType: 'coaching', orgType: 'squad' })).data;
await G.addMemberRole(A, U.coach, 'coach'); await G.addMemberRole(B, U.coach, 'coach');
const code = (r) => (typeof r.data === 'string' ? r.data : r.data?.code);
const codeA = code(await G.createInvite(A, { role: 'member' }));
const codeB = code(await G.createInvite(B, { role: 'member' }));
signIn(U.swimmer); await G.joinGroup(codeA);
signIn(U.parent); await G.joinGroup(codeB, U.kid);
signIn(U.coach);

let mem = (await getMemberships()).data;
ok('getMemberships carries take_register', mem.some((m) => m.take_register === true), mem);
ok('hasCapability(take_register)', hasCapability(mem, 'take_register'));
ok('registerableGroups → both squads', registerableGroups(mem).map((g) => g.name).join(',') === 'Squad A,Squad B', registerableGroups(mem));
ok('describeCapabilities mentions registers', /takes registers/.test(describeCapabilities({ take_register: true })));
const roles = (await G.getRoles()).data;
ok('getRoles carries take_register', roles.find((r) => r.key === 'coach')?.take_register === true && roles.find((r) => r.key === 'member')?.take_register === false, roles);

console.log('\nStarting a register');
ok('no groups refused before the DB', /INVALID/.test((await R.createRegister({ orgIds: [], date: todayLocal(), startTime: '18:00' })).error?.message));
ok('end before start refused', /INVALID/.test((await R.createRegister({ orgIds: [A], date: todayLocal(), startTime: '18:00', endTime: '17:00' })).error?.message));
const created = await R.createRegister({ orgIds: [A, B], date: todayLocal(), startTime: '00:01', endTime: '23:59', venue: ' Calday ', poolType: '25SC' });
ok('createRegister returns an id', typeof created.data === 'string', created.error);
const reg = created.data;
let sheet = (await R.getRegisterSheet(reg)).data;
ok('sheet: two groups, two swimmers', sheet.groups.length === 2 && sheet.entries.length === 2, sheet);
ok('venue trimmed', sheet.register.venue === 'Calday');
ok('coach can run it', sheet.register.can_run === true);
const sw = sheet.entries.find((e) => e.athlete_user_id === U.swimmer);
const kid = sheet.entries.find((e) => e.athlete_user_id === U.kid);
ok('the kid is flagged under 18', kid.is_junior === true);
let list = (await R.listRegisters()).data;
ok('listRegisters shows it with counts', list.length === 1 && list[0].expected === 2 && list[0].group_names.join(',') === 'Squad A,Squad B', list);

console.log('\nTicking in and out');
let r = await R.tickIn(sw.id);
ok('tickIn → in', r.data?.attendance === 'in', r);
ok('entryStatus says In HH:MM', /^In \d\d:\d\d$/.test(entryStatus(r.data)), entryStatus(r.data));
ok('partial without a reason refused before the DB', /INVALID/.test((await R.signOutPartial(sw.id, {})).error?.message));
ok('bad % refused before the DB', /INVALID/.test((await R.signOutPartial(sw.id, { reason: 'unwell', donePct: 140 })).error?.message));
r = await R.signOutFull(kid.id);
ok('sign out someone not in → NOT_IN in words', errorText(r.error) === 'Tick them in before signing them out.', r.error);
r = await R.signOutPartial(sw.id, { reason: 'injured', doneM: '1500', note: 'shoulder' });
ok('partial sign-out', r.data?.completion === 'partial' && r.data?.done_m === 1500, r);
ok('entryStatus for partial', /partial \(injured\) · 1500 m/.test(entryStatus(r.data)), entryStatus(r.data));
await R.tickIn(kid.id);
sheet = (await R.getRegisterSheet(reg)).data;
let rc = rollCall(sheet.entries);
ok('rollCall: 2 on, 2 in, 1 out, 1 still in', rc.all.on === 2 && rc.all.in === 2 && rc.all.out === 1 && rc.all.stillIn === 1, rc);
ok('rollCall per group', rc.byGroup[kid.register_group_id].stillIn === 1 && rc.byGroup[sw.register_group_id].out === 1, rc.byGroup);
r = await R.closeRegister(reg);
ok('close while someone is in → STILL_IN with the count', /^STILL_IN/.test(r.error?.message) && /1 swimmer/.test(errorText(r.error)), r.error);
ok('signOutAll → 1', (await R.signOutAll(reg)).data === 1);
ok('close', (await R.closeRegister(reg)).error === null);

console.log('\nCopy last register');
list = (await R.listRegisters()).data;
const c = copyOf(list[0], todayLocal());
ok('copyOf keeps groups, venue, pool and clock times', c.orgIds.length === 2 && c.venue === 'Calday' && c.poolType === '25SC' && c.startTime === '00:01', c);
ok('toIso gives the same start as the original', new Date(toIso(c.date, c.startTime)).getTime() === new Date(sheet.register.starts_at).getTime(), [toIso(c.date, c.startTime), sheet.register.starts_at]);
const second = await R.createRegister(c);
ok('a copied register starts', typeof second.data === 'string' && second.data !== reg, second);

console.log('\nOthers');
signIn(U.stranger);
ok('stranger: no registers', (await R.listRegisters()).data.length === 0);
ok('stranger: sheet refused in words', errorText((await R.getRegisterSheet(reg)).error) === 'You don\'t have permission to do that.');
signIn(U.swimmer);
const mine = (await R.getAthleteRegisterEntries(U.swimmer)).data;
ok('swimmer sees their entry (2 registers → the closed one has partial)', mine.some((e) => e.completion === 'partial' && e.partial_reason === 'injured'), mine);
ok('swimmer writes a shared note', (await R.setRegisterNote(sw.id, 'Shoulder sore on fly', true)).error === null);
signIn(U.parent);
ok('guardian writes the kid\'s note', (await R.setRegisterNote(kid.id, 'Tired after school')).error === null);
ok('guardian reads the kid\'s entries', (await R.getAthleteRegisterEntries(U.kid)).data.length === 2);
signIn(U.coach);
sheet = (await R.getRegisterSheet(reg)).data;
ok('coach reads the shared note, not the unshared one',
  sheet.entries.find((e) => e.id === sw.id).athlete_note === 'Shoulder sore on fly' && sheet.entries.find((e) => e.id === kid.id).athlete_note == null, sheet.entries);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
