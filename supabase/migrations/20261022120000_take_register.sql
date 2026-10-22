-- 20261022120000_take_register.sql — Accounts (phase 0 of Registers, claude-docs/teams/REGISTERS-PLAN.md)
--
-- A new capability, take_register: may start a register for a group, tick its
-- members in and sign them out (DECISIONS 2026-10-22). Attendance is welfare data,
-- not results, so it never rides on add_results.
--
--   group_roles.take_register      role default (on for TM, Coach, Assistant Coach, Poolside Assistant)
--   memberships.take_register      per-person override, null = role default (like the other three)
--   membership_can(m,'take_register'), has_group_capability(org,'take_register')
--   set_member_capability(m,'take_register',v) and the capability_changed event include it
--   my_memberships() and group_directory() return it (new last column, so both are dropped first)
--
-- Idempotent. Re-creates functions from 20261015120000 with take_register added; nothing else changed in them.

alter table public.group_roles add column if not exists take_register boolean not null default false;
alter table public.memberships add column if not exists take_register boolean;

-- Defaults for the starting catalogue: every staff role. Only applied while no role has it yet,
-- so a later change by root to the catalogue is never undone by a re-run.
update public.group_roles set take_register = true
 where key in ('team_manager','coach','assistant_coach','poolside_assistant')
   and not exists (select 1 from public.group_roles where take_register);

create or replace function public.membership_can(p_membership uuid, p_cap text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_cap
             when 'manage_members' then coalesce(m.manage_members, r.manage_members)
             when 'read_results'   then coalesce(m.read_results,   r.read_results)
             when 'add_results'    then coalesce(m.add_results,    r.add_results)
             when 'take_register'  then coalesce(m.take_register,  r.take_register)
             when 'staff'          then r.is_staff
             else false end
      from memberships m join group_roles r on r.key = m.role
     where m.id = p_membership), false);
$$;

create or replace function public.set_member_capability(p_membership uuid, p_cap text, p_value boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from memberships where id = p_membership;
  if v_org is null or not public.can_manage_group(v_org) then
    raise exception 'NOT_ALLOWED: you do not manage that group';
  end if;
  if p_cap = 'manage_members' then update memberships set manage_members = p_value where id = p_membership;
  elsif p_cap = 'read_results' then update memberships set read_results = p_value where id = p_membership;
  elsif p_cap = 'add_results'  then update memberships set add_results  = p_value where id = p_membership;
  elsif p_cap = 'take_register' then update memberships set take_register = p_value where id = p_membership;
  else raise exception 'INVALID: capability must be manage_members, read_results, add_results or take_register';
  end if;
end $$;

-- Every membership change any member should know about (now including take_register).
create or replace function public.log_membership_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_label text := (select label from group_roles where key = new.role);
begin
  if tg_op = 'INSERT' then
    if new.status = 'active' then
      insert into group_events (org_id, actor_user_id, subject_user_id, event, detail)
      values (new.org_id, v_actor, new.user_id,
              case when exists (select 1 from memberships m where m.org_id = new.org_id and m.user_id = new.user_id
                                  and m.id <> new.id and m.status = 'active') then 'role_added' else 'joined' end,
              jsonb_build_object('role', new.role, 'role_label', v_label));
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'active' then
      insert into group_events (org_id, actor_user_id, subject_user_id, event, detail)
      values (new.org_id, v_actor, new.user_id, 'joined', jsonb_build_object('role', new.role, 'role_label', v_label));
    elsif new.status = 'removed' and old.status = 'active' then
      insert into group_events (org_id, actor_user_id, subject_user_id, event, detail)
      values (new.org_id, v_actor, new.user_id,
              case when v_actor = new.user_id then 'left' else 'removed' end,
              jsonb_build_object('role', new.role, 'role_label', v_label));
    end if;
  end if;

  if new.manage_members is distinct from old.manage_members
     or new.read_results is distinct from old.read_results
     or new.add_results  is distinct from old.add_results
     or new.take_register is distinct from old.take_register then
    insert into group_events (org_id, actor_user_id, subject_user_id, event, detail)
    values (new.org_id, v_actor, new.user_id, 'capability_changed',
            jsonb_build_object('role', new.role, 'role_label', v_label,
              'from', jsonb_build_object('manage_members', old.manage_members, 'read_results', old.read_results, 'add_results', old.add_results, 'take_register', old.take_register),
              'to',   jsonb_build_object('manage_members', new.manage_members, 'read_results', new.read_results, 'add_results', new.add_results, 'take_register', new.take_register)));
  end if;
  return new;
end $$;

create or replace function public.join_group(p_code text, p_user uuid default auth.uid()) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v group_invites%rowtype;
  o organisations%rowtype;
  v_by_guardian boolean;
  v_status text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'NOT_ALLOWED: sign in first'; end if;
  v_by_guardian := p_user <> v_uid;
  if v_by_guardian and not public.is_active_guardian(p_user, v_uid) then
    raise exception 'NOT_ALLOWED: you can only join groups for yourself or a junior you are guardian of';
  end if;
  v := public.usable_invite(p_code);
  select * into o from organisations where id = v.org_id;

  v_status := case when public.is_junior(p_user) and not v_by_guardian then 'awaiting_guardian'
                   when v.needs_approval then 'pending'
                   else 'active' end;

  select id into v_id from memberships where user_id = p_user and org_id = o.id and role = v.role;
  if v_id is not null then
    if (select status from memberships where id = v_id) in ('active','pending','awaiting_guardian') then
      return v_id;                                         -- already in (or waiting): no-op
    end if;
    update memberships
       set status = v_status, needs_approval = v.needs_approval, invite_id = v.id, nominated_by = v_uid,
           guardian_approved_by = case when v_by_guardian then v_uid end,
           share_public_name = o.show_public_name, share_full_name = o.show_full_name,
           share_email = o.show_email, share_results = o.members_see_results,
           manage_members = null, read_results = null, add_results = null, take_register = null
     where id = v_id;
  else
    insert into memberships (user_id, org_id, role, status, needs_approval, invite_id, nominated_by,
                             guardian_approved_by, share_public_name, share_full_name, share_email, share_results)
    values (p_user, o.id, v.role, v_status, v.needs_approval, v.id, v_uid,
            case when v_by_guardian then v_uid end,
            o.show_public_name, o.show_full_name, o.show_email, o.members_see_results)
    returning id into v_id;
  end if;

  update group_invites set uses = uses + 1 where id = v.id;
  return v_id;
end $$;

create or replace function public.add_member_role(p_org uuid, p_user uuid, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_manage_group(p_org) then raise exception 'NOT_ALLOWED: you do not manage that group'; end if;
  if not exists (select 1 from group_roles where key = p_role and not retired) then
    raise exception 'INVALID: unknown role %', p_role;
  end if;
  if not exists (select 1 from memberships where org_id = p_org and user_id = p_user and status = 'active') then
    raise exception 'NOT_FOUND: that person is not an active member of the group';
  end if;
  select id into v_id from memberships where org_id = p_org and user_id = p_user and role = p_role;
  if v_id is null then
    insert into memberships (user_id, org_id, role, status, nominated_by,
                             share_public_name, share_full_name, share_email, share_results)
    select p_user, p_org, p_role, 'active', auth.uid(),
           show_public_name, show_full_name, show_email, members_see_results
      from organisations where id = p_org
    returning id into v_id;
  else
    update memberships set status = 'active', manage_members = null, read_results = null, add_results = null, take_register = null
     where id = v_id and status <> 'active';
  end if;
  return v_id;
end $$;

drop function if exists public.group_directory(uuid);
-- The member list as the caller is allowed to see it. Hidden fields come back null.
create or replace function public.group_directory(p_org uuid)
returns table (membership_id uuid, user_id uuid, public_name text, full_name text, email text,
               role text, role_label text, is_staff boolean, status text,
               manage_members boolean, read_results boolean, add_results boolean, is_junior boolean,
               take_register boolean)
language sql stable security definer set search_path = public as $$
  with me as (
    select public.is_group_staff(p_org) or public.can_manage_group(p_org) as staff_view,
           public.can_see_group(p_org) as can_see
  )
  select m.id, m.user_id,
         coalesce(u.public_name, u.full_name),
         case when me.staff_view or m.user_id = auth.uid() or r.is_staff
                   or (o.show_full_name and m.share_full_name and not public.is_junior(m.user_id))
              then u.full_name end,
         case when me.staff_view or m.user_id = auth.uid()
                   or (o.show_email and m.share_email and not public.is_junior(m.user_id))
              then u.email end,
         m.role, r.label, r.is_staff, m.status,
         public.membership_can(m.id, 'manage_members'),
         public.membership_can(m.id, 'read_results'),
         public.membership_can(m.id, 'add_results'),
         public.is_junior(m.user_id),
         public.membership_can(m.id, 'take_register')
    from me, memberships m
    join group_roles r   on r.key = m.role
    join users u         on u.id = m.user_id
    join organisations o on o.id = m.org_id
   where me.can_see and m.org_id = p_org
     and (m.status = 'active' or (me.staff_view and m.status in ('pending','awaiting_guardian')))
     and (me.staff_view or r.is_staff or m.user_id = auth.uid()
          or public.is_active_guardian(m.user_id)
          or (o.show_public_name and m.share_public_name))
   order by r.sort, coalesce(u.public_name, u.full_name);
$$;

drop function if exists public.my_memberships();
-- My memberships with effective capabilities.
create or replace function public.my_memberships()
returns table (membership_id uuid, org_id uuid, org_name text, group_type text, org_type text,
               parent_org_id uuid, description text, role text, role_label text, status text,
               manage_members boolean, read_results boolean, add_results boolean, is_staff boolean,
               share_public_name boolean, share_full_name boolean, share_email boolean, share_results boolean,
               settings_to_accept boolean, take_register boolean)
language sql stable security definer set search_path = public as $$
  select m.id, o.id, o.name, o.group_type, o.org_type, o.parent_org_id, o.description,
         m.role, r.label, m.status,
         public.membership_can(m.id, 'manage_members'), public.membership_can(m.id, 'read_results'),
         public.membership_can(m.id, 'add_results'), r.is_staff,
         m.share_public_name, m.share_full_name, m.share_email, m.share_results,
         m.status = 'active' and not r.is_staff and (
           (o.show_public_name and not m.share_public_name)
           or (o.show_full_name and not m.share_full_name and not public.is_junior(m.user_id))
           or (o.show_email and not m.share_email and not public.is_junior(m.user_id))
           or (o.members_see_results and not m.share_results)),
         public.membership_can(m.id, 'take_register')
    from memberships m
    join organisations o on o.id = m.org_id
    join group_roles r   on r.key = m.role
   where m.user_id = auth.uid() and m.status in ('active','pending','awaiting_guardian')
   order by o.name, r.sort;
$$;
