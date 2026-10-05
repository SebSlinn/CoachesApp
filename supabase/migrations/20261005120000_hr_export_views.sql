-- 20261005120000_hr_export_views.sql
-- Getting results OUT: flat, spreadsheet-shaped views over what Poolside saves.
--
--   v_set_rep_metrics   (existing) one row per test/set rep — now also carries the
--                       live heart-rate figures (appended columns; existing ones
--                       unchanged, so anything already using the view still works).
--   v_swim_metrics      one row per swim of ANY kind (race, time trial, training
--                       swim, set rep) with every per-rep metric as a column.
--   v_length_metrics    one row per LENGTH of every swim that has splits: lap time,
--                       stroke count, stroke rate, HR1 (first reading in the
--                       length), HR2 (last reading). Understands both split shapes
--                       Poolside writes:
--                         test reps   [{dist, sec (cumulative), sc, sr, hrFirst, hrLast, hrCoverage}]
--                         single swims[{from, to, ms (lap), sc, sr, hrFirst, hrLast, hrCoverage}]
--
-- All views are security_invoker: the caller's RLS on performance_results /
-- set_efforts applies (you see exactly the swims you could read anyway).
-- No table changes — the heart-rate figures already live in
-- performance_results.metrics / .splits and set_efforts.conditions.hrStream.
-- Idempotent: safe to run again.

-- ---------------------------------------------------------------------------
-- 1. Per-rep view: existing columns, then the heart-rate ones appended.
-- ---------------------------------------------------------------------------
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
       public.jsonb_num(pr.metrics, 'sc')         as sc,
       public.jsonb_num(pr.metrics, 'sr')         as sr,
       public.jsonb_num(pr.metrics, 'hr')         as hr,
       public.jsonb_num(pr.metrics, 'rpe')        as rpe,
       public.jsonb_num(pr.metrics, 'lactate')    as lactate,
       -- appended 2026-10-05: live heart rate (Poolside + sensor)
       public.jsonb_num(pr.metrics, 'hrStart')    as hr_start,
       public.jsonb_num(pr.metrics, 'hrMin')      as hr_min,
       public.jsonb_num(pr.metrics, 'hrAvg')      as hr_avg,
       public.jsonb_num(pr.metrics, 'hrPeak')     as hr_max,
       public.jsonb_num(pr.metrics, 'hrEnd')      as hr_end,
       public.jsonb_num(pr.metrics, 'hrRec30')    as hr_rec30,
       public.jsonb_num(pr.metrics, 'hrCoverage') as hr_coverage
  from public.performance_results pr
  join public.set_efforts se on se.id = pr.effort_id
  left join public.test_protocols tp on tp.id = se.protocol_id;

grant select on public.v_set_rep_metrics to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Every swim, one row each.
-- ---------------------------------------------------------------------------
create or replace view public.v_swim_metrics with (security_invoker = true) as
select pr.id,
       pr.athlete_user_id,
       coalesce(se.swum_on, pr.swum_on)           as swum_on,
       pr.kind,
       pr.effort,
       pr.source,
       pr.effort_id,
       tp.key                                     as protocol_key,
       pr.rep_no,
       pr.stroke,
       pr.dist_m,
       pr.pool_type,
       pr.time_sec,
       pr.meet_name,
       pr.notes,
       public.jsonb_num(pr.metrics, 'sc')         as sc,
       public.jsonb_num(pr.metrics, 'sr')         as sr,
       public.jsonb_num(pr.metrics, 'rpe')        as rpe,
       public.jsonb_num(pr.metrics, 'lactate')    as lactate,
       public.jsonb_num(pr.metrics, 'hr')         as hr,
       public.jsonb_num(pr.metrics, 'hrStart')    as hr_start,
       public.jsonb_num(pr.metrics, 'hrMin')      as hr_min,
       public.jsonb_num(pr.metrics, 'hrAvg')      as hr_avg,
       public.jsonb_num(pr.metrics, 'hrPeak')     as hr_max,
       public.jsonb_num(pr.metrics, 'hrEnd')      as hr_end,
       public.jsonb_num(pr.metrics, 'hrRec30')    as hr_rec30,
       public.jsonb_num(pr.metrics, 'hrCoverage') as hr_coverage,
       pr.created_at
  from public.performance_results pr
  left join public.set_efforts se on se.id = pr.effort_id
  left join public.test_protocols tp on tp.id = se.protocol_id;

grant select on public.v_swim_metrics to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Every length of every swim with splits.
-- ---------------------------------------------------------------------------
create or replace view public.v_length_metrics with (security_invoker = true) as
with l as (
  select pr.id                                   as result_id,
         pr.athlete_user_id,
         coalesce(se.swum_on, pr.swum_on)        as swum_on,
         pr.kind,
         pr.effort_id,
         tp.key                                  as protocol_key,
         pr.rep_no,
         pr.stroke,
         pr.pool_type,
         x.n::int                                as length_no,
         x.s                                     as s
    from public.performance_results pr
    left join public.set_efforts se on se.id = pr.effort_id
    left join public.test_protocols tp on tp.id = se.protocol_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(pr.splits) = 'array' then pr.splits else '[]'::jsonb end
    ) with ordinality as x(s, n)
)
select result_id, athlete_user_id, swum_on, kind, effort_id, protocol_key, rep_no, stroke, pool_type,
       length_no,
       coalesce(public.jsonb_num(s, 'dist'), public.jsonb_num(s, 'to'))       as dist_m,
       round(coalesce(public.jsonb_num(s, 'ms') / 1000.0,
                      public.jsonb_num(s, 'sec')
                        - coalesce(lag(public.jsonb_num(s, 'sec')) over (partition by result_id order by length_no), 0)), 2)
                                                                               as lap_sec,
       public.jsonb_num(s, 'sec')                                              as cum_sec,
       public.jsonb_num(s, 'sc')                                               as sc,
       public.jsonb_num(s, 'sr')                                               as sr,
       public.jsonb_num(s, 'hrFirst')                                          as hr1,
       public.jsonb_num(s, 'hrLast')                                           as hr2,
       public.jsonb_num(s, 'hrCoverage')                                       as hr_coverage
  from l;

grant select on public.v_length_metrics to authenticated;
