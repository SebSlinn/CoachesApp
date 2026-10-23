// registers.test.mjs — take_register (20261022120000) + Registers (20261022130000) + offline sync (20261022140000), PGlite.
//
// Builds the hand-made base tables, applies EVERY migration in order (the two new ones twice,
// to prove they are idempotent), then checks as real signed-in users:
//   • take_register: role defaults, per-person override, logged, returned by my_memberships/group_directory;
//   • a register holds only members of its groups; one entry per swimmer even if in two groups;
//   • creating/closing needs take_register in EVERY group; ticking needs it in that entry's group;
//   • tick in / out full / out partial / undo; latest device time wins; client_uuid dedup; every tap logged;
//   • sign everyone out, close (refused while someone is still in), reopen;
//   • the athlete's note: swimmer or guardian writes it; staff read it only when shared;
//   • strangers and members see nothing of the register; attendance never writes performance_results;
//   • offline: register_prepare, and sync_register (create offline, queued taps in time order, resend = no-op, close);
//   • summaries: one per group per session, coach/athlete figures, volume order, tests inside sessions, grid volumes, drill-down;
//   • scanning: QR codes and linked cards, scan in / out / repeat, visitors by scan only, guests, comments, the attendance grid.
//
//   node supabase/tests/registers.test.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const DIR = 'supabase/migrations/';
const NEW = ['20261022120000_take_register.sql', '20261022130000_registers.sql', '20261022140000_register_sync.sql', '20261022150000_register_scan_guests.sql', '20261023120000_register_summaries.sql'];

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

const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
for (const n of NEW) if (!all.includes(n)) { console.error('missing ' + n); process.exit(1); }
console.log(`\nApplying ${all.length} migrations (the new ones twice)…`);
for (const f of all) {
  for (const k of NEW.includes(f) ? [1, 2] : [1]) {
    try { await db.exec(readFileSync(DIR + f, 'utf8')); }
    catch (e) { console.error(`  FAILED on ${f} (${k}): ${e.message}`); process.exit(1); }
  }
}
await db.exec(`grant usage on schema public to authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to authenticated, service_role;`);

// ---- helpers ----
async function as(who, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${who ? U[who] : ''}', false);`);
  if (who) await db.exec('set role authenticated');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
const one = async (who, sql, p) => Object.values((await as(who, sql, p)).rows[0] ?? {})[0];
const err = async (who, sql, p) => { try { await as(who, sql, p); return null; } catch (e) { return e.message; } };
const svc = async (sql, p) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false)`); return (await db.query(sql, p)).rows; };
const yearsAgo = (y) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); return d.toISOString().slice(0, 10); };
async function person(n, years) {
  const r = await svc(`insert into users(email, full_name, public_name) values ($1,$2,$3) returning id`,
    [`${n}@x.com`, n[0].toUpperCase() + n.slice(1), n]);
  U[n] = r[0].id;
  await svc(`insert into user_birthdates(user_id, date_of_birth) values ($1,$2)`, [U[n], yearsAgo(years)]);
}
for (const [n, y] of [['tm', 45], ['coach', 40], ['helper', 50], ['adultA', 30], ['adultB', 31],
                      ['juniorC', 12], ['parentA', 42], ['late', 33], ['stranger', 35]]) await person(n, y);
await svc(`insert into log_permissions(owner_user_id, grantee_user_id, can_read, can_add, can_edit, is_guardian, status)
           values ($1,$2,true,true,true,true,'active')`, [U.juniorC, U.parentA]);

// Two squads run by tm; coach in both; helper (poolside) in A only.
const A = await one('tm', `select public.create_group('Squad A','coaching','squad')`);
const B = await one('tm', `select public.create_group('Squad B','coaching','squad')`);
async function joinAs(who, org, role) {
  const code = await one('tm', `select public.create_group_invite($1,$2)`, [org, role]);
  const m = await one(who, `select public.join_group($1)`, [code]);
  const st = (await svc(`select status from memberships where id=$1`, [m]))[0].status;
  if (st === 'pending') await as('tm', 'select public.approve_membership($1,true)', [m]);
  if (st === 'awaiting_guardian') await as('parentA', 'select public.approve_junior_membership($1,true)', [m]);
  return m;
}
await joinAs('coach', A, 'coach'); await joinAs('coach', B, 'coach');
const helperM = await joinAs('helper', A, 'poolside_assistant');
await joinAs('adultA', A, 'member');
await joinAs('adultB', A, 'member'); await joinAs('adultB', B, 'member');
await joinAs('juniorC', B, 'member');

console.log('\nPhase 0: take_register');
ok('coach has take_register (role default)', await one('coach', `select public.has_group_capability($1,'take_register')`, [A]));
ok('TM has it', await one('tm', `select public.has_group_capability($1,'take_register')`, [A]));
ok('poolside assistant has it', await one('helper', `select public.has_group_capability($1,'take_register')`, [A]));
ok('member does not', !(await one('adultA', `select public.has_group_capability($1,'take_register')`, [A])));
ok('take_register does not give read_results', !(await one('helper', 'select public.has_log_access($1,$2)', [U.adultA, 'read'])));
const mm = (await as('coach', `select * from public.my_memberships()`)).rows;
ok('my_memberships returns take_register', mm.length === 2 && mm.every((r) => r.take_register === true), JSON.stringify(mm.map((r) => r.take_register)));
const dir = (await as('tm', `select * from public.group_directory($1)`, [A])).rows;
ok('group_directory returns take_register', dir.find((r) => r.user_id === U.helper)?.take_register === true);
ok('member row shows false', dir.find((r) => r.user_id === U.adultA)?.take_register === false);
ok('coach cannot switch it', /NOT_ALLOWED/.test(await err('coach', `select public.set_member_capability($1,'take_register',false)`, [helperM])));
await as('tm', `select public.set_member_capability($1,'take_register',false)`, [helperM]);
ok('TM switches it off per person', !(await one('helper', `select public.has_group_capability($1,'take_register')`, [A])));
const ev = await svc(`select detail from group_events where org_id=$1 and event='capability_changed' order by created_at desc limit 1`, [A]);
ok('the change is logged with take_register', ev[0]?.detail?.to?.take_register === false, JSON.stringify(ev[0]?.detail));
await as('tm', `select public.set_member_capability($1,'take_register',null)`, [helperM]);
ok('null puts it back to the role default', await one('helper', `select public.has_group_capability($1,'take_register')`, [A]));
ok('unknown capability still refused', /INVALID/.test(await err('tm', `select public.set_member_capability($1,'fly',true)`, [helperM])));

console.log('\nCreating a register');
const start = new Date(Date.now() - 30 * 60000).toISOString();
ok('helper (A only) cannot create a register with A and B',
  /NOT_ALLOWED/.test(await err('helper', `select public.create_register($1::uuid[], $2)`, [[A, B], start])));
ok('a member cannot create one', /NOT_ALLOWED/.test(await err('adultA', `select public.create_register($1::uuid[], $2)`, [[A], start])));
ok('no groups refused', /INVALID/.test(await err('coach', `select public.create_register('{}'::uuid[], $1)`, [start])));
const cu = '11111111-1111-4111-8111-111111111111';
const R = await one('coach', `select public.create_register($1::uuid[], $2, null, 'Calday', '25SC', $3)`, [[A, B], start, cu]);
ok('coach creates a register with A and B', !!R);
ok('same client_uuid returns the same register', (await one('coach', `select public.create_register($1::uuid[], $2, null, 'Calday', '25SC', $3)`, [[A, B], start, cu])) === R);
const sheet = async (who = 'coach') => one(who, `select public.register_sheet($1)`, [R]);
let s = await sheet();
const ent = (who) => s.entries.find((e) => e.athlete_user_id === U[who]);
ok('two groups, in order', s.groups.map((g) => g.name).join(',') === 'Squad A,Squad B');
ok('expected list = athlete-side members only (no staff)', s.entries.length === 3, s.entries.map((e) => e.name).join(','));
ok('a swimmer in both groups appears once, under the first', ent('adultB') && s.groups.find((g) => g.id === ent('adultB').register_group_id).name === 'Squad A');
ok('junior is on it under Squad B', s.groups.find((g) => g.id === ent('juniorC').register_group_id)?.name === 'Squad B');
ok('coach sees full names', ent('adultA').name === 'AdultA');
ok('created event logged', (await svc(`select count(*)::int n from register_events where register_id=$1 and event='created'`, [R]))[0].n === 1);

console.log('\nWho can see it');
ok('helper sees it (take_register in A)', !!(await sheet('helper')));
ok('helper cannot run it (not in B)', !(await one('helper', `select public.can_run_register($1)`, [R])));
ok('stranger cannot read the sheet', /NOT_ALLOWED/.test(await err('stranger', `select public.register_sheet($1)`, [R])));
ok('RLS: stranger sees no registers rows', (await as('stranger', `select id from registers`)).rows.length === 0);
ok('RLS: a member sees no entries table rows', (await as('adultA', `select id from register_entries`)).rows.length === 0);
ok('RLS: coach sees the entries', (await as('coach', `select id from register_entries`)).rows.length === 3);
ok('RLS: nobody inserts directly (registers)', /row-level security/.test(await err('coach',
  `insert into registers(starts_at) values (now())`)));
ok('RLS: nobody updates entries directly', (await as('coach', `update register_entries set attendance='in' returning id`)).rows.length === 0);
ok('trigger: a non-member can never be on a register, even by service role', /NOT_A_MEMBER/.test(await err(null,
  `insert into register_entries(register_id, register_group_id, athlete_user_id) values ($1,$2,$3)`, [R, s.groups[0].id, U.stranger])));
ok('my_registers lists it for the coach', (await as('coach', `select * from public.my_registers()`)).rows.length === 1);
ok('my_registers empty for a stranger', (await as('stranger', `select * from public.my_registers()`)).rows.length === 0);

console.log('\nMembers only');
ok('cannot add a non-member', /NOT_A_MEMBER/.test(await err('coach', `select public.add_register_entry($1,$2)`, [s.groups[0].id, U.stranger])));
ok('cannot add a staff member as a swimmer', /NOT_A_MEMBER/.test(await err('coach', `select public.add_register_entry($1,$2)`, [s.groups[0].id, U.helper])));
await joinAs('late', A, 'member');
const cand = (await as('coach', `select * from public.register_candidates($1)`, [s.groups[0].id])).rows;
ok('a member who joined since shows as a candidate', cand.length === 1 && cand[0].athlete_user_id === U.late, JSON.stringify(cand));
const lateE = await one('coach', `select public.add_register_entry($1,$2)`, [s.groups[0].id, U.late]);
ok('and can be added (not expected)', (await svc(`select expected from register_entries where id=$1`, [lateE]))[0].expected === false);
ok('adding again returns the same entry', (await one('coach', `select public.add_register_entry($1,$2)`, [s.groups[0].id, U.late])) === lateE);
ok('adultB already on (via A) is not re-added under B', (await one('coach', `select public.add_register_entry($1,$2)`, [s.groups[1].id, U.adultB])) === ent('adultB').id);

console.log('\nTicking in and signing out');
const mark = (who, id, action, at, detail, cuid) => as(who,
  `select public.mark_register_entry($1,$2,$3,$4::jsonb,$5) as e`, [id, action, at ?? null, JSON.stringify(detail ?? {}), cuid ?? null]).then((r) => r.rows[0].e);
const t = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
let e = await mark('coach', ent('adultA').id, 'in', t(25));
ok('tick in sets in and the time', e.attendance === 'in' && !!e.in_at);
ok('helper ticks a Squad A swimmer', (await mark('helper', ent('adultB').id, 'in', t(24))).attendance === 'in');
ok('helper cannot tick a Squad B swimmer', /NOT_ALLOWED/.test(await err('helper', `select public.mark_register_entry($1,'in')`, [ent('juniorC').id])));
ok('cannot sign out someone not in', /NOT_IN/.test(await err('coach', `select public.mark_register_entry($1,'out_full')`, [ent('juniorC').id])));
await mark('coach', ent('juniorC').id, 'apologies', t(28));
ok('apologies recorded', (await sheet()).entries.find((x) => x.id === ent('juniorC').id).attendance === 'apologies');
e = await mark('coach', ent('adultA').id, 'undo_in', t(20));
ok('undo in → expected again', e.attendance === 'expected' && e.in_at === null);
e = await mark('helper', ent('adultA').id, 'in', t(26));
ok('an older tap from another coach does not override a newer one', e.attendance === 'expected');
ok('…but it is still logged', (await svc(`select count(*)::int n from register_events where entry_id=$1`, [ent('adultA').id]))[0].n === 3);
e = await mark('coach', ent('adultA').id, 'in', t(19), {}, '22222222-2222-4222-8222-222222222222');
ok('tick in again', e.attendance === 'in');
await mark('coach', ent('adultA').id, 'undo_in', t(18), {}, '22222222-2222-4222-8222-222222222222');
ok('same client_uuid twice is a no-op', (await svc(`select attendance from register_entries where id=$1`, [ent('adultA').id]))[0].attendance === 'in');
ok('partial needs a reason', /INVALID/.test(await err('coach', `select public.mark_register_entry($1,'out_partial')`, [ent('adultB').id])));
e = await mark('coach', ent('adultB').id, 'out_partial', t(5), { reason: 'unwell', done_pct: 60, note: 'headache' });
ok('partial sign-out with reason, % and note', e.completion === 'partial' && e.partial_reason === 'unwell' && e.done_pct === 60 && e.coach_note === 'headache');
ok('cannot mark absent while signed out', /SIGNED_OUT/.test(await err('coach', `select public.mark_register_entry($1,'absent')`, [ent('adultB').id])));
e = await mark('coach', ent('adultB').id, 'undo_out', t(4));
ok('undo sign-out', e.completion === null && e.out_at === null);
await mark('coach', ent('adultB').id, 'out_partial', t(3), { reason: 'left_early', done_m: 1800 });
await mark('coach', lateE, 'in', t(15));

console.log('\nClosing');
ok('helper cannot close (not in B)', /NOT_ALLOWED/.test(await err('helper', `select public.close_register($1)`, [R])));
ok('close refused while someone is in but not out', /STILL_IN: 2/.test(await err('coach', `select public.close_register($1)`, [R])));
let mr = (await as('coach', `select * from public.my_registers()`)).rows[0];
ok('counts: 4 on, 3 in, 1 out, 2 still in', mr.expected === 4 && mr.in_count === 3 && mr.out_count === 1 && mr.still_in === 2, JSON.stringify(mr));
ok('sign everyone out signs 2 (partial left alone)', (await one('coach', `select public.sign_out_all($1)`, [R])) === 2);
ok('partial kept', (await svc(`select completion from register_entries where id=$1`, [ent('adultB').id]))[0].completion === 'partial');
const cErr = await err('coach', `select public.close_register($1)`, [R]);
ok('close works once everyone is out', cErr === null, cErr);
ok('closed', (await svc(`select status from registers where id=$1`, [R]))[0].status === 'closed');
ok('cannot add a group to a closed register', /CLOSED/.test(await err('coach', `select public.add_register_group($1,$2)`, [R, A])));
await as('coach', `select public.reopen_register($1)`, [R]);
ok('reopen', (await svc(`select status from registers where id=$1`, [R]))[0].status === 'open');
await mark('coach', ent('juniorC').id, 'in', t(1));
ok('still-in refusal again', /STILL_IN: 1/.test(await err('coach', `select public.close_register($1)`, [R])));
await as('coach', `select public.close_register($1,true)`, [R]);
const fc = await svc(`select detail from register_events where register_id=$1 and event='closed' order by recorded_at desc limit 1`, [R]);
ok('forced close (coach has checked) is allowed and logged', fc[0]?.detail?.forced === true && fc[0]?.detail?.still_in === 1, JSON.stringify(fc[0]));

console.log('\nThe athlete\'s side and notes');
const mine = (await as('adultB', `select * from public.my_register_entries()`)).rows;
ok('athlete sees their own entry', mine.length === 1 && mine[0].completion === 'partial' && mine[0].done_m === 1800);
ok('athlete does not get the coach note', !('coach_note' in mine[0]));
ok('a member cannot read someone else\'s entries', (await as('adultA', `select * from public.my_register_entries($1)`, [U.adultB])).rows.length === 0);
ok('guardian sees the junior\'s entries', (await as('parentA', `select * from public.my_register_entries($1)`, [U.juniorC])).rows.length === 1);
await as('adultA', `select public.set_register_note($1,'Held 1:18s',false)`, [ent('adultA').id]);
ok('athlete writes their note', (await as('adultA', `select note from register_notes`)).rows[0]?.note === 'Held 1:18s');
ok('coach cannot read an unshared note (sheet)', (await sheet()).entries.find((x) => x.id === ent('adultA').id).athlete_note == null);
ok('coach cannot read an unshared note (RLS)', (await as('coach', `select note from register_notes`)).rows.length === 0);
await as('adultA', `select public.set_register_note($1,'Held 1:18s',true)`, [ent('adultA').id]);
ok('shared → coach reads it', (await sheet()).entries.find((x) => x.id === ent('adultA').id).athlete_note === 'Held 1:18s');
ok('guardian writes the junior\'s note', (await err('parentA', `select public.set_register_note($1,'Sent apologies — school trip')`, [ent('juniorC').id])) === null);
ok('coach cannot write a swimmer\'s note', /NOT_ALLOWED/.test(await err('coach', `select public.set_register_note($1,'x')`, [ent('adultA').id])));
ok('another member cannot write it', /NOT_ALLOWED/.test(await err('adultB', `select public.set_register_note($1,'x')`, [ent('adultA').id])));

console.log('\nOffline: prepare and sync');
const prep = await one('coach', `select public.register_prepare()`);
ok('prepare: my groups with members', prep.groups.map((g) => g.name).join(',') === 'Squad A,Squad B'
  && prep.groups[0].members.some((m) => m.athlete_user_id === U.adultA), JSON.stringify(prep.groups.map((g) => [g.name, g.members.length])));
ok('prepare: staff are not listed as members', prep.groups.every((g) => g.members.every((m) => m.athlete_user_id !== U.helper)));
ok('prepare: includes recent register sheets', prep.registers.some((r) => r.register.id === R));
ok('prepare: a member gets no groups', (await one('adultA', `select public.register_prepare()`)).groups.length === 0);
const offCu = '33333333-3333-4333-8333-333333333333';
const uu = (n) => `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`;
const payload = {
  create: { client_uuid: offCu, org_ids: [A, B], starts_at: t(60), ends_at: null, venue: 'No signal pool', pool_type: '25SC' },
  ops: [
    { client_uuid: uu(3), athlete_user_id: U.adultA, action: 'out_partial', at: t(10), detail: { reason: 'left_early', done_pct: 50 } },
    { client_uuid: uu(1), athlete_user_id: U.adultA, action: 'in', at: t(55) },        // out of order on purpose
    { client_uuid: uu(2), athlete_user_id: U.juniorC, action: 'in', at: t(54) },
    { client_uuid: uu(4), athlete_user_id: U.stranger, action: 'in', at: t(53) },      // not a member
    { client_uuid: uu(5), athlete_user_id: U.juniorC, action: 'out_full', at: t(2) },
  ],
  close: { force: false },
};
const sync = async (who, p) => one(who, `select public.sync_register($1::jsonb)`, [JSON.stringify(p)]);
let res = await sync('coach', payload);
const R2 = res.register_id;
ok('sync creates the register made offline', !!R2 && R2 !== R);
ok('taps applied in time order (in before out)', res.sheet.entries.find((e) => e.athlete_user_id === U.adultA).completion === 'partial', JSON.stringify(res.results));
ok('the non-member tap is refused, the rest go through', res.results.filter((r) => !r.ok).length === 1
  && /NOT_A_MEMBER/.test(res.results.find((r) => !r.ok).error), JSON.stringify(res.results));
ok('close in the same sync (everyone in is out)', res.close?.ok === true, JSON.stringify(res.close));
ok('device times kept', res.sheet.entries.find((e) => e.athlete_user_id === U.juniorC).in_at.slice(0, 16) === t(54).slice(0, 16));
const nEv = (await svc(`select count(*)::int n from register_events where register_id=$1`, [R2]))[0].n;
res = await sync('coach', payload);
ok('sending the same queue again: same register, nothing doubled', res.register_id === R2
  && (await svc(`select count(*)::int n from register_events where register_id=$1`, [R2]))[0].n <= nEv + 1, nEv);
ok('helper (A only) cannot sync a new A+B register', /NOT_ALLOWED/.test(await err('helper', `select public.sync_register($1::jsonb)`,
  [JSON.stringify({ ...payload, create: { ...payload.create, client_uuid: uu(99) } })])));
const R3 = await one('coach', `select public.create_register($1::uuid[], $2)`, [[A], t(30)]);
res = await sync('helper', { register_id: R3, ops: [{ client_uuid: uu(10), athlete_user_id: U.adultB, action: 'in', at: t(20) },
                                                     { client_uuid: uu(11), athlete_user_id: U.late, action: 'apologies', at: t(25) }] });
ok('sync onto an existing register (helper, own group)', res.results.every((r) => r.ok) && res.sheet.entries.find((e) => e.athlete_user_id === U.adultB).attendance === 'in', JSON.stringify(res.results));
ok('a stranger cannot sync onto it', /NOT_ALLOWED/.test(await err('stranger', `select public.sync_register($1::jsonb)`, [JSON.stringify({ register_id: R3, ops: [] })])));
res = await sync('coach', { register_id: R3, ops: [], close: { force: false } });
ok('close refused in sync is reported, not thrown', res.close?.ok === false && /STILL_IN/.test(res.close.error), JSON.stringify(res.close));

console.log('\nCards and scanning');
const qrA = await one('coach', `select public.register_qr_code($1)`, [U.adultA]);
ok('coach gets a member\'s QR code (made on first ask)', /^SZ[0-9A-F]{12}$/.test(qrA), qrA);
ok('same code next time', (await one('adultA', `select public.register_qr_code()`)) === qrA);
ok('a stranger cannot see someone\'s code', /NOT_ALLOWED/.test(await err('stranger', `select public.register_qr_code($1)`, [U.adultA])));
ok('guardian gets the junior\'s code', /^SZ/.test(await one('parentA', `select public.register_qr_code($1)`, [U.juniorC])));
const cards = (await as('coach', `select * from public.group_register_qr_codes($1)`, [A])).rows;
ok('printable QR list for the whole group', cards.length >= 3 && cards.every((c) => /^SZ/.test(c.code)), cards.length);
ok('a member cannot print the group\'s cards', /NOT_ALLOWED/.test(await err('adultA', `select * from public.group_register_qr_codes($1)`, [A])));
await as('coach', `select public.link_register_card($1,' 04 a1 b2 ','rfid','Blue fob')`, [U.adultB]);
ok('RFID card linked (code normalised)', (await as('coach', `select * from public.list_register_cards($1)`, [U.adultB])).rows.some((c) => c.code === '04A1B2' && c.kind === 'rfid'));
ok('the same card for someone else → CARD_IN_USE', /CARD_IN_USE/.test(await err('coach', `select public.link_register_card($1,'04A1B2')`, [U.late])));
ok('linking it again to the same person is fine', (await err('coach', `select public.link_register_card($1,'04a1b2')`, [U.adultB])) === null);
const R4 = await one('coach', `select public.create_register($1::uuid[], $2)`, [[A], t(90)]);
const scan = (who, code, at) => one(who, `select public.scan_register($1,$2,$3)`, [R4, code, at ?? null]);
let sc = await scan('coach', qrA, t(80));
ok('scan → in', sc.result === 'in' && sc.name === 'AdultA', JSON.stringify(sc));
ok('scan again straight away → already in (ignored)', (await scan('coach', qrA, t(78))).result === 'already_in');
ok('scan 10+ minutes later → signed out, full', (await scan('coach', qrA, t(5))).result === 'out');
ok('…and then already out', (await scan('coach', qrA, t(4))).result === 'already_out');
ok('the RFID fob works the same (spaces and case ignored)', (await scan('coach', '04 a1 B2', t(70))).result === 'in');
ok('unknown card → unknown_card', (await scan('coach', 'NOPE123')).result === 'unknown_card');
ok('a member cannot scan', /NOT_ALLOWED/.test(await err('adultA', `select public.scan_register($1,$2)`, [R4, qrA])));
const qrS = await one('stranger', `select public.register_qr_code()`);
sc = await scan('coach', qrS, t(60));
ok('someone on SwimZone outside the group → added as a visitor and ticked in', sc.result === 'in' && sc.visitor === true, JSON.stringify(sc));
ok('the visitor sees it in their own log', (await as('stranger', `select * from public.my_register_entries()`)).rows.length === 1);
ok('the coach still cannot read the visitor\'s results', !(await one('coach', 'select public.has_log_access($1,$2)', [U.stranger, 'read'])));
const rg4 = (await svc(`select id from register_groups where register_id=$1`, [R4]))[0].id;
ok('a visitor can only arrive by scan (not added directly)', /NOT_A_MEMBER/.test(await err(null,
  `insert into register_entries(register_id, register_group_id, athlete_user_id, kind) values ($1,$2,$3,'visitor')`, [R4, rg4, U.parentA])));

console.log('\nGuests and comments');
const gid = await one('coach', `select public.add_register_guest($1,'  Trial Tom ')`, [rg4]);
let sh4 = await one('coach', `select public.register_sheet($1)`, [R4]);
const gE = sh4.entries.find((e) => e.id === gid);
ok('guest by typed name, ticked in', gE?.kind === 'guest' && gE.name === 'Trial Tom' && gE.attendance === 'in', JSON.stringify(gE));
ok('guest has a person_key for the phone', /^guest:/.test(gE.person_key));
ok('empty guest name refused', /INVALID/.test(await err('coach', `select public.add_register_guest($1,'  ')`, [rg4])));
ok('a member cannot add guests', /NOT_ALLOWED/.test(await err('adultA', `select public.add_register_guest($1,'X')`, [rg4])));
await as('coach', `select public.set_register_comment($1,'Pool cold, lane 6 shut')`, [R4]);
await as('coach', `select public.set_entry_comment($1,'Great turns')`, [sh4.entries.find((e) => e.athlete_user_id === U.adultA).id]);
sh4 = await one('coach', `select public.register_sheet($1)`, [R4]);
ok('session comment', sh4.register.comment === 'Pool cold, lane 6 shut');
ok('swimmer comment', sh4.entries.find((e) => e.athlete_user_id === U.adultA).coach_note === 'Great turns');
ok('a member cannot comment', /NOT_ALLOWED/.test(await err('adultA', `select public.set_register_comment($1,'x')`, [R4])));
const gk = 'guest:55555555-5555-4555-8555-000000000001';
const gsync = { register_id: R4, ops: [
  { client_uuid: uu(20), athlete_user_id: gk, action: 'guest', at: t(50), detail: { name: 'Offline Olive' } },
  { client_uuid: uu(21), athlete_user_id: gk, action: 'out_partial', at: t(20), detail: { reason: 'left_early' } },
  { client_uuid: uu(22), athlete_user_id: U.adultB, action: 'comment', at: t(19), detail: { comment: 'Fob works' } }] };
res = await sync('coach', gsync);
const olive = res.sheet.entries.find((e) => e.person_key === gk);
ok('guest made offline syncs (in, then partial)', olive?.name === 'Offline Olive' && olive.completion === 'partial', JSON.stringify(res.results));
ok('comment op syncs', res.sheet.entries.find((e) => e.athlete_user_id === U.adultB).coach_note === 'Fob works');
res = await sync('coach', gsync);
ok('resend: still one Olive', res.sheet.entries.filter((e) => e.name === 'Offline Olive').length === 1);

console.log('\nAttendance grid');
await one('coach', `select public.sign_out_all($1)`, [R4]);
await as('coach', `select public.close_register($1,true)`, [R4]);
const grid = await one('coach', `select public.group_attendance($1,$2,$3)`, [A, t(60 * 24 * 3), new Date(Date.now() + 86400000).toISOString()]);
const cell = (who, reg) => grid.athletes.find((a) => a.user_id === U[who])?.cells?.[reg];
ok('columns = registers with Squad A in the period', grid.registers.length >= 3 && grid.registers.some((r) => r.id === R4), grid.registers.length);
ok('C = complete', cell('adultA', R4) === 'C', JSON.stringify(grid.athletes.find((a) => a.user_id === U.adultA)));
ok('P = partial', cell('adultA', R) === 'P' || cell('adultB', R) === 'P', [cell('adultA', R), cell('adultB', R)]);
ok('N = not booked (on a register they weren\'t on)', grid.athletes.some((a) => Object.values(a.cells).includes('N')));
ok('A = no-show on a closed register', cell('late', R4) === 'A', cell('late', R4));
ok('visitor listed, marked not a member', grid.athletes.find((a) => a.user_id === U.stranger)?.member === false);
ok('guests counted, not listed', grid.registers.find((r) => r.id === R4).guests >= 1 && !grid.athletes.some((a) => a.name === 'Trial Tom'));
ok('a member cannot see the grid', /NOT_ALLOWED/.test(await err('adultA', `select public.group_attendance($1,$2,$3)`, [A, t(9999), t(0)])));
ok('staff without take_register (helper switched off) still can, as staff', (await err('helper', `select public.group_attendance($1,$2,$3)`, [A, t(9999), t(0)])) === null);

console.log('\nSession summaries and volume');
const rgA4 = (await svc(`select id from register_groups where register_id=$1`, [R4]))[0].id;
ok('a member cannot write the session summary', /NOT_ALLOWED/.test(await err('adultA', `select public.set_session_summary($1,'x',100)`, [rgA4])));
ok('bad breakdown label refused', /INVALID/.test(await err('coach', `select public.set_session_summary($1,'x',5000,'{"A/T":10}'::jsonb)`, [rgA4])));
ok('volume over 50 km refused', /INVALID/.test(await err('coach', `select public.set_session_summary($1,'x',60000)`, [rgA4])));
ok('13 breakdown figures refused', /INVALID/.test(await err('coach', `select public.set_session_summary($1,'x',5000,$2::jsonb)`,
  [rgA4, JSON.stringify(Object.fromEntries(Array.from({ length: 13 }, (_, i) => ['Z' + i, 10])))])));
await as('coach', `select public.set_session_summary($1,' AEC Threshold 30BBM 10x400 ',5000,'{"AT":2000,"No1":1600,"":5}'::jsonb)`, [rgA4]);
const g4 = (await svc(`select summary_text, volume_m, breakdown from register_groups where id=$1`, [rgA4]))[0];
ok('summary stored once for the group (text trimmed, empty label dropped)', g4.summary_text === 'AEC Threshold 30BBM 10x400' && g4.volume_m === 5000
  && JSON.stringify(g4.breakdown) === JSON.stringify({ AT: 2000, No1: 1600 }), JSON.stringify(g4));
ok('the sheet shows it on the group', (await one('coach', `select public.register_sheet($1)`, [R4])).groups[0].volume_m === 5000);
const e4 = async (who) => (await svc(`select id from register_entries where register_id=$1 and athlete_user_id=$2`, [R4, U[who]]))[0]?.id;
const vol = async (who) => one('coach', `select public.entry_volume($1)`, [await e4(who)]);
let v4 = await vol('adultA');
ok('attended, no figures → the session volume', v4.m === 5000 && v4.src === 'session' && v4.breakdown?.AT === 2000, JSON.stringify(v4));
ok('absent → no volume', (await vol('late')).m === null);
await as('coach', `select public.set_entry_volume($1,4200)`, [await e4('adultB')]);
ok('coach\'s figure for one swimmer', (await vol('adultB')).m === 4200 && (await vol('adultB')).src === 'coach');
ok('a member cannot set a swimmer\'s volume', /NOT_ALLOWED/.test(await err('adultA', `select public.set_entry_volume($1,1)`, [await e4('adultB')])));
await as('adultA', `select public.set_my_session_summary($1,4800,'{"AT":1800}'::jsonb)`, [await e4('adultA')]);
v4 = await vol('adultA');
ok('the athlete\'s own figure wins', v4.m === 4800 && v4.src === 'mine' && v4.breakdown?.AT === 1800, JSON.stringify(v4));
ok('…and keeps their note untouched', (await as('adultA', `select note from register_notes where entry_id=$1`, [await e4('adultA')])).rows[0]?.note == null);
ok('someone else cannot set my figure', /NOT_ALLOWED/.test(await err('adultB', `select public.set_my_session_summary($1,1)`, [await e4('adultA')])));
const rgR = (await svc(`select id, org_id from register_groups where register_id=$1 order by sort`, [R]));
await as('coach', `select public.set_session_summary($1,'Speed',3000)`, [rgR[0].id]);
ok('partial with metres → that figure', (await one('coach', `select public.entry_volume($1)`, [ent('adultB').id])).m === 1800);

console.log('\nTests inside sessions (training log)');
const today = (await svc(`select (now() at time zone 'Europe/London')::date d`))[0].d;
async function effort(who, firstAt, reps, dist, name, day) {
  const id = (await svc(`insert into set_efforts(athlete_user_id, swum_on, set_json) values ($1, $2, $3::jsonb) returning id`,
    [U[who], day ?? today, JSON.stringify({ fmt: 'swimzone.set/1', name, blocks: [] })]))[0].id;
  for (let i = 0; i < reps; i++) {
    await svc(`insert into performance_results(athlete_user_id, swum_on, stroke, dist_m, time_sec, kind, effort, effort_id, rep_no, started_at)
               values ($1,$2,'FS',$3,70,'training','submaximal',$4,$5,$6)`,
      [U[who], day ?? today, dist, id, i + 1, firstAt ? new Date(Date.parse(firstAt) + i * 120000).toISOString() : null]);
  }
  return id;
}
const ef1 = await effort('adultA', t(75), 30, 100, 'Threshold 30x100');           // 3000 m, inside R4
const ef2 = await effort('adultA', null, 4, 50, 'Home pool 4x50', '2026-01-15'); // no register that day
const logA = await one('adultA', `select public.athlete_training_log($1, $2, null)`, [U.adultA, '2026-01-01T00:00:00Z']);
const s4 = logA.find((x) => x.kind === 'session' && x.register_id === R4);
ok('the test sits inside the session it was swum in', s4?.tests?.length === 1 && s4.tests[0].effort_id === ef1 && s4.tests[0].volume_m === 3000, JSON.stringify(s4?.tests));
ok('session volume stays the total (test is part of it)', s4.volume.m === 4800 && s4.test_volume_m === 3000);
ok('a test outside any register is its own line', logA.some((x) => x.kind === 'test' && x.effort_id === ef2 && x.volume_m === 200));
ok('…and is not counted twice', logA.filter((x) => x.kind === 'test' && x.effort_id === ef1).length === 0);
ok('the log carries the group summary and letter', s4.session.text === 'AEC Threshold 30BBM 10x400' && s4.code === 'C');
ok('timeline is newest first', logA.every((x, i) => i === 0 || logA[i - 1].at >= x.at));
ok('guardian reads the junior\'s log', Array.isArray(await one('parentA', `select public.athlete_training_log($1)`, [U.juniorC])));
ok('a coach cannot read the athlete\'s log page (it\'s theirs)', /NOT_ALLOWED/.test(await err('coach', `select public.athlete_training_log($1)`, [U.adultA])));
ok('the matcher is internal', /permission denied/.test(await err('coach', `select * from public.athlete_efforts_matched($1, current_date, current_date)`, [U.adultA])));

console.log('\nGrid volumes and drill-down');
const grid2 = await one('coach', `select public.group_attendance($1,$2,$3)`, [A, t(60 * 24 * 3), new Date(Date.now() + 86400000).toISOString()]);
const rowA = grid2.athletes.find((a) => a.user_id === U.adultA);
ok('cell volume: C 4800 (her own figure)', rowA.cells[R4] === 'C' && rowA.vols[R4] === 4800, JSON.stringify({ c: rowA.cells[R4], v: rowA.vols[R4] }));
ok('total per swimmer over the period', rowA.total_m >= 4800);
ok('register column carries the session volume', grid2.registers.find((r) => r.id === R4).volume_m === 5000);
ok('entry ids for the drill-down', rowA.entries[R4] === await e4('adultA'));
let det = await one('coach', `select public.register_cell_detail($1)`, [await e4('adultA')]);
ok('drill-down: summary, volume, tests (coach reads results)', det.session.volume_m === 5000 && det.volume.m === 4800 && det.tests?.length === 1, JSON.stringify(det));
det = await one('helper', `select public.register_cell_detail($1)`, [await e4('adultA')]);
ok('poolside assistant: no tests (can\'t read results)', det.tests === null);
ok('stranger: refused', /NOT_ALLOWED/.test(await err('stranger', `select public.register_cell_detail($1)`, [await e4('adultA')])));

console.log('\nEvidence');
const evs = await svc(`select event, count(*)::int n from register_events where register_id=$1 group by event order by event`, [R]);
ok('every tap is in register_events', evs.reduce((a, r) => a + r.n, 0) >= 15, evs.map((r) => `${r.event}:${r.n}`).join(' '));
ok('attendance never writes performance_results (only the test sets inserted above exist)', (await svc(`select count(*)::int n from performance_results where effort_id is null`))[0].n === 0);
ok('internal fill function is not callable by users', /permission denied/.test(await err('coach', `select public.register_fill_group($1,$2,9)`, [R, A])));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
