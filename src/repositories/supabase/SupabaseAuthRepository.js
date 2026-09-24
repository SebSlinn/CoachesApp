//repositories/supabase/SupabaseAuthRepository.js
// Only file (besides SupabaseMembershipRepository) allowed to import
// supabaseClient.js for auth purposes. Behaviour copied verbatim from the
// old services/auth.js — same "Supabase not configured" fallback, same
// return shapes — this is a pure relocation, not a rewrite.
import { supabase } from '../../supabaseClient';
import { IAuthRepository } from '../interfaces/IAuthRepository';

const UNAVAILABLE_MESSAGE =
  'Authentication is unavailable because Supabase is not configured in production.';
const unavailable = () => ({ data: null, error: { message: UNAVAILABLE_MESSAGE } });

export class SupabaseAuthRepository extends IAuthRepository {
  async signInWithPassword(email, password) {
    if (!supabase) return unavailable();
    return supabase.auth.signInWithPassword({ email, password });
  }

  async signOut() {
    if (!supabase) return unavailable();
    return supabase.auth.signOut();
  }

  async getSession() {
    if (!supabase) return unavailable();
    return supabase.auth.getSession();
  }

  onAuthStateChange(callback) {
    if (!supabase) return { data: { subscription: { unsubscribe: () => {} } } };
    return supabase.auth.onAuthStateChange(callback);
  }

  async updatePassword(newPassword) {
    if (!supabase) return unavailable();
    return supabase.auth.updateUser({ password: newPassword });
  }

  async sendPasswordReset(email, redirectTo) {
    if (!supabase) return unavailable();
    return supabase.auth.resetPasswordForEmail(email, { redirectTo });
  }
}
