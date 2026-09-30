-- db_status.sql — where is the database up to?  READ-ONLY. Paste into the
-- Supabase SQL editor and run. One row per check: area | check | status | detail.
-- Safe whichever migrations have or haven't been applied (missing tables are
-- reported, never queried).

select * from (
  -- ---- 20260923120000_user_accounts ----------------------------------------
  select 1 as ord, 'accounts' as area, 'admin_grants table' as "check",
         case when to_regclass('public.admin_grants') is not null then 'OK' else 'MISSING' end as status,
         null::text as detail
  union all
  select 2, 'accounts', 'has_log_access() function',
         case when exists (select 1 from pg_proc where proname = 'has_log_access') then 'OK' else 'MISSING' end, null
  union all
  select 3, 'accounts', 'root group (grant with no parent)',
         case when to_regclass('public.admin_grants') is null then 'n/a'
              when (xpath('/row/n/text()', query_to_xml(
                     'select count(*) as n from public.admin_grants where parent_grant_id is null and status = ''active''',
                     false, true, '')))[1]::text::int > 0 then 'OK' else 'MISSING' end, null

  -- ---- 20260924130000 / 20260924140000 ------------------------------------
  union all
  select 4, 'accounts', 'org_type allows root',
         case when exists (select 1 from pg_constraint where conname = 'organisations_org_type_check'
                            and pg_get_constraintdef(oid) like '%root%') then 'OK' else 'MISSING' end, null
  union all
  select 5, 'accounts', 'is_org_staff() (rls_no_recursion)',
         case when exists (select 1 from pg_proc where proname = 'is_org_staff') then 'OK' else 'MISSING' end, null

  -- ---- 20260927120000_athlete_records --------------------------------------
  union all
  select 10, 'records', 'set_efforts table',
         case when to_regclass('public.set_efforts') is not null then 'OK' else 'MISSING' end, null
  union all
  select 11, 'records', 'performance_results.client_uuid / effort / effort_id',
         case when (select count(*) from information_schema.columns
                     where table_schema = 'public' and table_name = 'performance_results'
                       and column_name in ('client_uuid','effort','effort_id')) = 3 then 'OK' else 'MISSING' end, null
  union all
  select 12, 'records', 'client_uuid unique index (dedup key)',
         case when exists (select 1 from pg_indexes where schemaname = 'public'
                            and indexname = 'performance_results_client_uuid_key') then 'OK' else 'MISSING' end, null

  -- ---- 20260928120000_drop_import_dedup ------------------------------------
  union all
  select 20, 'records', 'old import_dedup index gone',
         case when exists (select 1 from pg_indexes where schemaname = 'public'
                            and indexname = 'performance_results_import_dedup')
              then 'PRESENT — apply 20260928120000_drop_import_dedup.sql' else 'OK' end, null

  -- ---- 20260929120000_test_protocols ---------------------------------------
  union all
  select 30, 'protocols', 'test_protocols table',
         case when to_regclass('public.test_protocols') is not null then 'OK' else 'NOT APPLIED' end, null
  union all
  select 31, 'protocols', 'global library seeded',
         case when to_regclass('public.test_protocols') is null then 'n/a' else 'OK' end,
         case when to_regclass('public.test_protocols') is not null then
           (xpath('/row/k/text()', query_to_xml(
             'select string_agg(key || '' v'' || version || case when locked then '' (locked)'' else '''' end, '', '' order by key) as k
                from public.test_protocols where owner_org_id is null', false, true, '')))[1]::text end
  union all
  select 32, 'protocols', 'set_efforts.protocol_id FK',
         case when exists (select 1 from pg_constraint where conname = 'set_efforts_protocol_fk') then 'OK'
              when to_regclass('public.test_protocols') is null then 'NOT APPLIED' else 'MISSING' end, null
  union all
  select 33, 'protocols', 'performance_results.metrics + set_efforts.summary',
         case when (select count(*) from information_schema.columns where table_schema = 'public'
                     and ((table_name = 'performance_results' and column_name = 'metrics')
                       or (table_name = 'set_efforts' and column_name = 'summary'))) = 2 then 'OK'
              else 'NOT APPLIED' end, null
  union all
  select 34, 'protocols', 'v_set_rep_metrics view',
         case when to_regclass('public.v_set_rep_metrics') is not null then 'OK' else 'NOT APPLIED' end, null
  union all
  select 35, 'protocols', 'lock triggers',
         case when (select count(*) from pg_trigger
                     where tgname in ('trg_guard_locked_protocol','trg_lock_protocol_on_use')) = 2 then 'OK'
              else 'NOT APPLIED' end, null
  union all
  select 36, 'protocols', 'pre-check: set_efforts with a protocol_id (must be 0 before applying)',
         case when to_regclass('public.set_efforts') is null then 'n/a'
              when exists (select 1 from pg_constraint where conname = 'set_efforts_protocol_fk') then 'OK (FK in place)'
              when (xpath('/row/n/text()', query_to_xml(
                     'select count(*) as n from public.set_efforts where protocol_id is not null',
                     false, true, '')))[1]::text::int = 0 then 'OK — safe to apply'
              else 'BLOCKER — rows reference a protocol that does not exist yet' end, null

  -- ---- data -----------------------------------------------------------------
  union all
  select 50, 'data', 'performance_results by effort',
         'info',
         (xpath('/row/d/text()', query_to_xml(
           case when exists (select 1 from information_schema.columns where table_schema = 'public'
                              and table_name = 'performance_results' and column_name = 'effort')
                then 'select string_agg(effort || ''='' || n, '', '' order by effort) as d from
                        (select effort, count(*) as n from public.performance_results group by effort) x'
                else 'select count(*)::text || '' rows (no effort column)'' as d from public.performance_results' end,
           false, true, '')))[1]::text
  union all
  select 51, 'data', 'performance_results by source',
         'info',
         (xpath('/row/d/text()', query_to_xml(
           'select string_agg(source || ''='' || n, '', '' order by source) as d from
              (select source, count(*) as n from public.performance_results group by source) x',
           false, true, '')))[1]::text
  union all
  select 52, 'data', 'set_efforts (sets as swum)',
         'info',
         case when to_regclass('public.set_efforts') is null then 'table missing' else
           (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.set_efforts',
             false, true, '')))[1]::text || ' rows' end
  union all
  select 53, 'data', 'athletes with records',
         'info',
         (xpath('/row/n/text()', query_to_xml(
           'select count(distinct athlete_user_id) as n from public.performance_results', false, true, '')))[1]::text

  -- ---- migration history (only if the Supabase CLI was used) ----------------
  union all
  select 90, 'history', 'supabase CLI migration history',
         case when to_regclass('supabase_migrations.schema_migrations') is null
              then 'none (migrations applied by hand in the SQL editor)' else 'info' end,
         case when to_regclass('supabase_migrations.schema_migrations') is not null then
           (xpath('/row/v/text()', query_to_xml(
             'select string_agg(version, '', '' order by version) as v from supabase_migrations.schema_migrations',
             false, true, '')))[1]::text end
) s
order by ord;
