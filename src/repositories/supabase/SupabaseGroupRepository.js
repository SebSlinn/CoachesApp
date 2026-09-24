//repositories/supabase/SupabaseGroupRepository.js
// Groups, grants and adding athletes, backed by Supabase: table reads (RLS
// limits what's visible), RPCs for every change, and the add-athlete Edge
// Function for creating accounts (needs the service-role key server-side).
import { supabase } from '../../supabaseClient';
import { IGroupRepository } from '../interfaces/IGroupRepository';

const UNAVAILABLE = { data: null, error: { message: 'Supabase is not configured' } };

export class SupabaseGroupRepository extends IGroupRepository {
  async #rpc(name, args) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase.rpc(name, args);
    return { data, error };
  }

  // ---- what can the signed-in user do? ----
  async canAddUsers() { return this.#rpc('can_add_users'); }
  async isRoot() { return this.#rpc('is_root'); }

  // ---- reads ----
  async getMyAdminGroups(userId) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('memberships')
      .select(`
        id,
        status,
        organisations (
          id,
          name,
          org_type,
          admin_grants ( id, status, parent_grant_id )
        )
      `)
      .eq('user_id', userId)
      .eq('role', 'admin')
      .in('status', ['active', 'pending']);
    return { data, error };
  }

  async getGrantTree() {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('admin_grants')
      .select(`
        id,
        parent_grant_id,
        status,
        created_at,
        organisations ( id, name, org_type, daily_limit_override )
      `)
      .order('created_at');
    return { data, error };
  }

  async getGroupMembers(orgId) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('memberships')
      .select('id, role, status, created_at, user_id, users!user_id ( full_name, email )')
      .eq('org_id', orgId)
      .in('status', ['active', 'pending'])
      .order('role');
    return { data, error };
  }

  async getPendingMemberships(userId) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('memberships')
      .select('id, role, organisations ( id, name, org_type )')
      .eq('user_id', userId)
      .eq('status', 'pending');
    return { data, error };
  }

  // ---- groups & admins ----
  async createSubgroup(parentOrgId, name, orgType, adminEmail) {
    return this.#rpc('create_subgroup', {
      p_parent_org: parentOrgId, p_name: name, p_org_type: orgType, p_admin_email: adminEmail,
    });
  }

  async nominateGroupAdmin(orgId, email) {
    return this.#rpc('nominate_group_admin', { p_org: orgId, p_email: email });
  }

  async respondToMembership(membershipId, accept) {
    return this.#rpc('respond_to_membership', { p_membership_id: membershipId, p_accept: accept });
  }

  async removeMembership(membershipId) {
    return this.#rpc('remove_membership', { p_membership_id: membershipId });
  }

  async setGrantStatus(grantId, status) {
    return this.#rpc('set_grant_status', { p_grant_id: grantId, p_status: status });
  }

  // ---- rate limit (root only) ----
  async setDailyAddLimit(limit) {
    return this.#rpc('set_daily_add_limit', { p_limit: limit });
  }

  async setGroupDailyLimit(orgId, limit) {
    return this.#rpc('set_group_daily_limit', { p_org: orgId, p_limit: limit });
  }

  // ---- adding athletes (Edge Function) ----
  async addAthlete(athlete) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase.functions.invoke('add-athlete', {
      body: {
        organisation_id: athlete.organisationId,
        email: athlete.email,
        full_name: athlete.fullName,
        date_of_birth: athlete.dateOfBirth || null,
        guardian_emails: athlete.guardianEmails || [],
      },
    });
    if (!error) return { data, error: null };

    // The function replies { error: 'CODE: message' } — surface that, not the generic HTTP text.
    let message = error.message;
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch { /* keep the generic message */ }
    return { data: null, error: { message } };
  }
}
