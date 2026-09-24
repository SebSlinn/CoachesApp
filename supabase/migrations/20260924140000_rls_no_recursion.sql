-- ============================================================================
-- SwimZone — stop RLS policies on users / organisations querying memberships
-- directly (which can loop with existing memberships policies → HTTP 500,
-- "infinite recursion detected in policy").
-- Migration 20260924140000_rls_no_recursion.sql
--
-- The two policies now call SECURITY DEFINER helpers, which read the tables
-- without re-entering RLS — the same approach every other sz_* policy uses.
-- ============================================================================
begin;

-- Is the signed-in user an active or pending member of this group?
create or replace function public.is_member_of(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships
                  where org_id = p_org and user_id = p_user
                    and status in ('active','pending'));
$$;

-- Can the signed-in user see this person's profile? Themselves, anyone they
-- share a log with (either direction), and members of groups they manage.
create or replace function public.can_see_user(p_target uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select p_target = p_user
      or exists (select 1 from log_permissions lp
                  where lp.status <> 'revoked'
                    and ((lp.owner_user_id = p_target and lp.grantee_user_id = p_user)
                      or (lp.grantee_user_id = p_target and lp.owner_user_id = p_user)))
      or exists (select 1 from memberships m
                  where m.user_id = p_target and m.status <> 'removed'
                    and public.can_manage_group(m.org_id, p_user));
$$;

drop policy if exists sz_users_related on public.users;
create policy sz_users_related on public.users for select to authenticated
  using (public.can_see_user(id));

drop policy if exists sz_orgs_read on public.organisations;
create policy sz_orgs_read on public.organisations for select to authenticated
  using (public.is_member_of(id) or public.can_manage_group(id));

-- The pre-existing "memberships: org staff read" policy queried memberships
-- from inside a memberships policy (self-recursive). It only surfaced once
-- RLS was switched on for the table. Same rule, via a definer helper.
create or replace function public.is_org_staff(p_org uuid, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships
                  where org_id = p_org and user_id = p_user
                    and role = any (array['coach','manager','admin'])
                    and status = 'active');
$$;

drop policy if exists "memberships: org staff read" on public.memberships;
create policy "memberships: org staff read" on public.memberships for select to authenticated
  using (public.is_org_staff(org_id));

commit;
