// registers.test.mjs — take_register capability (20261022120000) + Registers (20261022130000), PGlite.
//
// Builds the hand-made base tables, applies EVERY migration in order (the two new ones twice,
// to prove they are idempotent), then checks as real signed-in users:
//   • take_register: role defaults, per-person override, logged, returned by my_memberships/group_directory;
//   • a register holds only members of its groups; one entry per swimmer even if in two groups;
//   • creating/closing needs take_register in EVERY group; ticking needs it in that entry's group;
//   • tick in / out full / out partial / undo; latest device time wins; client_uuid dedup; every tap logged;
//   • sign everyone out, close (refused while someone is still in), reopen;
//   • the athlete's note: swimmer or guardian writes it; staff read it only when shared;
//   • strangers and members see nothing of the register; attendance never writes performance_results.
//
//   node supabase/tests/registers.test.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const DIR = 'supabase/migrations/';
const NEW = ['20261022120000_take_register.sql', '20261022130000_registers.sql'];

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

console.log('\nEvidence');
const evs = await svc(`select event, count(*)::int n from register_events where register_id=$1 group by event order by event`, [R]);
ok('every tap is in register_events', evs.reduce((a, r) => a + r.n, 0) >= 15, evs.map((r) => `${r.event}:${r.n}`).join(' '));
ok('attendance never writes performance_results', (await svc(`select count(*)::int n from performance_results`))[0].n === 0);
ok('internal fill function is not callable by users', /permission denied/.test(await err('coach', `select public.register_fill_group($1,$2,9)`, [R, A])));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
