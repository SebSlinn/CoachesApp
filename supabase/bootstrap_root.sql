-- ============================================================================
-- SwimZone — one-off: make you the root of the sponsorship tree.
-- Run ONCE in the Supabase SQL editor on a database that has no root yet,
-- after you have signed in to SwimZone at least once (so your users row exists).
-- (The live DB already has one — it was carried over by
--  20261015120000_groups_sponsorship.sql — so you don't need this there.)
--
-- Replace the email below with the address you sign in with.
-- To add a second root Team Manager later (recommended, so the tree can't be
-- orphaned), run section 2 again with their email.
-- ============================================================================

-- 1. Root group + root sponsorship (parent_sponsorship_id is null = the top of the tree)
with root_org as (
  insert into public.organisations (name, org_type, group_type)
  values ('SwimZone', 'root', 'root')
  returning id
)
insert into public.sponsorships (org_id, parent_sponsorship_id, status)
select id, null, 'active' from root_org;

-- 2. Make a user a Team Manager of the root group
insert into public.memberships (user_id, org_id, role, status)
select u.id, o.id, 'team_manager', 'active'
  from public.users u, public.organisations o
 where lower(u.email) = lower('YOUR-EMAIL@example.com')   -- <-- change this
   and o.group_type = 'root';

-- 3. Your own date of birth (needed so you count as an adult, e.g. to be a guardian)
-- update public.users set date_of_birth = '1970-01-01' where lower(email) = lower('YOUR-EMAIL@example.com');

-- Check: should return true when run as you in the app, or here:
-- select public.is_root(id) from public.users where lower(email) = lower('YOUR-EMAIL@example.com');
