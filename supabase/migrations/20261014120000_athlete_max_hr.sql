-- 20261014120000_athlete_max_hr.sql
-- The athlete's max heart rate on their profile: the base for every HR zone band
-- (beats below max, contracts/ZONES.md). Set by the coach — typed in, or taken
-- from a Max HR test result. When it is empty the app falls back to the latest
-- Max HR test, then 220 − age (from users.date_of_birth), then no HR zones
-- (src/athlete/maxHr.js).
--
-- Adds columns to athlete_profiles only; its RLS (has_log_access) already covers
-- them. New SQL only — no applied migration is edited. Safe to run twice.

begin;

alter table public.athlete_profiles
  add column if not exists max_hr        smallint,
  add column if not exists max_hr_source text,
  add column if not exists max_hr_on     date;

alter table public.athlete_profiles drop constraint if exists athlete_profiles_max_hr_range;
alter table public.athlete_profiles add constraint athlete_profiles_max_hr_range
  check (max_hr is null or max_hr between 120 and 240);

alter table public.athlete_profiles drop constraint if exists athlete_profiles_max_hr_source;
alter table public.athlete_profiles add constraint athlete_profiles_max_hr_source
  check (max_hr_source is null or max_hr_source in ('typed', 'test'));

comment on column public.athlete_profiles.max_hr is
  'Max heart rate (bpm) chosen by the coach. NULL = use the latest Max HR test, else 220 − age.';
comment on column public.athlete_profiles.max_hr_source is
  'How max_hr was set: typed (coach entered it) or test (taken from a Max HR test result).';
comment on column public.athlete_profiles.max_hr_on is
  'Date max_hr was measured/entered.';

commit;
