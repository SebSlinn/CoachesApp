//repositories/supabase/SupabaseLogSharingRepository.js
// Guardians (the `log_permissions` table, guardian rows only) and the athletes
// the caller can load (my_athletes). Reads filtered by RLS; changes are RPCs.
import { supabase } from '../../supabaseClient';
import { ILogSharingRepository } from '../interfaces/ILogSharingRepository';

const UNAVAILABLE = { data: null, error: { message: 'Supabase is not configured' } };

export class SupabaseLogSharingRepository extends ILogSharingRepository {
  async #rpc(name, args) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase.rpc(name, args);
    return { data, error };
  }

  async getLoadableAthletes() { return this.#rpc('my_athletes'); }

  async getGuardians(ownerId) {
    if (!supabase) return UNAVAILABLE;
    const { data, error } = await supabase
      .from('log_permissions')
      .select('id, grantee_user_id, status, created_at')
      .eq('owner_user_id', ownerId)
      .eq('is_guardian', true)
      .neq('status', 'revoked');
    if (error) return { data: null, error };
    const ids = (data || []).map((r) => r.grantee_user_id);
    const names = ids.length ? await supabase.rpc('user_display_names', { p_ids: ids }) : { data: [] };
    const byId = Object.fromEntries((names.data || []).map((n) => [n.user_id, n.name]));
    return { data: (data || []).map((r) => ({ ...r, name: byId[r.grantee_user_id] || null })), error: null };
  }

  async canManageSharing(ownerId) { return this.#rpc('can_manage_log_sharing', { p_owner: ownerId }); }
  async revoke(permissionId) { return this.#rpc('revoke_log_permission', { p_permission_id: permissionId }); }
  async nominateGuardian(juniorId, guardianEmail) {
    return this.#rpc('nominate_guardian', { p_junior: juniorId, p_guardian_email: guardianEmail });
  }
  async respondToGuardianship(permissionId, accept) {
    return this.#rpc('respond_to_guardianship', { p_permission_id: permissionId, p_accept: accept });
  }
}
