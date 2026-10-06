-- 20261006120000_athlete_profiles.sql
-- Per-athlete coaching profile: the coach's judgements about an athlete that
-- are NOT swims — athlete type (sprint / all-round / endurance, suggested by the
-- doubling/drop-off test, agreed or overridden by the coach) and maturation
-- (PHV status). Plus the identity details Athlete Setup captures (SE number,
-- club).
--
-- Why a table: these used to live only in the local `swimzone-athlete` slot,
-- which is overwritten whenever another athlete is loaded and never follows the
-- athlete to another coach or device. One row per athlete fixes both.
--
-- `derived_profile` is a snapshot of what the app suggested at the time the
-- coach decided — kept so "coach overrode a sprint suggestion" stays visible.
-- The live suggestion is always recomputed from times for display.
--
-- Depends on: public.users and public.has_log_access(owner, mode) from the
-- accounts migration. New SQL only — no applied migration is edited.

begin;

create table if not exists public.athlete_profiles (
  athlete_user_id uuid primary key references public.users(id) on delete cascade,
  athlete_type    text check (athlete_type in ('sprint','allround','endurance')),
  phv_status      text check (phv_status in ('pre','developing','post')),
  derived_profile jsonb,
  se_number       text,
  club            text,
  updated_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

comment on column public.athlete_profiles.athlete_type is
  'Coach decision (agree/override of derived_profile). NULL = not yet decided.';
comment on column public.athlete_profiles.derived_profile is
  'Snapshot of deriveAthleteType() output when the coach last saved.';

-- keep updated_at / updated_by honest on every edit
create or replace function public.sz_athlete_profiles_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

drop trigger if exists sz_athlete_profiles_touch on public.athlete_profiles;
create trigger sz_athlete_profiles_touch
  before update on public.athlete_profiles
  for each row execute function public.sz_athlete_profiles_touch();

-- RLS mirrors set_efforts / performance_results: the athlete themself, or a
-- log-access grantee. Coaching judgements are edits, so writing needs 'edit'.
-- Predicates call the SECURITY DEFINER helper only (no subqueries on RLS tables).
alter table public.athlete_profiles enable row level security;

drop policy if exists sz_athlete_profiles_read   on public.athlete_profiles;
drop policy if exists sz_athlete_profiles_insert on public.athlete_profiles;
drop policy if exists sz_athlete_profiles_update on public.athlete_profiles;
drop policy if exists sz_athlete_profiles_delete on public.athlete_profiles;

create policy sz_athlete_profiles_read on public.athlete_profiles
  for select using (
    athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'read')
  );

create policy sz_athlete_profiles_insert on public.athlete_profiles
  for insert with check (
    athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'edit')
  );

create policy sz_athlete_profiles_update on public.athlete_profiles
  for update
  using      (athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'edit'))
  with check (athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'edit'));

create policy sz_athlete_profiles_delete on public.athlete_profiles
  for delete using (
    athlete_user_id = auth.uid() or public.has_log_access(athlete_user_id, 'edit')
  );

commit;
