-- 20261011120000_user_display_name.sql
-- "Added by" on set results: resolve a user id to a PUBLIC-FACING name so anyone
-- reviewing a run can see who imported it, as a check on its validity. The author
-- can be any user — a coach, a parent/guardian, or the athlete — so public_name
-- lives on users (every account), not on a coach-only table.
--
-- The author is ALREADY stored: set_efforts.created_by defaults to auth.uid()
-- (see 20260927120000_athlete_records.sql). This migration adds (1) an optional
-- public_name a user can choose to be shown by, and (2) a safe way to READ it.
--
-- public_name is the handle shown to other users. The resolver prefers it, then
-- full_name, and NEVER falls back to email — so no email is exposed, and it works
-- whether or not someone has set a public name or a full first+surname. A NULL
-- result means "no name set"; the app shows a neutral label (e.g. "a coach").
--
-- The function is SECURITY DEFINER and returns ONLY the resolved name for the ids
-- asked for, never the rest of the users row. Any signed-in user may call it, for
-- any user id (club-wide recognition of who entered results; tighten later if
-- cross-club privacy needs it).
--
-- New SQL only — does not edit any applied migration.

begin;

alter table public.users
  add column if not exists public_name text;

comment on column public.users.public_name is
  'Optional handle shown to other users (e.g. on "Added by"). Falls back to '
  'full_name for display; email is never shown.';

create or replace function public.user_display_names(p_ids uuid[])
returns table(user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select u.id,
         coalesce(nullif(btrim(u.public_name), ''), nullif(btrim(u.full_name), ''))
  from public.users u
  where u.id = any(p_ids)
$$;

comment on function public.user_display_names(uuid[]) is
  'Public display name (public_name, else full_name; never email) for each user '
  'id. SECURITY DEFINER so any signed-in user can see who added results without '
  'broad read access to users. NULL name = none set; the app shows a neutral label.';

grant execute on function public.user_display_names(uuid[]) to authenticated;

commit;
