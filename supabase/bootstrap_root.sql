-- ============================================================================
-- SwimZone — one-off: make you the root of the adding-rights tree.
-- Run ONCE in the Supabase SQL editor after the migration, after you have
-- signed in to SwimZone at least once (so your users row exists).
--
-- Replace the email below with the address you sign in with.
-- To add a second root admin later (recommended, so the tree can't be
-- orphaned), run section 2 again with their email.
-- ============================================================================

-- 1. Root group + root grant (parent_grant_id is null = the top of the tree)
with root_org as (
  insert into public.organisations (name, org_type)
  values ('SwimZone', 'root')
  returning id
)
insert into public.admin_grants (org_id, parent_grant_id, status)
select id, null, 'active' from root_org;

-- 2. Make a user an admin of the root group
insert into public.memberships (user_id, org_id, role, status)
select u.id, o.id, 'admin', 'active'
  from public.users u, public.organisations o
 where lower(u.email) = lower('alsonline@outlook.com')   -- <-- change this
   and o.org_type = 'root';

-- 3. Your own date of birth (needed so you count as an adult, e.g. to be a guardian)
-- update public.users set date_of_birth = '1970-01-01' where lower(email) = lower('alsonline@outlook.com');

-- Check: should return true when run as you in the app, or here:
-- select public.is_root(id) from public.users where lower(email) = lower('alsonline@outlook.com');
