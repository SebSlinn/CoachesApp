// tests/db/registers.offline.test.mjs — Registers with no signal, end to end: the REAL
// services/registersOffline.js, LocalRegisterStore (on an in-memory localStorage) and
// SupabaseRegisterRepository, against PGlite with the full migration chain. The "internet" is
// switched off and on with fakeSupabase.setOffline().
//   • Get ready with signal; start a register, tick in, partial, add a swimmer, close — all offline;
//   • reconnect: one sync makes the register, applies the taps in time order, closes it;
//   • the phone's view matches the database's; a resend changes nothing;
//   • a tap the database refuses comes back as "failed", the rest go through;
//   • taps on an existing register queue offline and sync later; the pure rules match the DB's.
//
//   node tests/db/run.mjs registers.offline.test.mjs

// ---- an in-memory localStorage (the phone) ----
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear(),
};

import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { attach, signIn, setOffline } from './fakeSupabase.js';
import * as G from '../../src/services/groups.js';
import * as O from '../../src/services/registersOffline.js';
import { applyOp, buildLocalSheet, viewWithPending, isNetworkError, stillIn } from '../../src/services/registerOffline.js';
import { todayLocal } from '../../src/services/registerLabels.js';
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
for (const [n, age] of [['coach', 40], ['ann', 30], ['ben', 31], ['cal', 12], ['parent', 44], ['newbie', 29]]) {
  U[n] = (await db.query(`insert into users(id, email, full_name, public_name) values (gen_random_uuid(), $1, $2, $3) returning id`,
    [`${n}@x.com`, n[0].toUpperCase() + n.slice(1), n])).rows[0].id;
  await db.query(`insert into user_birthdates(user_id, date_of_birth) values ($1,$2)`, [U[n], yearsAgo(age)]);
}
await db.query(`insert into log_permissions(owner_user_id, grantee_user_id, can_read, can_add, can_edit, is_guardian, status)
                values ($1,$2,true,true,true,true,'active')`, [U.cal, U.parent]);
attach(db);
// the coach is signed in on this phone (what LocalRegisterStore.hasDeviceSession looks for)
localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: U.coach } }));

signIn(U.coach);
const A = (await G.createGroup({ name: 'Squad A', groupType: 'coaching', orgType: 'squad' })).data;
await G.addMemberRole(A, U.coach, 'coach');
const code = (r) => (typeof r.data === 'string' ? r.data : r.data?.code);
const codeA = code(await G.createInvite(A, { role: 'member' }));
signIn(U.ann); await G.joinGroup(codeA);
signIn(U.ben); await G.joinGroup(codeA);
signIn(U.parent); await G.joinGroup(codeA, U.cal);
signIn(U.coach);

console.log('\nThe rules on the phone match the database');
const spec = { client_uuid: 'aaaaaaaa-0000-4000-8000-000000000001', org_ids: [A], starts_at: new Date().toISOString() };
const groups = [{ org_id: A, name: 'Squad A', members: [{ athlete_user_id: 'x1', name: 'X One' }, { athlete_user_id: 'x2', name: 'X Two' }] }];
let s = buildLocalSheet(spec, groups);
ok('phone-made sheet: one group, two expected', s.groups.length === 1 && s.entries.length === 2 && s.entries.every((e) => e.attendance === 'expected'));
ok('out before in refused (NOT_IN)', /^NOT_IN/.test(applyOp(s, { athlete_user_id: 'x1', action: 'out_full' }).error));
s = applyOp(s, { athlete_user_id: 'x1', action: 'in', at: '2026-10-22T18:00:00Z' }, null, Date.parse('2026-10-22T19:00:00Z')).sheet;
ok('in', s.entries.find((e) => e.athlete_user_id === 'x1').attendance === 'in');
ok('partial needs a reason', /^INVALID/.test(applyOp(s, { athlete_user_id: 'x1', action: 'out_partial', detail: {} }).error));
const s2 = applyOp(s, { athlete_user_id: 'x1', action: 'undo_in', at: '2026-10-22T17:59:00Z' }, null, Date.parse('2026-10-22T19:00:00Z')).sheet;
ok('an older tap does not override a newer one', s2.entries.find((e) => e.athlete_user_id === 'x1').attendance === 'in');
ok('non-member refused (NOT_A_MEMBER)', /^NOT_A_MEMBER/.test(applyOp(s, { athlete_user_id: 'zz', action: 'in' }).error));
ok('taps applied in time order', viewWithPending(buildLocalSheet(spec, groups), [
  { athlete_user_id: 'x2', action: 'out_full', at: '2026-10-22T19:00:00Z' },
  { athlete_user_id: 'x2', action: 'in', at: '2026-10-22T18:00:00Z' }], null, Date.parse('2026-10-22T20:00:00Z'))
  .entries.find((e) => e.athlete_user_id === 'x2').completion === 'full');
ok('network failure recognised', isNetworkError({ message: 'TypeError: Failed to fetch' }) && !isNetworkError({ message: 'NOT_ALLOWED: x', code: 'P0001' }));

console.log('\nGet ready (with signal)');
let r = await O.prepareForPoolside();
ok('prepared: Squad A with 3 swimmers', r.data?.groups?.length === 1 && r.error === null, r);
ok('this phone can run registers offline', O.canUseOffline());

console.log('\nNo signal: start, tick, partial, add, close');
setOffline(true);
r = await O.startRegister({ orgIds: [A], date: todayLocal(), startTime: '00:05', venue: 'Basement pool' });
ok('register started on the phone', typeof r.data === 'string' && r.data.startsWith('local:') && r.offline === true, r);
const key = r.data;
r = await O.openRegister(key);
ok('opens offline with 3 expected, and says there is no signal', r.data?.sheet?.entries?.length === 3 && r.data.offline === true, r);
const ent = (sh, who) => sh.entries.find((e) => e.athlete_user_id === U[who]);
let sh = r.data.sheet;
r = await O.tap(key, ent(sh, 'ann'), 'in'); sh = r.data.sheet;
ok('tick in works offline', ent(sh, 'ann').attendance === 'in', r);
ok('one tap waiting', r.data.pending === 1);
r = await O.tap(key, ent(sh, 'cal'), 'in'); sh = r.data.sheet;
r = await O.tap(key, ent(sh, 'ben'), 'out_full');
ok('sign out someone not in → refused on the phone, in words', errorText(r.error) === 'Tick them in before signing them out.', r);
r = await O.tapPartial(key, ent(sh, 'cal'), { reason: 'unwell', donePct: '40', note: 'tummy ache' }); sh = r.data.sheet;
ok('partial offline', ent(sh, 'cal').completion === 'partial' && ent(sh, 'cal').done_pct === 40);
r = await O.tapClose(key);
ok('close refused while Ann is still in', /^STILL_IN/.test(r.error?.message), r.error);
r = await O.tapSignOutAll(key); sh = r.data.sheet;
ok('sign everyone out (Ann) offline', ent(sh, 'ann').completion === 'full' && r.signedOut === 1, r);
r = await O.tapClose(key);
ok('closed on the phone', r.data?.sheet?.register?.status === 'closed', r);
ok('summary: 1 register, 4 taps waiting', O.offlineSummary().pendingTaps === 4 && O.offlineSummary().pendingRegisters === 1, O.offlineSummary());
let list = await O.listForScreen();
ok('list offline shows the phone-made register as unsynced', list.offline === true && list.data.some((x) => x.key === key && x.unsynced > 0), list);
ok('nothing reached the database yet', (await db.query(`select count(*)::int n from registers`)).rows[0].n === 0);

console.log('\nSignal back: sync');
setOffline(false);
r = await O.flushAll();
ok('queue empty after sync', r.data.pendingTaps === 0 && r.data.pendingRegisters === 0 && r.data.failed.length === 0, r.data);
r = await O.openRegister(key);
const realId = r.data?.movedTo;
ok('the phone-made register now has a real id', !!realId && !realId.startsWith('local:'), r);
r = await O.openRegister(realId);
sh = r.data.sheet;
const dbRows = (await db.query(`select athlete_user_id, attendance, completion, partial_reason, done_pct from register_entries where register_id=$1`, [realId])).rows;
ok('database has the register, closed', (await db.query(`select status, venue from registers where id=$1`, [realId])).rows[0].status === 'closed');
ok('Ann full, Cal partial (unwell, 40%), Ben expected — in the database',
  dbRows.find((x) => x.athlete_user_id === U.ann).completion === 'full'
  && dbRows.find((x) => x.athlete_user_id === U.cal).partial_reason === 'unwell' && dbRows.find((x) => x.athlete_user_id === U.cal).done_pct === 40
  && dbRows.find((x) => x.athlete_user_id === U.ben).attendance === 'expected', dbRows);
ok('device tap times kept', !!ent(sh, 'ann').in_at && Math.abs(Date.parse(ent(sh, 'ann').in_at) - Date.now()) < 120000);
const nEvents = (await db.query(`select count(*)::int n from register_events where register_id=$1`, [realId])).rows[0].n;
ok('every offline tap is in the evidence log', nEvents >= 6, nEvents);

console.log('\nAn existing register, signal drops mid-session');
r = await O.startRegister({ orgIds: [A], date: todayLocal(), startTime: '00:10' });
const live = r.data;
ok('started online (real id)', typeof live === 'string' && !live.startsWith('local:'), r);
sh = (await O.openRegister(live)).data.sheet;
r = await O.tap(live, ent(sh, 'ben'), 'in');
ok('online tap goes straight through', r.data.pending === 0 && (await db.query(`select attendance from register_entries where register_id=$1 and athlete_user_id=$2`, [live, U.ben])).rows[0].attendance === 'in');
setOffline(true);
r = await O.openRegister(live);
ok('reopens from the phone with no signal', r.data?.offline === true && ent(r.data.sheet, 'ben').attendance === 'in', r);
r = await O.tap(live, ent(r.data.sheet, 'ann'), 'in');
ok('queued', r.data.pending === 1 && ent(r.data.sheet, 'ann').attendance === 'in');
setOffline(false);
r = await O.openRegister(live);
ok('sync on opening with signal', r.data.pending === 0 && r.data.offline === false
  && (await db.query(`select attendance from register_entries where register_id=$1 and athlete_user_id=$2`, [live, U.ann])).rows[0].attendance === 'in', r.data);

console.log('\nThe database says no to one tap');
// Newbie joins Squad A; the coach gets ready again; then Newbie leaves. The phone still lists them.
signIn(U.newbie); await G.joinGroup(codeA); signIn(U.coach);
await O.prepareForPoolside();
const newbieM = (await db.query(`select id from memberships where user_id=$1 and org_id=$2`, [U.newbie, A])).rows[0].id;
signIn(U.newbie); await G.removeMembership(newbieM); signIn(U.coach);
setOffline(true);
sh = (await O.openRegister(live)).data.sheet;
r = await O.addSwimmer(live, sh.groups[0], { athlete_user_id: U.newbie });
ok('phone allows adding Newbie (its list is from before they left)', !r.error && !!ent(r.data.sheet, 'newbie'), r);
r = await O.tap(live, ent(sh, 'ben'), 'out_full');
ok('and a normal tap', !r.error);
setOffline(false);
await O.flushAll();
const sum = O.offlineSummary();
ok('queue sent', sum.pendingTaps === 0, sum);
ok('Ben signed out in the database', (await db.query(`select completion from register_entries where register_id=$1 and athlete_user_id=$2`, [live, U.ben])).rows[0].completion === 'full');
ok('Newbie refused by the database and listed as failed, with the reason',
  sum.failed.length === 1 && /NOT_A_MEMBER/.test(sum.failed[0].error) && sum.failed[0].op.athlete_user_id === U.newbie, sum.failed);
ok('…and not on the register', !ent((await O.openRegister(live)).data.sheet, 'newbie'));
O.dismissFailed();
ok('failed list can be cleared', O.offlineSummary().failed.length === 0);
ok('stillIn helper (Ann still in)', stillIn((await O.openRegister(live)).data.sheet) === 1);

console.log('\nGuests and comments with no signal');
setOffline(true);
sh = (await O.openRegister(live)).data.sheet;
r = await O.addGuest(live, sh.groups[0], '  Trial Tia ');
ok('guest added offline, ticked in', r.data?.sheet?.entries?.some((e) => e.name === 'Trial Tia' && e.attendance === 'in' && e.kind === 'guest'), r);
const tia = r.data.sheet.entries.find((e) => e.name === 'Trial Tia');
r = await O.tap(live, tia, 'out_full');
ok('sign the guest out offline', r.data.sheet.entries.find((e) => e.name === 'Trial Tia').completion === 'full');
r = await O.commentEntry(live, ent(r.data.sheet, 'ann'), 'Good kick sets');
ok('comment on a swimmer offline', ent(r.data.sheet, 'ann').coach_note === 'Good kick sets');
r = await O.commentRegister(live, 'Lights out in lanes 1-2');
ok('session comment offline', r.data.sheet.register.comment === 'Lights out in lanes 1-2');
ok('empty guest name refused', /INVALID/.test((await O.addGuest(live, sh.groups[0], ' ')).error?.message));
setOffline(false);
await O.flushAll();
const rowsG = (await db.query(`select kind, guest_name, completion from register_entries where register_id=$1 and kind='guest'`, [live])).rows;
ok('synced: guest in the database, signed out', rowsG.length === 1 && rowsG[0].guest_name === 'Trial Tia' && rowsG[0].completion === 'full', rowsG);
ok('synced: comments in the database', (await db.query(`select comment from registers where id=$1`, [live])).rows[0].comment === 'Lights out in lanes 1-2'
  && (await db.query(`select coach_note from register_entries where register_id=$1 and athlete_user_id=$2`, [live, U.ann])).rows[0].coach_note === 'Good kick sets');
r = await O.openRegister(live);
ok('the phone shows the server copy, nothing pending', r.data.pending === 0 && r.data.sheet.entries.filter((e) => e.name === 'Trial Tia').length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
