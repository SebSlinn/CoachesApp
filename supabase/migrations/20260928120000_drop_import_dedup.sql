-- 20260928120000_drop_import_dedup.sql
-- Drop the competition-import dedup index created by 20260927120000_athlete_records.sql
-- (section 4).
--
-- Why: it is a PARTIAL + EXPRESSION unique index (where source='import',
-- coalesce(meet_name,'')). Supabase upsert onConflict cannot target such an
-- index, so imports 409 with "no unique or exclusion constraint matching".
-- Dedup is done by the plain unique index on client_uuid instead, where the
-- client_uuid is derived deterministically from the swim's natural identity
-- (athlete|stroke|distM|date|timeSec) — see ATHLETE-RECORDS-CONTEXT.md.
--
-- The live database already had this dropped by hand; this migration makes a
-- fresh setup from the migration chain match it. Safe to run either way.
-- (The applied athlete_records migration is left untouched on purpose.)

drop index if exists public.performance_results_import_dedup;
