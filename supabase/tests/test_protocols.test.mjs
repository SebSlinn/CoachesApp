// test_protocols.test.mjs — Test Set Library migration checks, PGlite, self-contained.
//
// Stubs the accounts tables + grant-tree helpers this migration relies on
// (copied from 20260923120000_user_accounts.sql / 20260924140000_rls_no_recursion.sql),
// applies the athlete-records migration, then the test-protocols migration, and
// checks — with RLS actually enforced (SET ROLE authenticated) — that:
//   1. the global library is seeded and visible to everyone signed in;
//   2. a club's private protocols are visible down its subtree, not to other clubs;
//   3. only root edits the global library; club staff edit their club's;
//   4. a protocol locks on first use and then refuses definition changes;
//   5. per-rep metrics land in a flat, RLS-respecting view.
//
//   npm i @electric-sql/pglite
//   node supabase/tests/test_protocols.test.mjs

import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const AR_MIGRATION = 'supabase/migrations/20260927120000_athlete_records.sql';
const DD_MIGRATION = 'supabase/migrations/20260928120000_drop_import_dedup.sql';
const TP_MIGRATION = process.argv[2] || 'supabase/migrations/20260929120000_test_protocols.sql';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
async function throws(fn) {
  try { await fn(); return null; } catch (e) { return e.message || String(e); }
}

const db = new PGlite();

const U = {
  root:  '00000000-0000-0000-0000-00000000a001',
  coach: '00000000-0000-0000-0000-00000000a002',   // coach of Club C
  swim:  '00000000-0000-0000-0000-00000000a003',   // athlete in Squad S (below C)
  other: '00000000-0000-0000-0000-00000000a004',   // athlete in Club D
};
const O = {
  R: '00000000-0000-0000-0000-00000000b001',  // root group
  C: '00000000-0000-0000-0000-00000000b002',  // club under root
  S: '00000000-0000-0000-0000-00000000b003',  // squad under C
  D: '00000000-0000-0000-0000-00000000b004',  // another club under root
};

async function bootstrap() {
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;

    create table public.users (id uuid primary key, email text, full_name text, created_at timestamptz default now());
    create table public.organisations (id uuid primary key default gen_random_uuid(), name text, org_type text);
    create table public.memberships (id uuid primary key default gen_random_uuid(),
      user_id uuid references public.users(id), org_id uuid references public.organisations(id),
      role text, status text);
    create table public.admin_grants (id uuid primary key default gen_random_uuid(),
      org_id uuid not null unique references public.organisations(id),
      parent_grant_id uuid references public.admin_grants(id), status text not null default 'active');

    create table public.performance_results (
      id uuid primary key default gen_random_uuid(),
      athlete_user_id uuid not null references public.users(id) on delete cascade,
      swum_on date not null, kind text, stroke text, dist_m int, pool_type text,
      time_sec numeric, splits jsonb, location text, notes text, source text,
      created_by uuid, updated_by uuid, created_at timestamptz default now(), updated_at timestamptz);

    -- has_log_access stub: nobody shares logs in this test (owners only).
    create or replace function public.has_log_access(o uuid, m text, u uuid default auth.uid()) returns boolean
      language sql stable as $$ select false $$;

    -- Grant-tree helpers, verbatim from the accounts migrations.
    create or replace function public.org_grant(p_org uuid) returns uuid
    language sql stable security definer set search_path = public as $$
      select id from admin_grants where org_id = p_org; $$;

    create or replace function public.grant_is_effective(p_grant uuid) returns boolean
    language sql stable security definer set search_path = public as $$
      with recursive chain as (
        select id, parent_grant_id, status, 1 as depth from admin_grants where id = p_grant
        union all
        select g.id, g.parent_grant_id, g.status, c.depth + 1
          from admin_grants g join chain c on g.id = c.parent_grant_id where c.depth < 100)
      select exists (select 1 from chain) and not exists (select 1 from chain where status <> 'active'); $$;

    create or replace function public.grant_ancestors(p_grant uuid) returns table (grant_id uuid, org_id uuid)
    language sql stable security definer set search_path = public as $$
      with recursive up as (
        select p.id, p.org_id, p.parent_grant_id, 1 as depth
          from admin_grants g join admin_grants p on p.id = g.parent_grant_id where g.id = p_grant
        union all
        select p.id, p.org_id, p.parent_grant_id, u.depth + 1
          from admin_grants p join up u on p.id = u.parent_grant_id where u.depth < 100)
      select id, org_id from up; $$;

    create or replace function public.is_group_admin(p_org uuid, p_user uuid default auth.uid()) returns boolean
    language sql stable security definer set search_path = public as $$
      select exists (select 1 from memberships where org_id = p_org and user_id = p_user
                      and role = 'admin' and status = 'active'); $$;

    create or replace function public.can_act_for_group(p_org uuid, p_user uuid default auth.uid()) returns boolean
    language sql stable security definer set search_path = public as $$
      select public.is_group_admin(p_org, p_user)
         and coalesce(public.grant_is_effective(public.org_grant(p_org)), false); $$;

    create or replace function public.can_manage_grant(p_grant uuid, p_user uuid default auth.uid()) returns boolean
    language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.grant_ancestors(p_grant) a
                      where public.can_act_for_group(a.org_id, p_user)); $$;

    create or replace function public.can_manage_group(p_org uuid, p_user uuid default auth.uid()) returns boolean
    language sql stable security definer set search_path = public as $$
      select public.can_act_for_group(p_org, p_user)
          or coalesce(public.can_manage_grant(public.org_grant(p_org), p_user), false); $$;

    create or replace function public.is_root(p_user uuid default auth.uid()) returns boolean
    language sql stable security definer set search_path = public as $$
      select exists (select 1 from admin_grants g where g.parent_grant_id is null and g.status = 'active'
                        and public.is_group_admin(g.org_id, p_user)); $$;

    create or replace function public.is_org_staff(p_org uuid, p_user uuid default auth.uid()) returns boolean
    language sql stable security definer set search_path = public as $$
      select exists (select 1 from memberships where org_id = p_org and user_id = p_user
                      and role = any (array['coach','manager','admin']) and status = 'active'); $$;

    create role authenticated;
  `);
}

async function seedPeople() {
  for (const [k, id] of Object.entries(U))
    await db.query(`insert into public.users (id, email, full_name) values ($1,$2,$3)`, [id, `${k}@x.test`, k]);
  await db.query(`insert into public.organisations (id,name,org_type) values
    ($1,'SwimZone','root'),($2,'Club C','club'),($3,'Squad S','club'),($4,'Club D','club')`,
    [O.R, O.C, O.S, O.D]);
  const g = async (org, parent) => (await db.query(
    `insert into public.admin_grants (org_id, parent_grant_id) values ($1,$2) returning id`, [org, parent])).rows[0].id;
  const gR = await g(O.R, null); const gC = await g(O.C, gR); await g(O.S, gC); await g(O.D, gR);
  await db.query(`insert into public.memberships (user_id, org_id, role, status) values
    ($1,$5,'admin','active'), ($2,$6,'coach','active'), ($3,$7,'athlete','active'), ($4,$8,'athlete','active')`,
    [U.root, U.coach, U.swim, U.other, O.R, O.C, O.S, O.D]);
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    grant all on all tables in schema public to authenticated;
    grant execute on all functions in schema public, auth to authenticated;`);
}

// Run fn as a signed-in user with RLS enforced.
async function as(user, fn) {
  await db.exec(`set test.uid = '${user}'; set role authenticated;`);
  try { return await fn(); }
  finally { await db.exec(`reset role; set test.uid = '';`); }
}

const clubSet = JSON.stringify({ fmt: 'swimzone.set/1', name: 'C private', blocks: [{ repeats: 1, lines: [] }] });

async function run() {
  await bootstrap();
  for (const m of [AR_MIGRATION, DD_MIGRATION, TP_MIGRATION]) {
    console.log('\nApplying ' + m + '…');
    try { await db.exec(readFileSync(m, 'utf8')); console.log('  applied'); }
    catch (e) { console.error('  FAILED: ' + e.message); process.exit(1); }
  }
  // grants after migration so new tables/views/functions are covered
  await seedPeople();

  console.log('\nSchema');
  const cols = async (t) => (await db.query(`select column_name from information_schema.columns
    where table_schema='public' and table_name=$1`, [t])).rows.map(r => r.column_name);
  ok('performance_results.metrics exists', (await cols('performance_results')).includes('metrics'));
  ok('set_efforts.summary exists', (await cols('set_efforts')).includes('summary'));
  ok('v_set_rep_metrics exists', (await cols('v_set_rep_metrics')).includes('lactate'));
  const fk = (await db.query(`select 1 from information_schema.table_constraints
    where table_name='set_efforts' and constraint_name='set_efforts_protocol_fk'`)).rows.length;
  ok('set_efforts.protocol_id is a real FK', fk === 1);
  const dedupIdx = (await db.query(`select 1 from pg_indexes where schemaname='public'
    and indexname='performance_results_import_dedup'`)).rows.length;
  ok('old import_dedup index is gone after the migration chain', dedupIdx === 0);
  const cuIdx = (await db.query(`select 1 from pg_indexes where schemaname='public'
    and indexname='performance_results_client_uuid_key'`)).rows.length;
  ok('client_uuid unique index (the real dedup key) still there', cuIdx === 1);

  console.log('\nSeeded global library');
  const seeded = (await db.query(`select key from public.test_protocols where owner_org_id is null order by key`)).rows.map(r => r.key);
  ok('7 global protocols seeded', seeded.length === 7, seeded.join(','));
  ok('includes your six + CSS', ['step-7x200','double-distance-400','turn-20x100','eff-8x50','max-hr','t10x400','css-400-200']
    .every(k => seeded.includes(k)));
  const again = await throws(() => db.exec(readFileSync(TP_MIGRATION, 'utf8')));
  const seeded2 = (await db.query(`select count(*)::int n from public.test_protocols`)).rows[0].n;
  ok('re-applying the migration is a no-op', again === null && seeded2 === 7, again || `n=${seeded2}`);
  const dup = await throws(() => db.query(`insert into public.test_protocols (key,version,name,set_json)
    values ('step-7x200',1,'dup',$1::jsonb)`, [clubSet]));
  ok('duplicate (global, key, version) rejected', dup && /unique|duplicate/i.test(dup), dup);
  const badFmt = await throws(() => db.query(`insert into public.test_protocols (key,name,set_json)
    values ('bad-fmt','x','{"fmt":"nope","blocks":[]}'::jsonb)`));
  ok('set_json must be swimzone.set/1', !!badFmt);
  const badMeasure = await throws(() => db.query(`insert into public.test_protocols (key,name,set_json,measures)
    values ('bad-m','x',$1::jsonb,array['time','vo2'])`, [clubSet]));
  ok('unknown measure rejected', !!badMeasure);

  console.log('\nVisibility (RLS)');
  for (const [who, id] of Object.entries(U)) {
    const n = await as(id, async () => (await db.query(`select count(*)::int n from public.test_protocols where owner_org_id is null`)).rows[0].n);
    ok(`${who} sees the global library`, n === 7, `saw ${n}`);
  }

  console.log('\nEdit rights (RLS)');
  const coachIns = await throws(() => as(U.coach, () => db.query(`insert into public.test_protocols
    (key,name,owner_org_id,set_json) values ('c-private',$1,$2,$3::jsonb)`, ['C private', O.C, clubSet])));
  ok('club coach can add a club protocol', coachIns === null, coachIns);
  const swimIns = await throws(() => as(U.swim, () => db.query(`insert into public.test_protocols
    (key,name,owner_org_id,set_json) values ('s-try',$1,$2,$3::jsonb)`, ['x', O.C, clubSet])));
  ok('athlete cannot add to the club library', !!swimIns);
  const coachGlobal = await throws(() => as(U.coach, () => db.query(`insert into public.test_protocols
    (key,name,set_json) values ('c-global','x',$1::jsonb)`, [clubSet])));
  ok('club coach cannot add to the global library', !!coachGlobal);
  const rootGlobal = await throws(() => as(U.root, () => db.query(`insert into public.test_protocols
    (key,name,set_json) values ('root-new','Root test',$1::jsonb)`, [clubSet])));
  ok('root can add to the global library', rootGlobal === null, rootGlobal);
  const otherEdit = await as(U.other, async () => (await db.query(
    `update public.test_protocols set name='hack' where key='c-private' returning id`)).rows.length);
  ok("another club's athlete cannot edit it", otherEdit === 0);

  console.log('\nClub protocol visibility down the tree');
  const seesC = async (id) => as(id, async () =>
    (await db.query(`select count(*)::int n from public.test_protocols where key='c-private'`)).rows[0].n);
  ok('coach of C sees it', (await seesC(U.coach)) === 1);
  ok('athlete in squad S (below C) sees it', (await seesC(U.swim)) === 1);
  ok('root (above C) sees it', (await seesC(U.root)) === 1);
  ok('athlete in club D does NOT see it', (await seesC(U.other)) === 0);

  console.log('\nLock on first use');
  const step = (await db.query(`select id, locked from public.test_protocols where key='step-7x200'`)).rows[0];
  ok('seed starts unlocked (drafts can be fixed)', step.locked === false);
  const editDraft = await throws(() => as(U.root, () => db.query(
    `update public.test_protocols set params = params where key='step-7x200'`)));
  ok('root can edit an unlocked global protocol', editDraft === null, editDraft);

  const effortId = await as(U.swim, async () => (await db.query(`insert into public.set_efforts
    (athlete_user_id, swum_on, protocol_id, set_json, conditions, client_uuid)
    values ($1,'2026-09-29',$2,
      (select set_json from public.test_protocols where id=$2),
      '{"params":{"sendOff":"5:00"}}', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') returning id`,
    [U.swim, step.id])).rows[0].id);
  ok('athlete can save a run of a global protocol', !!effortId);
  const nowLocked = (await db.query(`select locked from public.test_protocols where id=$1`, [step.id])).rows[0].locked;
  ok('protocol locked after first use', nowLocked === true);
  const changeLocked = await throws(() => db.query(
    `update public.test_protocols set set_json = jsonb_set(set_json,'{name}','"x"') where id=$1`, [step.id]));
  ok('locked protocol refuses a definition change', changeLocked && /LOCKED/.test(changeLocked), changeLocked);
  const unlock = await throws(() => db.query(`update public.test_protocols set locked=false where id=$1`, [step.id]));
  ok('locked protocol cannot be unlocked', unlock && /LOCKED/.test(unlock), unlock);
  const rename = await throws(() => db.query(`update public.test_protocols set name='7×200 Step (renamed)' where id=$1`, [step.id]));
  ok('renaming a locked protocol is allowed', rename === null, rename);
  const delLocked = await throws(() => db.query(`delete from public.test_protocols where id=$1`, [step.id]));
  ok('a used protocol cannot be deleted (FK restrict)', !!delLocked);
  const v2 = await throws(() => db.query(`insert into public.test_protocols (key,version,name,set_json,measures,params,analyser)
    select key, 2, name, set_json, measures, '{}'::jsonb, analyser from public.test_protocols where id=$1`, [step.id]));
  ok('a new version of the same key can be created', v2 === null, v2);
  const badFk = await throws(() => db.query(`insert into public.set_efforts (athlete_user_id, swum_on, protocol_id, set_json)
    values ($1,'2026-09-29','dddddddd-dddd-4ddd-8ddd-dddddddddddd','{}')`, [U.swim]));
  ok('set_effort with an unknown protocol_id rejected', !!badFk);

  console.log('\nPer-rep metrics + flat view');
  await as(U.swim, async () => {
    for (let i = 1; i <= 3; i++) {
      await db.query(`insert into public.performance_results
        (athlete_user_id, swum_on, kind, stroke, dist_m, pool_type, time_sec, source, effort, effort_id, rep_no, metrics)
        values ($1,'2026-09-29','training','FS',200,'25SC',$2,'stopwatch','submaximal',$3,$4,$5::jsonb)`,
        [U.swim, 160 - i * 4, effortId, i, JSON.stringify({ hr: 140 + i * 10, lactate: 1.5 * i, sr: 30 + i })]);
    }
  });
  const badMetrics = await throws(() => db.query(`insert into public.performance_results
    (athlete_user_id, swum_on, kind, stroke, dist_m, pool_type, time_sec, source, metrics)
    values ($1,'2026-09-29','training','FS',50,'25SC',30,'manual','[1,2]'::jsonb)`, [U.swim]));
  ok('metrics must be a JSON object', !!badMetrics);
  const mine = await as(U.swim, async () => (await db.query(
    `select rep_no, time_sec::float t, hr::float hr, lactate::float la, sr::float sr, protocol_key, protocol_version
       from public.v_set_rep_metrics where effort_id=$1 order by rep_no`, [effortId])).rows);
  ok('view returns 3 reps for the athlete', mine.length === 3, JSON.stringify(mine));
  ok('metrics flatten to columns (rep 3: hr 170, lactate 4.5)', mine[2]?.hr === 170 && mine[2]?.la === 4.5, JSON.stringify(mine[2]));
  ok('view carries protocol key + version', mine[0]?.protocol_key === 'step-7x200' && mine[0]?.protocol_version === 1);
  const theirs = await as(U.other, async () => (await db.query(
    `select count(*)::int n from public.v_set_rep_metrics where effort_id=$1`, [effortId])).rows[0].n);
  ok("view respects RLS (another club's athlete sees 0)", theirs === 0, `saw ${theirs}`);
  const pbLeak = (await db.query(`select count(*)::int n from public.performance_results
    where athlete_user_id=$1 and effort_id is null and effort='maximal'`, [U.swim])).rows[0].n;
  ok('test reps still never count as maximal single swims', pbLeak === 0);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
