//repositories/supabase/SupabaseLogSharingRepository.js
// Log sharing and guardians, backed by the Supabase `log_permissions` table
// (reads, filtered by RLS) and RPCs (every change).
import { supabase } from '../../supabaseClient';
import { ILogSharingRepository } from '../interfaces/ILogSharingRepository';

const UNAVAILABLE = { data: null, error: { message: 'Supabase is not configured' } };

export class SupabaseLogSharingRepository extends ILogSharingRepository {
  async #rpc(name, args) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase.rpc(name, args);
    return { data, error };
  }

  async getPermissionsForOwner(ownerId) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('log_permissions')
      .select(`
        id,
        grantee_user_id,
        can_read,
        can_add,
        can_edit,
        is_guardian,
        status,
        expires_at,
        grantee:users!grantee_user_id ( full_name, email )
      `)
      .eq('owner_user_id', ownerId)
      .neq('status', 'revoked')
      .order('is_guardian', { ascending: false });
    return { data, error };
  }

  async getSharedWithMe(userId) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('log_permissions')
      .select(`
        id,
        owner_user_id,
        can_read,
        can_add,
        can_edit,
        is_guardian,
        status,
        expires_at,
        owner:users!owner_user_id ( full_name, date_of_birth )
      `)
      .eq('grantee_user_id', userId)
      .in('status', ['active', 'pending']);
    return { data, error };
  }

  async canManageSharing(ownerId) {
    return this.#rpc('can_manage_log_sharing', { p_owner: ownerId });
  }

  async share(ownerId, granteeEmail, access, expiresAt) {
    return this.#rpc('share_log', {
      p_owner: ownerId,
      p_grantee_email: granteeEmail,
      p_can_read: !!access.read,
      p_can_add: !!access.add,
      p_can_edit: !!access.edit,
      p_expires_at: expiresAt,
    });
  }

  async revoke(permissionId) {
    return this.#rpc('revoke_log_permission', { p_permission_id: permissionId });
  }

  async nominateGuardian(juniorId, guardianEmail) {
    return this.#rpc('nominate_guardian', { p_junior: juniorId, p_guardian_email: guardianEmail });
  }

  async respondToGuardianship(permissionId, accept) {
    return this.#rpc('respond_to_guardianship', { p_permission_id: permissionId, p_accept: accept });
  }
}
