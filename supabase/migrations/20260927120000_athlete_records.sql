-- 20260927120000_athlete_records.sql
-- Athlete Records — Part A: append-only evidence store.
--
-- Extends performance_results (from 20260923120000_user_accounts.sql) and adds
-- the set_efforts parent table. Reps of a set-as-swum live in
-- performance_results with effort_id = set_efforts.id.
--
-- Depends on: public.has_log_access(owner, mode) and the users table from the
-- accounts migration. Apply the accounts migrations first.
--
-- New SQL only — this does not edit any applied migration (accounts rule 3).

begin;

-- ---------------------------------------------------------------------------
-- 1. set_efforts — one row per "set as swum". The generic set snapshot plus the
--    conditions it was swum under. Its reps are performance_results rows.
-- ---------------------------------------------------------------------------
create table if not exists public.set_efforts (
  id              uuid primary key default gen_random_uuid(),
  athlete_user_id uuid not null references public.users(id) on delete cascade,
  swum_on         date not null,
  protocol_id     uuid,                       -- reserved: future test_protocols library (no FK yet)
  set_json        jsonb not null,             -- swimzone.set/1 snapshot (generic — no per-athlete times)
  conditions      jsonb not null default '{}'::jsonb,   -- { rpe, location, poolType }
  client_uuid     uuid unique,                -- idempotent sync / dedup key (Poolside outbox)
  source          text not null default 'stopwatch'
                    check (source in ('manual','stopwatch','import')),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);

comment on column public.set_efforts.protocol_id is
  'Reserved for the future test_protocols library. NULL = ad-hoc training set.';

create index if not exists set_efforts_athlete_idx
  on public.set_efforts (athlete_user_id, swum_on);
create index if not exists set_efforts_protocol_idx
  on public.set_efforts (protocol_id) where protocol_id is not null;

-- ---------------------------------------------------------------------------
-- 2. performance_results additions.
--    (Adding a NOT NULL column with a default backfills existing rows safely.)
-- ---------------------------------------------------------------------------
alter table public.performance_results
  add column if not exists client_uuid    uuid,
  add column if not exists effort         text not null default 'unknown'
                             check (effort in ('maximal','submaximal','unknown')),
  add column if not exists effort_id      uuid references public.set_efforts(id) on delete cascade,
  add column if not exists rep_no         int,
  add column if not exists pb_at_swim_sec numeric,
  add column if not exists sanctioned     boolean,
  add column if not exists awarding_body  text,
  add column if not exists country        text,
  add column if not exists meet_name      text,
  add column if not exists import_ref     text;

comment on column public.performance_results.effort is
  'maximal | submaximal | unknown. PB/CS queries use maximal single swims only '
  '(effort=''maximal'' AND effort_id IS NULL). Set reps default to submaximal.';

-- Backfill: existing races/time-trials are maximal efforts. Without this they
-- default to 'unknown' and vanish from PB/CS queries (which require 'maximal').
-- All pre-existing rows are single swims (effort_id is null), so this is safe.
update public.performance_results
   set effort = 'maximal'
 where effort = 'unknown'
   and kind in ('meet', 'time_trial');

-- ---------------------------------------------------------------------------
-- 3. Idempotent sync: one row per client_uuid. NOT a partial index — Postgres
--    already treats NULLs as distinct, so legacy rows (client_uuid IS NULL) are
--    unconstrained, AND a non-partial unique index can serve as an ON CONFLICT
--    (client_uuid) arbiter without repeating a predicate. The Poolside flush
--    relies on that: `insert … on conflict (client_uuid) do nothing`.
-- ---------------------------------------------------------------------------
create unique index if not exists performance_results_client_uuid_key
  on public.performance_results (client_uuid);

-- ---------------------------------------------------------------------------
-- 4. Competition-import dedup: one row per (athlete, event, date, meet).
--    Partial to source='import' so manual/stopwatch entries are NEVER blocked,
--    and a faster race on a different date or meet still appends (append-only).
--    NOTE: if pre-existing import rows already duplicate on this key, creating
--    this index will fail — dedupe those rows first, then re-run.
-- ---------------------------------------------------------------------------
create unique index if not exists performance_results_import_dedup
  on public.performance_results
     (athlete_user_id, stroke, dist_m, swum_on, coalesce(meet_name, ''))
  where source = 'import';

-- ---------------------------------------------------------------------------
-- 5. RLS on set_efforts — mirrors performance_results: the owner, or a log-access
--    grantee. Reps are already covered by performance_results' own policies.
--    All predicates call the SECURITY DEFINER helper (no subqueries on RLS
--    tables — accounts rule 4).
-- ---------------------------------------------------------------------------
alter table public.set_efforts enable row level security;

drop policy if exists sz_set_efforts_read   on public.set_efforts;
drop policy if exists sz_set_efforts_insert on public.set_efforts;
drop policy if exists sz_set_efforts_update on public.set_efforts;
drop policy if exists sz_set_efforts_delete on public.set_efforts;

create policy sz_set_efforts_read on public.set_efforts
  for select using (
    athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'read')
  );

create policy sz_set_efforts_insert on public.set_efforts
  for insert with check (
    athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'add')
  );

create policy sz_set_efforts_update on public.set_efforts
  for update using (
    athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'edit')
  );

create policy sz_set_efforts_delete on public.set_efforts
  for delete using (
    athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'edit')
  );

commit;

-- ---------------------------------------------------------------------------
-- Deliberately NOT enforced here (kept as a service rule, in the "don't nanny"
-- spirit): immutability of a swim's time_sec. Improvement lives in new rows;
-- updateResult() only touches notes/flags. Add a trigger later only if a client
-- proves it's needed.
-- ---------------------------------------------------------------------------
