-- 20261117120000_hr_samples.sql
-- Raw heart-rate readings for a single swim (a Poolside free session), so HR
-- can be re-analysed later — the same truth set_efforts.conditions.hrStream
-- keeps for a test run. { source, sensor, samples: [[epoch_ms, bpm], …] },
-- covering the swim plus a minute before and three after (recovery).
-- Same row, so the existing RLS on performance_results already covers it.
-- Not selected by the list queries (they name their columns), so lists stay light.
alter table public.performance_results
  add column if not exists hr_samples jsonb;

comment on column public.performance_results.hr_samples is
  'Raw HR readings for a single swim: { source, sensor, samples: [[epoch_ms, bpm], ...] } (Poolside)';
