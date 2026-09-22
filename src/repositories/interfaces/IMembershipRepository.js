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
  async getMemberships(_userId) {
    throw new Error('IMembershipRepository.getMemberships not implemented');
  }
}
