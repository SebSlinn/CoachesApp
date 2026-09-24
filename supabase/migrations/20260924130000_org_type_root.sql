-- ============================================================================
-- SwimZone — allow the 'root' organisation type (top of the adding-rights tree)
-- Migration 20260924130000_org_type_root.sql
--
-- Existing types are kept and reused by the grant tree:
--   governing_body  — e.g. a regional swimming organisation
--   club            — a swimming club
--   private         — a solo login (a group of one)
--   root            — NEW: the single top group, held by the SwimZone admin(s)
-- ============================================================================
alter table public.organisations drop constraint if exists organisations_org_type_check;
alter table public.organisations add constraint organisations_org_type_check
  check (org_type = any (array['club'::text, 'governing_body'::text, 'private'::text, 'root'::text]));
