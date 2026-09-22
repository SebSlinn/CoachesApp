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

  async getMemberships(userId) {
    const { data, error } = await supabase
      .from('memberships')
      .select(`
        id,
        role,
        status,
        organisations (
          id,
          name,
          org_type
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'active');
    return { data, error };
  }
}
