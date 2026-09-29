-- 20260929120000_test_protocols.sql
-- Test Set Library — Piece 1 (see TEST-PROTOCOLS-CONTEXT.md).
--
-- Adds:
--   test_protocols            the library: a named, versioned swimzone.set/1 plus
--                             what each rep measures and which knobs a coach may
--                             set per run (params). Global (owner_org_id null,
--                             root-curated) or club-private (visible to the club
--                             and every group below it in the grant tree).
--   set_efforts.protocol_id   now a real FK (was reserved, no table).
--   set_efforts.summary       the analyser's headline numbers for one run
--                             (what the trend charts read). Derived — recomputable
--                             from the reps at any time.
--   performance_results.metrics   per-rep measurements beyond time:
--                             { sc, sr, hr, rpe, lactate } — only what the
--                             protocol/line declares. Time stays first-class.
--   v_set_rep_metrics         flat, tabulatable view of every set rep with its
--                             metrics as columns (security_invoker → RLS applies).
--
-- Versioning: a protocol version is editable until the first set_effort uses
-- it; from then on it is LOCKED (trigger) and changes mean a new version with the
-- same key. Comparison is exact within (key, version).
--
-- Depends on: accounts (users, organisations, memberships, admin_grants and the
-- grant helpers), 20260924140000_rls_no_recursion (is_member_of, is_org_staff),
-- 20260927120000_athlete_records (set_efforts, performance_results additions).
--
-- NOTE: adding the FK fails if any existing set_efforts.protocol_id is non-null
-- and points nowhere. The column was reserved and unused, so it should be empty:
--   select count(*) from set_efforts where protocol_id is not null;   -- expect 0

begin;

-- ---------------------------------------------------------------------------
-- 1. The library
-- ---------------------------------------------------------------------------
create table if not exists public.test_protocols (
  id            uuid primary key default gen_random_uuid(),
  key           text not null check (key ~ '^[a-z0-9][a-z0-9-]{1,62}$'),  -- stable across versions, e.g. 'step-7x200'
  version       int  not null default 1 check (version >= 1),
  name          text not null,
  description   text,
  owner_org_id  uuid references public.organisations(id) on delete cascade,  -- null = global library (root)
  set_json      jsonb not null
                  check (set_json->>'fmt' = 'swimzone.set/1' and jsonb_typeof(set_json->'blocks') = 'array'),
  measures      text[] not null default array['time']::text[]
                  check (measures <@ array['time','splits','sc','sr','hr','rpe','lactate']::text[]),
  params        jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  analyser      text not null default 'series',   -- code-side analyser id; see protocolFormat.js
  locked        boolean not null default false,   -- set automatically on first use
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint test_protocols_owner_key_version_uq unique nulls not distinct (owner_org_id, key, version)
);

comment on table public.test_protocols is
  'Test Set Library. A protocol version is immutable once locked (first use). '
  'owner_org_id NULL = global library curated by root.';
comment on column public.test_protocols.params is
  'Per-run knobs, e.g. {"sendOff":{"label":"Send-off","kind":"onTime","default":"5:00","options":["4:30","5:00"]}}. '
  'Lines opt in with interval.param = "<name>".';

create index if not exists test_protocols_owner_idx on public.test_protocols (owner_org_id);
create index if not exists test_protocols_key_idx   on public.test_protocols (key, version);

-- ---------------------------------------------------------------------------
-- 2. Immutability once locked
-- ---------------------------------------------------------------------------
create or replace function public.guard_locked_protocol() returns trigger
language plpgsql as $$
begin
  if old.locked then
    if not new.locked then
      raise exception 'LOCKED: a used protocol cannot be unlocked';
    end if;
    if new.key          is distinct from old.key
    or new.version      is distinct from old.version
    or new.owner_org_id is distinct from old.owner_org_id
    or new.set_json     is distinct from old.set_json
    or new.measures     is distinct from old.measures
    or new.params       is distinct from old.params
    or new.analyser     is distinct from old.analyser then
      raise exception 'LOCKED: protocol % v% has results against it — create version % instead',
        old.key, old.version, old.version + 1;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_locked_protocol on public.test_protocols;
create trigger trg_guard_locked_protocol before update on public.test_protocols
  for each row execute function public.guard_locked_protocol();

-- ---------------------------------------------------------------------------
-- 3. set_efforts → test_protocols; lock a protocol the first time it is swum.
--    SECURITY DEFINER: the person saving a result (athlete/guardian) usually
--    can't edit the protocol itself, but using it must still lock it.
-- ---------------------------------------------------------------------------
alter table public.set_efforts drop constraint if exists set_efforts_protocol_fk;
alter table public.set_efforts
  add constraint set_efforts_protocol_fk
  foreign key (protocol_id) references public.test_protocols(id) on delete restrict;

alter table public.set_efforts
  add column if not exists summary jsonb;   -- analyser output: { analyser, v, ...headline numbers }

comment on column public.set_efforts.summary is
  'Derived headline numbers for this run, written by the protocol''s analyser on save. '
  'Recomputable from the reps; never the source of truth.';

create or replace function public.lock_protocol_on_use() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.protocol_id is not null then
    update test_protocols set locked = true where id = new.protocol_id and not locked;
  end if;
  return new;
end $$;

drop trigger if exists trg_lock_protocol_on_use on public.set_efforts;
create trigger trg_lock_protocol_on_use after insert or update of protocol_id on public.set_efforts
  for each row execute function public.lock_protocol_on_use();

-- ---------------------------------------------------------------------------
-- 4. Per-rep metrics (beyond time)
-- ---------------------------------------------------------------------------
alter table public.performance_results
  add column if not exists metrics jsonb not null default '{}'::jsonb;

alter table public.performance_results drop constraint if exists performance_results_metrics_object;
alter table public.performance_results
  add constraint performance_results_metrics_object check (jsonb_typeof(metrics) = 'object');

comment on column public.performance_results.metrics is
  'Per-rep measurements beyond time_sec: { sc, sr, hr, rpe, lactate } (numbers). '
  'Only what the protocol/line declares in measures.';

-- ---------------------------------------------------------------------------
-- 5. Flat view — one row per set rep, metrics as columns. security_invoker so
--    the caller's RLS on performance_results / set_efforts still applies.
-- ---------------------------------------------------------------------------
create or replace function public.jsonb_num(j jsonb, k text) returns numeric
language sql immutable as $$
  select case when jsonb_typeof(j->k) = 'number' then (j->>k)::numeric end;
$$;

create or replace view public.v_set_rep_metrics with (security_invoker = true) as
select pr.id,
       pr.athlete_user_id,
       pr.effort_id,
       se.protocol_id,
       tp.key      as protocol_key,
       tp.version  as protocol_version,
       se.swum_on,
       pr.rep_no,
       pr.stroke,
       pr.dist_m,
       pr.pool_type,
       pr.time_sec,
       pr.pb_at_swim_sec,
       public.jsonb_num(pr.metrics, 'sc')      as sc,
       public.jsonb_num(pr.metrics, 'sr')      as sr,
       public.jsonb_num(pr.metrics, 'hr')      as hr,
       public.jsonb_num(pr.metrics, 'rpe')     as rpe,
       public.jsonb_num(pr.metrics, 'lactate') as lactate
  from public.performance_results pr
  join public.set_efforts se on se.id = pr.effort_id
  left join public.test_protocols tp on tp.id = se.protocol_id;

-- ---------------------------------------------------------------------------
-- 6. Visibility / edit rights via the grant tree (SECURITY DEFINER helpers —
--    no subqueries on RLS tables inside policies).
--
--    See:  global (null) → everyone signed in.
--          club X        → members of X, members of any group BELOW X,
--                          and anyone who manages X from above.
--    Edit: global        → root only.
--          club X        → X's active admins/coaches/managers, or managers above.
-- ---------------------------------------------------------------------------
create or replace function public.can_see_protocol_org(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select p_org is null
      or public.can_manage_group(p_org, p_user)
      or exists (
           select 1 from memberships m
            where m.user_id = p_user and m.status = 'active'
              and (m.org_id = p_org
                   or exists (select 1 from public.grant_ancestors(public.org_grant(m.org_id)) a
                               where a.org_id = p_org)));
$$;

create or replace function public.can_edit_protocol_org(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_org is null then public.is_root(p_user)
              else public.is_org_staff(p_org, p_user) or public.can_manage_group(p_org, p_user) end;
$$;

alter table public.test_protocols enable row level security;

drop policy if exists sz_protocols_read   on public.test_protocols;
drop policy if exists sz_protocols_insert on public.test_protocols;
drop policy if exists sz_protocols_update on public.test_protocols;
drop policy if exists sz_protocols_delete on public.test_protocols;

create policy sz_protocols_read on public.test_protocols for select to authenticated
  using (public.can_see_protocol_org(owner_org_id));

create policy sz_protocols_insert on public.test_protocols for insert to authenticated
  with check (public.can_edit_protocol_org(owner_org_id) and not locked);

create policy sz_protocols_update on public.test_protocols for update to authenticated
  using      (public.can_edit_protocol_org(owner_org_id))
  with check (public.can_edit_protocol_org(owner_org_id));

create policy sz_protocols_delete on public.test_protocols for delete to authenticated
  using (public.can_edit_protocol_org(owner_org_id) and not locked);

grant select on public.v_set_rep_metrics to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Seed the global library. Unlocked until first used, so a DRAFT can still
--    be corrected in place. Re-running is a no-op (unique owner/key/version).
-- ---------------------------------------------------------------------------
insert into public.test_protocols (key, version, name, description, set_json, measures, params, analyser)
values
-- 7×200 step test ------------------------------------------------------------
('step-7x200', 1, '7×200 Step Test',
 'Seven 200s, each faster than the last, on a fixed send-off. Last rep all out. '
 'Record HR (and lactate if taken) after every rep.',
 $j${"fmt":"swimzone.set/1","name":"7×200 Step Test","poolType":"25SC","note":"","blocks":[{"repeats":1,"lines":[
  {"type":"swim","stroke":"FS","distM":200,"qty":1,"targetRule":{"base":"PB","plusFrom":30,"plusTo":30},"interval":{"type":"fixed","onTime":"5:00","param":"sendOff"},"intensity":"A1","note":"step 1"},
  {"type":"swim","stroke":"FS","distM":200,"qty":1,"targetRule":{"base":"PB","plusFrom":25,"plusTo":25},"interval":{"type":"fixed","onTime":"5:00","param":"sendOff"},"intensity":"A2","note":"step 2"},
  {"type":"swim","stroke":"FS","distM":200,"qty":1,"targetRule":{"base":"PB","plusFrom":20,"plusTo":20},"interval":{"type":"fixed","onTime":"5:00","param":"sendOff"},"intensity":"A3","note":"step 3"},
  {"type":"swim","stroke":"FS","distM":200,"qty":1,"targetRule":{"base":"PB","plusFrom":15,"plusTo":15},"interval":{"type":"fixed","onTime":"5:00","param":"sendOff"},"intensity":"AT","note":"step 4"},
  {"type":"swim","stroke":"FS","distM":200,"qty":1,"targetRule":{"base":"PB","plusFrom":10,"plusTo":10},"interval":{"type":"fixed","onTime":"5:00","param":"sendOff"},"intensity":"AT","note":"step 5"},
  {"type":"swim","stroke":"FS","distM":200,"qty":1,"targetRule":{"base":"PB","plusFrom":5,"plusTo":5},"interval":{"type":"fixed","onTime":"5:00","param":"sendOff"},"intensity":"LT","note":"step 6"},
  {"type":"swim","stroke":"FS","distM":200,"qty":1,"targetRule":{"base":"PB","plusFrom":0,"plusTo":0},"interval":{"type":"fixed","onTime":"5:00","param":"sendOff"},"intensity":"HVO","note":"step 7 — all out"}
 ]}]}$j$::jsonb,
 array['time','hr','lactate','sr'],
 $j${"sendOff":{"label":"Send-off","kind":"onTime","default":"5:00","options":["4:30","5:00","5:30","6:00"]}}$j$::jsonb,
 'step'),

-- CSS 400 + 200 --------------------------------------------------------------
('css-400-200', 1, 'CSS 400 + 200',
 'Maximal 400, full recovery, maximal 200. CSS = 200 / (T400 − T200) m/s.',
 $j${"fmt":"swimzone.set/1","name":"CSS 400 + 200","poolType":"25SC","note":"","blocks":[{"repeats":1,"lines":[
  {"type":"swim","stroke":"FS","distM":400,"qty":1,"targetRule":{"base":"PB","plusFrom":0,"plusTo":0},"interval":{"type":"rest","restSec":600,"param":"recovery"},"intensity":"HVO","note":"all out"},
  {"type":"swim","stroke":"FS","distM":200,"qty":1,"targetRule":{"base":"PB","plusFrom":0,"plusTo":0},"interval":{"type":"rest","restSec":0},"intensity":"HVO","note":"all out"}
 ]}]}$j$::jsonb,
 array['time','splits','sr','sc'],
 $j${"recovery":{"label":"Recovery","kind":"restSec","default":600,"options":[300,600,900]}}$j$::jsonb,
 'css'),

-- Double-distance 400 (DRAFT — target rule to confirm) -----------------------
('double-distance-400', 1, 'Double-Distance 400',
 'DRAFT — target rule to confirm with coaches before first use. A 400 swum against '
 'a target derived from the 200 PB; the fade between halves is the result.',
 $j${"fmt":"swimzone.set/1","name":"Double-Distance 400","poolType":"25SC","note":"DRAFT: target rule TBC","blocks":[{"repeats":1,"lines":[
  {"type":"swim","stroke":"FS","distM":400,"qty":1,"targetRule":{"base":"absolute","inTime":""},"interval":{"type":"rest","restSec":0},"intensity":"AT","note":"target TBC"}
 ]}]}$j$::jsonb,
 array['time','splits','hr','rpe'],
 '{}'::jsonb,
 'double-distance'),

-- 20×100 turnaround (10 + 1 + 10) --------------------------------------------
('turn-20x100', 1, '20×100 (10 AT · 200 BK · 10 AT)',
 '10×100 FS AT, 1×200 BK A2 recovery, 10×100 FS AT. Compares set 1 against set 2.',
 $j${"fmt":"swimzone.set/1","name":"20×100 turnaround","poolType":"25SC","note":"","blocks":[{"repeats":1,"lines":[
  {"type":"swim","stroke":"FS","distM":100,"qty":10,"targetRule":{"base":"AT"},"interval":{"type":"fixed","onTime":"1:30","param":"sendOff"},"intensity":"AT","measures":["time","sc"],"note":"set 1"},
  {"type":"swim","stroke":"BK","distM":200,"qty":1,"targetRule":{"base":"A2"},"interval":{"type":"fixed","onTime":"4:00"},"intensity":"A2","measures":[],"note":"recovery"},
  {"type":"swim","stroke":"FS","distM":100,"qty":10,"targetRule":{"base":"AT"},"interval":{"type":"fixed","onTime":"1:30","param":"sendOff"},"intensity":"AT","measures":["time","sc"],"note":"set 2"}
 ]}]}$j$::jsonb,
 array['time','sc','hr','rpe'],
 $j${"sendOff":{"label":"100 send-off","kind":"onTime","default":"1:30","options":["1:20","1:25","1:30","1:35","1:40"]}}$j$::jsonb,
 'blocks'),

-- 8×50 efficiency -----------------------------------------------------------
('eff-8x50', 1, '8×50 Efficiency',
 'Eight 50s at controlled pace; count strokes. Result is SWOLF (time + strokes) per rep.',
 $j${"fmt":"swimzone.set/1","name":"8×50 Efficiency","poolType":"25SC","note":"","blocks":[{"repeats":1,"lines":[
  {"type":"swim","stroke":"FS","distM":50,"qty":8,"targetRule":{"base":"A3"},"interval":{"type":"fixed","onTime":"1:00","param":"sendOff"},"intensity":"A3","note":"hold form, count strokes"}
 ]}]}$j$::jsonb,
 array['time','sc'],
 $j${"sendOff":{"label":"Send-off","kind":"onTime","default":"1:00","options":["0:50","1:00","1:10"]}}$j$::jsonb,
 'swolf'),

-- Max HR (DRAFT — protocol to confirm) --------------------------------------
('max-hr', 1, 'Max Heart Rate',
 'DRAFT — protocol to confirm before first use. 4×100 build on short rest, last one all out; '
 'the result is the peak HR.',
 $j${"fmt":"swimzone.set/1","name":"Max Heart Rate","poolType":"25SC","note":"DRAFT: protocol TBC","blocks":[{"repeats":1,"lines":[
  {"type":"swim","stroke":"FS","distM":100,"qty":3,"targetRule":{"base":"A3"},"interval":{"type":"rest","restSec":10},"intensity":"A3","note":"build"},
  {"type":"swim","stroke":"FS","distM":100,"qty":1,"targetRule":{"base":"PB","plusFrom":0,"plusTo":0},"interval":{"type":"rest","restSec":0},"intensity":"HVO","note":"all out"}
 ]}]}$j$::jsonb,
 array['hr','time'],
 '{}'::jsonb,
 'maxhr'),

-- 10×400 ------------------------------------------------------------------
('t10x400', 1, '10×400',
 'Ten 400s, best average, short rest. Mean, spread and drift across the series.',
 $j${"fmt":"swimzone.set/1","name":"10×400","poolType":"25SC","note":"","blocks":[{"repeats":1,"lines":[
  {"type":"swim","stroke":"FS","distM":400,"qty":10,"targetRule":{"base":"bestAverage"},"interval":{"type":"rest","restSec":30,"param":"rest"},"intensity":"AT","note":""}
 ]}]}$j$::jsonb,
 array['time','hr','rpe'],
 $j${"rest":{"label":"Rest","kind":"restSec","default":30,"options":[20,30,45,60]}}$j$::jsonb,
 'series')
on conflict do nothing;

commit;
