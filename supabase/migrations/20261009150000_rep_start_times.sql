-- 20261009150000_rep_start_times.sql
-- Keep when each rep STARTED, so rest is measured, not estimated.
--
-- Poolside records a start (the "go" press) and a finish for every rep and has
-- always exported startedAt, but it was dropped on save — so the app could only
-- estimate rest as send-off − swim time. With the start kept:
--   rest after rep n = start of rep n+1 − (start of rep n + time of rep n)
-- and there is, correctly, no rest after the last rep.
--
-- Runs already saved have no start times. Re-importing their Poolside file fills
-- them in (fill_rep_start_times): only empty start times are set, only on that
-- run's reps, and only by someone who may ADD to the swimmer's log (the same
-- right that saved the run) — nothing else about a swim is ever changed.

begin;

alter table public.performance_results
  add column if not exists started_at timestamptz;

comment on column public.performance_results.started_at is
  'When the rep started (Poolside "go"). Set reps only. Rest after a rep = next rep started_at − (started_at + time_sec).';

create or replace function public.fill_rep_start_times(p_client_uuid uuid, p_starts jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_eff record;
  v_n int;
begin
  select id, athlete_user_id into v_eff from set_efforts where client_uuid = p_client_uuid;
  if not found then
    return 0;
  end if;
  if not (v_eff.athlete_user_id = auth.uid() or has_log_access(v_eff.athlete_user_id, 'add')) then
    raise exception 'NOT ALLOWED: you can''t add to this swimmer''s log';
  end if;
  update performance_results pr
     set started_at = (x ->> 'startedAt')::timestamptz
    from jsonb_array_elements(coalesce(p_starts, '[]'::jsonb)) as x
   where pr.effort_id = v_eff.id
     and pr.rep_no = (x ->> 'repNo')::int
     and pr.started_at is null
     and nullif(x ->> 'startedAt', '') is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.fill_rep_start_times(uuid, jsonb) from public;
grant execute on function public.fill_rep_start_times(uuid, jsonb) to authenticated;

commit;
