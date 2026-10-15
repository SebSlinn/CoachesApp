//repositories/supabase/SupabaseGroupRepository.js
// Groups backed by Supabase. Reads go through SECURITY DEFINER functions that
// return only what the caller may see (my_memberships, group_directory, …);
// every change is an RPC. RLS and the functions enforce the rules.
import { supabase } from '../../supabaseClient';
import { IGroupRepository } from '../interfaces/IGroupRepository';

const UNAVAILABLE = { data: null, error: { message: 'Supabase is not configured' } };

export class SupabaseGroupRepository extends IGroupRepository {
  async #rpc(name, args) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase.rpc(name, args);
    return { data, error };
  }

  // ---- reads ----
  async getMyMemberships() { return this.#rpc('my_memberships'); }
  async getPendingRequests() { return this.#rpc('my_pending_requests'); }
  async getDirectory(orgId) { return this.#rpc('group_directory', { p_org: orgId }); }
  async getEvents(orgId, limit = 100) { return this.#rpc('group_event_log', { p_org: orgId, p_limit: limit }); }

  async getGroup(orgId) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('organisations')
      .select('id, name, description, group_type, org_type, parent_org_id, show_public_name, show_full_name, show_email, members_see_results')
      .eq('id', orgId)
      .maybeSingle();
    return { data, error };
  }

  async getInvites(orgId) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('group_invites')
      .select('id, code, role, needs_approval, max_uses, uses, expires_at, revoked_at, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    return { data, error };
  }

  async getMyAccess(orgId) {
    const [m, st] = await Promise.all([
      this.#rpc('can_manage_group', { p_org: orgId }),
      this.#rpc('is_group_staff', { p_org: orgId }),
    ]);
    const error = m.error || st.error;
    return error ? { data: null, error } : { data: { can_manage: !!m.data, is_staff: !!st.data }, error: null };
  }

  async getRoles() {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('group_roles')
      .select('key, label, manage_members, read_results, add_results, is_staff, sort, retired')
      .eq('retired', false)
      .order('sort');
    return { data, error };
  }

  // ---- groups ----
  async createGroup(g) {
    return this.#rpc('create_group', {
      p_name: g.name, p_group_type: g.groupType, p_org_type: g.orgType,
      p_parent_org: g.parentOrgId || null, p_description: g.description || null,
    });
  }

  async updateSettings(orgId, c) {
    return this.#rpc('update_group_settings', {
      p_org: orgId, p_name: c.name ?? null, p_description: c.description ?? null,
      p_show_public_name: c.showPublicName ?? null, p_show_full_name: c.showFullName ?? null,
      p_show_email: c.showEmail ?? null, p_members_see_results: c.membersSeeResults ?? null,
    });
  }

  async acceptSettings(orgId, userId) {
    return this.#rpc('accept_group_settings', userId ? { p_org: orgId, p_user: userId } : { p_org: orgId });
  }

  async setMySharing(orgId, t, userId) {
    const args = { p_org: orgId, p_public_name: !!t.publicName, p_full_name: !!t.fullName, p_email: !!t.email, p_results: !!t.results };
    if (userId) args.p_user = userId;
    return this.#rpc('set_my_sharing', args);
  }

  // ---- invites & joining ----
  async createInvite(orgId, i) {
    return this.#rpc('create_group_invite', {
      p_org: orgId, p_role: i.role || 'member', p_needs_approval: !!i.needsApproval,
      p_max_uses: i.maxUses || null, p_expires_at: i.expiresAt || null,
    });
  }
  async revokeInvite(inviteId) { return this.#rpc('revoke_group_invite', { p_invite: inviteId }); }
  async previewInvite(code) { return this.#rpc('preview_group_invite', { p_code: code }); }
  async joinGroup(code, userId) {
    return this.#rpc('join_group', userId ? { p_code: code, p_user: userId } : { p_code: code });
  }
  async approveMembership(id, accept) { return this.#rpc('approve_membership', { p_membership: id, p_accept: accept }); }
  async approveJuniorMembership(id, accept) { return this.#rpc('approve_junior_membership', { p_membership: id, p_accept: accept }); }

  // ---- members ----
  async addMemberRole(orgId, userId, role) { return this.#rpc('add_member_role', { p_org: orgId, p_user: userId, p_role: role }); }
  async setMemberCapability(id, cap, value) {
    return this.#rpc('set_member_capability', { p_membership: id, p_cap: cap, p_value: value });
  }
  async removeMembership(id) { return this.#rpc('remove_membership', { p_membership_id: id }); }

  // ---- qualifications ----
  async getMyQualifications(userId) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('staff_qualifications')
      .select('id, title, issuer, ref, expires_on, verified_at, created_at')
      .eq('user_id', userId)
      .order('created_at');
    return { data, error };
  }
  async addQualification(q) {
    return this.#rpc('add_qualification', {
      p_title: q.title, p_issuer: q.issuer || null, p_ref: q.ref || null, p_expires_on: q.expiresOn || null,
    });
  }
  async removeQualification(id) { return this.#rpc('remove_qualification', { p_id: id }); }
}
