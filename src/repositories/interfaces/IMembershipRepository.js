//repositories/interfaces/IMembershipRepository.js
// Contract for reading/writing a user's profile row and their organisation
// memberships. Today the only implementation is Supabase Postgres
// (SupabaseMembershipRepository), via the `users`/`memberships`/
// `organisations` tables.

export class IMembershipRepository {
  async getProfile(_userId) {
    throw new Error('IMembershipRepository.getProfile not implemented');
  }
  async createProfile(_userId, _email, _fullName) {
    throw new Error('IMembershipRepository.createProfile not implemented');
  }
  /** The signed-in user's memberships with effective capabilities (see my_memberships()). */
  async getMemberships(_userId) {
    throw new Error('IMembershipRepository.getMemberships not implemented');
  }
  /** Display names for a list of user ids → { data: { [userId]: name } }. */
  async displayNames(_ids) {
    throw new Error('IMembershipRepository.displayNames not implemented');
  }
  /** About me: { has_date_of_birth, is_junior, is_adult, juniors_missing_date_of_birth: [{user_id, name}] }. */
  async getAccountStatus() {
    throw new Error('IMembershipRepository.getAccountStatus not implemented');
  }
  /** Add my own date of birth, once (private: only me and a guardian can read it). */
  /** My own date of birth → 'YYYY-MM-DD' or null (user_birthdates; RLS: me or my guardian). */
  async getMyDateOfBirth() {
    throw new Error('IMembershipRepository.getMyDateOfBirth not implemented');
  }
  async setMyDateOfBirth(_date) {
    throw new Error('IMembershipRepository.setMyDateOfBirth not implemented');
  }
  /** Update the caller's own profile (public_name / full_name). RLS enforces self. */
  async updateProfile(_userId, _changes) {
    throw new Error('IMembershipRepository.updateProfile not implemented');
  }
}
