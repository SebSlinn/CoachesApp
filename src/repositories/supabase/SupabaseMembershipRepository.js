//repositories/supabase/SupabaseMembershipRepository.js
// Behaviour copied verbatim from the old services/users.js — same queries,
// same lack of a null-supabase guard (matches the original; memberships
// data was never reachable without Supabase configured anyway).
import { supabase } from '../../supabaseClient';
import { IMembershipRepository } from '../interfaces/IMembershipRepository';

export class SupabaseMembershipRepository extends IMembershipRepository {
  async getProfile(userId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    return { data, error };
  }

  async createProfile(userId, email, fullName) {
    const { data, error } = await supabase
      .from('users')
      .insert({ id: userId, email, full_name: fullName })
      .select()
      .single();
    return { data, error };
  }

  // My live memberships (active, pending, awaiting a guardian) with each one's
  // effective capabilities, via my_memberships() — userId is implied by the session.
  async getMemberships(_userId) {
    const { data, error } = await supabase.rpc('my_memberships');
    return { data, error };
  }

  // Display names for a set of user ids, via the SECURITY DEFINER function
  // user_display_names (so we can read a name without broad access to `users`).
  // Returns a { [userId]: name } map. Used by "Added by" on set results.
  async displayNames(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    if (!unique.length) return { data: {}, error: null };
    const { data, error } = await supabase.rpc('user_display_names', { p_ids: unique });
    if (error) return { data: null, error };
    const map = {};
    for (const row of data || []) map[row.user_id] = row.name;
    return { data: map, error: null };
  }

  async getAccountStatus() {
    const { data, error } = await supabase.rpc('my_account_status');
    return { data, error };
  }

  async setMyDateOfBirth(date) {
    const { data, error } = await supabase.rpc('set_my_date_of_birth', { p_date_of_birth: date });
    return { data, error };
  }

  // Update the caller's own profile. Only public_name / full_name are writable
  // here; RLS (sz_users_self_update) restricts the row to id = auth.uid(). Dates of
  // birth are not on users at all (user_birthdates, set once via set_my_date_of_birth).
  async updateProfile(userId, changes) {
    const patch = {};
    if (changes.publicName !== undefined) patch.public_name = changes.publicName || null;
    if (changes.fullName !== undefined) patch.full_name = changes.fullName;
    if (!Object.keys(patch).length) return { data: null, error: { message: 'Nothing to update' } };
    const { data, error } = await supabase
      .from('users')
      .update(patch)
      .eq('id', userId)
      .select()
      .single();
    return { data, error };
  }
}
