// tests/db/zonescheme.roundtrip.test.mjs — the zone colour scheme follows the coach between devices:
// the REAL zoneSchemeService + SupabaseZoneSchemeRepository against PGlite (user_settings, RLS on),
// with "devices" simulated by swapping the in-memory localStorage.
//
//   node tests/db/run.mjs zonescheme.roundtrip.test.mjs

const devices = { one: new Map(), two: new Map(), shared: new Map() };
let mem = devices.one;
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear(),
};
const useDevice = (d) => { mem = devices[d]; };

import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { attach, signIn, setOffline } from './fakeSupabase.js';
import { loadZoneScheme, saveZoneScheme, syncZoneScheme } from '../../src/services/zoneSchemeService.js';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };
const MIG = 'supabase/migrations';
const db = new PGlite();
await db.exec(`
  create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon, service_role;
  grant execute on function auth.uid() to authenticated, anon, service_role;
  create table public.users (id uuid primary key, email text not null unique, full_name text, avatar_url text, created_at timestamptz default now());
  create table public.organisations (id uuid primary key default gen_random_uuid(), name text not null, org_type text not null,
     invitation_quota int not null default 0, created_by uuid, created_at timestamptz default now());
  create table public.memberships (id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id) on delete cascade,
     org_id uuid references public.organisations(id) on delete cascade,
     role text not null constraint memberships_role_check check (role = any (array['athlete','coach','manager','admin','guardian'])),
     status text not null default 'pending', created_at timestamptz default now(), unique (user_id, org_id, role));
`);
for (const f of fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(`${MIG}/${f}`, 'utf8'));
await db.exec(`grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;`);
const U = {};
for (const n of ['al', 'newcoach', 'other']) U[n] = (await db.query(`insert into users(id, email) values (gen_random_uuid(), $1) returning id`, [n + '@x.com'])).rows[0].id;
attach(db);
const account = async (who) => (await db.query(`select zone_scheme from user_settings where user_id = $1`, [U[who]])).rows[0]?.zone_scheme;
const settle = () => new Promise((r) => setTimeout(r, 50));   // save() sends in the background

console.log('\nChoose on one device, see it on another');
useDevice('one'); signIn(U.al);
saveZoneScheme('sweetenham'); await settle();
ok('saved to the account', (await account('al'))?.id === 'sweetenham', await account('al'));
useDevice('two');
ok('another device starts on the default (Urbanchek)', loadZoneScheme().data.id === 'urbanchek');
let r = await syncZoneScheme();
ok('sign in there → the account\'s colours arrive', r.changed && r.data.id === 'sweetenham', r);
ok('…and stay on that device', loadZoneScheme().data.id === 'sweetenham');
r = await syncZoneScheme();
ok('nothing to change next time', r.changed === false);
saveZoneScheme(null); await settle();
ok('back to the default is saved too', (await account('al')) == null);
useDevice('one');
r = await syncZoneScheme();
ok('…and reaches the first device', r.changed && r.data.id === 'urbanchek');

console.log('\nA choice made before this change is kept');
useDevice('shared'); signIn(null);
mem.set('swimzone-zone-scheme', JSON.stringify({ id: 'maglischo' }));   // chosen before accounts saved it
signIn(U.newcoach);
r = await syncZoneScheme();
ok('empty account takes this device\'s choice', r.changed === false && (await account('newcoach'))?.id === 'maglischo', await account('newcoach'));

console.log('\nA shared device');
signIn(U.other);
r = await syncZoneScheme();
ok('someone else signs in: they don\'t get the last person\'s colours', r.changed && r.data.id === 'urbanchek', r);
ok('…and their account isn\'t given them', (await account('other')) === undefined);
signIn(U.newcoach);
r = await syncZoneScheme();
ok('the first person signs back in: theirs come back', r.changed && r.data.id === 'maglischo');

console.log('\nNo signal');
useDevice('one'); signIn(U.al);
setOffline(true);
saveZoneScheme('maglischo'); await settle();
ok('changes on the device at once', loadZoneScheme().data.id === 'maglischo');
ok('…marked to send later', mem.get('swimzone-zone-scheme-pending') === 'true');
setOffline(false);
r = await syncZoneScheme();
ok('next sync sends it (not overwritten by the old account value)', (await account('al'))?.id === 'maglischo' && loadZoneScheme().data.id === 'maglischo', await account('al'));
ok('pending cleared', !mem.has('swimzone-zone-scheme-pending'));
signIn(null);
r = await syncZoneScheme();
ok('signed out: no error, nothing changes', r.error === null && r.changed === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
