// tests/db/groups.roundtrip.test.mjs — the Accounts services end to end:
// the REAL services/groups.js, sponsorship.js, logSharing.js and users.js, through
// the real Supabase repositories, against PGlite with the FULL migration chain,
// signed in as each person in turn (so RLS and the SECURITY DEFINER rules are real).
// Also checks the pure helpers in services/groupLabels.js on real rows.
//
//   node tests/db/run.mjs groups.roundtrip.test.mjs
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { attach, signIn } from './fakeSupabase.js';
import * as G from '../../src/services/groups.js';
import * as SP from '../../src/services/sponsorship.js';
import * as L from '../../src/services/logSharing.js';
import { getMemberships } from '../../src/services/users.js';
import { groupsFromMemberships, hasCapability, describeCapabilities, describeEvent, describeVisibility } from '../../src/services/groupLabels.js';
import { parseAccountError } from '../../src/services/accountErrors.js';

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
for (const [n, age] of [['al', 50], ['coach', 40], ['parent', 42], ['adult', 30], ['kid', 12], ['helper', 45], ['stranger', 33]]) {
  U[n] = (await db.query(`insert into users(id, email, full_name, public_name, date_of_birth) values (gen_random_uuid(), $1, $2, $3, $4) returning id`,
    [`${n}@x.com`, n[0].toUpperCase() + n.slice(1) + ' Smith', n, yearsAgo(age)])).rows[0].id;
}
await db.exec(fs.readFileSync('supabase/bootstrap_root.sql', 'utf8').replace(/YOUR-EMAIL@example\.com/g, 'al@x.com'));
await db.query(`insert into log_permissions(owner_user_id, grantee_user_id, can_read, can_add, can_edit, is_guardian, status)
                values ($1,$2,true,true,true,true,'active')`, [U.kid, U.parent]);
attach(db);

// ---------------------------------------------------------------------------
console.log('\nA coach creates a club group and invites people');
signIn(U.coach);
const created = await G.createGroup({ name: '  Riverside Dev  ', groupType: 'coaching', orgType: 'club' });
ok('createGroup returns the new id', typeof created.data === 'string', created.error);
const club = created.data;
ok('blank name refused before reaching the DB', /INVALID/.test((await G.createGroup({ name: '  ' })).error?.message));
let mem = (await getMemberships()).data;
ok('getMemberships: creator is Team Manager with manage_members', mem.some((m) => m.org_id === club && m.role === 'team_manager' && m.manage_members));
ok('useAuth helper: hasCapability(manage_members)', hasCapability(mem, 'manage_members') && !hasCapability(mem, 'read_results'));
await G.addMemberRole(club, U.coach, 'coach');
mem = (await getMemberships()).data;
const grouped = groupsFromMemberships(mem);
ok('groupsFromMemberships: one group, two roles, read+add+manage', grouped.length === 1 && grouped[0].roles.length === 2
  && grouped[0].read_results && grouped[0].add_results && grouped[0].manage_members, grouped);
ok('getMyAccess: can manage, is staff', (await G.getMyAccess(club)).data?.can_manage === true);
const roles = (await G.getRoles()).data;
ok('getRoles: catalogue in order', roles.map((r) => r.key).join() === 'team_manager,coach,assistant_coach,poolside_assistant,member', roles);

const memberCode = (await G.createInvite(club, { role: 'member', expiresInDays: 7 })).data;
const poolCode = (await G.createInvite(club, { role: 'poolside_assistant', maxUses: 1 })).data;
ok('createInvite returns a code', /^[0-9A-F]{16}$/.test(memberCode), memberCode);
const inv = (await G.getGroupInvites(club)).data;
ok('getGroupInvites: both, poolside forced to approval, max 1', inv.length === 2 && inv.find((i) => i.role === 'poolside_assistant')?.needs_approval && inv.find((i) => i.role === 'poolside_assistant')?.max_uses === 1);

console.log('\nJoining by link');
signIn(U.adult);
const pv = (await G.previewInvite(memberCode.toLowerCase() + ' ')).data;
ok('previewInvite tidies the code; shows staff and what they can do', pv?.name === 'Riverside Dev' && pv.staff.some((s) => s.role_label === 'Coach' && describeCapabilities(s) === 'reads and adds results'), pv);
ok('describeVisibility on the preview', /your public name/.test(describeVisibility(pv.visibility)));
const bad = await G.previewInvite('NOTACODE');
ok('bad code → friendly error', parseAccountError(bad.error).message.startsWith('This invite link'), bad.error);
await G.joinGroup(memberCode);
ok('adult joined → active member', (await getMemberships()).data.some((m) => m.org_id === club && m.status === 'active' && m.role === 'member'));
signIn(U.kid);
await G.joinGroup(memberCode);
ok('child joining alone → awaiting guardian', (await getMemberships()).data.find((m) => m.org_id === club)?.status === 'awaiting_guardian');
signIn(U.parent);
let reqs = (await G.getPendingRequests()).data;
const jr = reqs.find((r) => r.kind === 'junior_join');
ok('parent sees the request with names', jr?.name === 'Kid Smith' && jr.org_name === 'Riverside Dev', reqs);
await G.approveJuniorMembership(jr.id, true);
ok('parent approves → child active', (await G.getPendingRequests()).data.length === 0);
signIn(U.helper);
await G.joinGroup(poolCode);
signIn(U.coach);
reqs = (await G.getPendingRequests()).data;
ok('coach (TM) sees the poolside request', reqs.some((r) => r.kind === 'member_approval' && r.role_label === 'Poolside Assistant'));
await G.approveMembership(reqs.find((r) => r.kind === 'member_approval').id, true);
signIn(U.stranger);
ok('used-up invite refused', /INVITE_INVALID/.test((await G.joinGroup(poolCode)).error?.message));

console.log('\nWho can load whom (Dashboard: My Athletes)');
signIn(U.coach);
let ath = (await L.getLoadableAthletes()).data;
ok('coach: adult and child, read + add, full names', ath.length === 2 && ath.every((a) => a.can_read && a.can_add) && ath.some((a) => a.name === 'Kid Smith'), ath);
signIn(U.parent);
ath = (await L.getLoadableAthletes()).data;
ok('parent: their child as guardian', ath.length === 1 && ath[0].relation === 'guardian' && ath[0].is_junior, ath);
signIn(U.helper);
ath = (await L.getLoadableAthletes()).data;
ok('poolside assistant: add-only rows', ath.length === 2 && ath.every((a) => a.can_add && !a.can_read), ath);
signIn(U.stranger);
ok('stranger: nobody', (await L.getLoadableAthletes()).data.length === 0);

console.log('\nMembers, capabilities and the log');
signIn(U.coach);
let dir = (await G.getGroupDirectory(club)).data;
ok('directory (staff view): everyone with emails', dir.length === 5 && dir.find((d) => d.user_id === U.adult)?.email === 'adult@x.com', dir.map((d) => d.public_name));
const helperRow = dir.find((d) => d.user_id === U.helper);
await G.setMemberCapability(helperRow.membership_id, 'read_results', true);
signIn(U.helper);
ok('capability switched on → helper can now read', (await L.getLoadableAthletes()).data.every((a) => a.can_read));
signIn(U.adult);
dir = (await G.getGroupDirectory(club)).data;
ok('directory (member view): no emails, child shown by public name only', dir.every((d) => d.user_id === U.adult || !d.email)
  && dir.find((d) => d.user_id === U.kid)?.full_name == null, dir);
const evs = (await G.getGroupEvents(club)).data;
const lines = evs.map(describeEvent);
ok('event log readable by a member, described in words', lines.some((l) => /helper changed|coach changed/i.test(l) && /read results on/.test(l)), lines);
ok('event log: joins listed', lines.some((l) => /kid joined as Member/.test(l)), lines);

console.log('\nSettings: loosen → members choose; tighten → at once');
signIn(U.coach);
await G.updateGroupSettings(club, { showFullName: true });
signIn(U.adult);
let mine = (await getMemberships()).data.find((m) => m.org_id === club);
ok('loosened → member flagged to review', mine.settings_to_accept === true, mine);
await G.acceptGroupSettings(club);
mine = (await getMemberships()).data.find((m) => m.org_id === club);
ok('accepted → flag cleared, full name shared', mine.settings_to_accept === false && mine.share_full_name === true, mine);
signIn(U.parent);
dir = (await G.getGroupDirectory(club)).data;
ok('guardian sees the group directory (child\'s group)', dir.some((d) => d.user_id === U.kid));
signIn(U.adult);
await G.setMySharing(club, { publicName: true, fullName: false, email: false, results: false });
signIn(U.parent);
ok('member withdrew full name → hidden from others again', (await G.getGroupDirectory(club)).data.find((d) => d.user_id === U.adult)?.full_name == null);
signIn(U.helper);
ok('…staff still see it', (await G.getGroupDirectory(club)).data.find((d) => d.user_id === U.adult)?.full_name === 'Adult Smith');
signIn(U.coach);
const g = (await G.getGroup(club)).data;
ok('getGroup returns the ticks', g.show_full_name === true && g.show_email === false, g);

console.log('\nLeaving');
signIn(U.coach);
const tmRow = (await getMemberships()).data.find((m) => m.org_id === club && m.role === 'team_manager');
const lastTm = await G.removeMembership(tmRow.membership_id);
ok('last Team Manager cannot leave → friendly message', parseAccountError(lastTm.error).message.startsWith('A group must keep'), lastTm.error);
signIn(U.parent);
const kidRow = (await G.getGroupDirectory(club)).data.find((d) => d.user_id === U.kid);
ok('guardian takes child out', !(await G.removeMembership(kidRow.membership_id)).error);
signIn(U.coach);
ok('coach no longer has the child', !(await L.getLoadableAthletes()).data.some((a) => a.athlete_id === U.kid));

console.log('\nQualifications');
signIn(U.coach);
await G.addQualification({ title: ' Swim England Coach Level 2 ', issuer: 'Swim England' });
const q = (await G.getMyQualifications(U.coach)).data;
ok('added and listed', q.length === 1 && q[0].title === 'Swim England Coach Level 2' && !q[0].verified_at, q);
signIn(U.stranger);
ok('shown on the join screen', (await G.previewInvite(memberCode)).data.staff.find((s) => s.role_label === 'Coach')?.qualifications?.length === 1);
signIn(U.al);
ok('root verifies', !(await SP.verifyQualification(q[0].id)).error);
signIn(U.coach);
ok('now verified', !!(await G.getMyQualifications(U.coach)).data[0].verified_at);
await G.removeQualification(q[0].id);
ok('removed', (await G.getMyQualifications(U.coach)).data.length === 0);

console.log('\nSponsorship');
signIn(U.coach);
ok('coach cannot sponsor yet', (await SP.canSponsor()).data === false);
signIn(U.al);
ok('Al is root', (await SP.isRoot()).data === true);
const tree0 = (await SP.getSponsorshipTree()).data;
ok('tree: the root', tree0.length === 1 && tree0[0].children.length === 0 && tree0[0].can_use, tree0);
await G.joinGroup(memberCode);
const sp = await SP.sponsorGroup(tree0[0].org_id, club);
ok('root sponsors the club', !sp.error, sp.error);
const tree1 = (await SP.getSponsorshipTree()).data;
ok('tree: club under root', tree1[0].children[0]?.org_name === 'Riverside Dev', tree1);
signIn(U.coach);
ok('coach (TM of club) can now sponsor', (await SP.canSponsor()).data === true);
signIn(U.al);
await SP.suspendSponsorship(tree1[0].children[0].sponsorship_id);
signIn(U.coach);
ok('suspended → coach cannot sponsor', (await SP.canSponsor()).data === false);
ok('…but still reads the adult\'s results', (await L.getLoadableAthletes()).data.some((a) => a.athlete_id === U.adult && a.can_read));
ok('addPerson validates before the Edge Function', /full name/.test((await SP.addPerson({ email: 'x@y.z' })).error?.message));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
