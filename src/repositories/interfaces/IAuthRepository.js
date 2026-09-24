//repositories/interfaces/IAuthRepository.js
// Contract for anything that can authenticate a user. Today the only
// implementation is Supabase Auth (SupabaseAuthRepository) — this interface
// is what lets services/auth.js stay ignorant of *how* auth happens, so a
// different backend later is a repository-only change, not a rewrite of
// every page that signs someone in.
//
// All methods return Supabase-shaped { data, error } objects (or, for
// onAuthStateChange, a Supabase-shaped { data: { subscription } }).

export class IAuthRepository {
  async signInWithPassword(_email, _password) {
    throw new Error('IAuthRepository.signInWithPassword not implemented');
  }
  async signOut() {
    throw new Error('IAuthRepository.signOut not implemented');
  }
  async getSession() {
    throw new Error('IAuthRepository.getSession not implemented');
  }
  onAuthStateChange(_callback) {
    throw new Error('IAuthRepository.onAuthStateChange not implemented');
  }
  /** Set a new password for the signed-in user (after an invite or reset link). */
  async updatePassword(_newPassword) {
    throw new Error('IAuthRepository.updatePassword not implemented');
  }
  /** Email a reset link that lands on pRedirectTo. */
  async sendPasswordReset(_email, _redirectTo) {
    throw new Error('IAuthRepository.sendPasswordReset not implemented');
  }
}
