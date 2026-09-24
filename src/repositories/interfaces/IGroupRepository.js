//repositories/interfaces/IGroupRepository.js
// Contract for the adding-rights tree: groups (organisations), their grants,
// their admins, and adding athletes. Today the only implementation is
// SupabaseGroupRepository. The permission rules themselves live in the
// database (see supabase/migrations/..._user_accounts.sql); an implementation
// just carries requests to wherever those rules are enforced.
//
// Every method resolves to { data, error } — never throws.

export class IGroupRepository {
  // ---- what can the signed-in user do? ----
  /** @returns {Promise<{data: boolean, error}>} */
  async canAddUsers() { throw new Error('IGroupRepository.canAddUsers not implemented'); }
  /** @returns {Promise<{data: boolean, error}>} */
  async isRoot() { throw new Error('IGroupRepository.isRoot not implemented'); }

  // ---- reads ----
  /** Groups the user is (or is invited to be) an admin of, with grant status. */
  async getMyAdminGroups(_userId) { throw new Error('IGroupRepository.getMyAdminGroups not implemented'); }
  /** Every grant visible to the user: their groups and everything below. */
  async getGrantTree() { throw new Error('IGroupRepository.getGrantTree not implemented'); }
  /** Members of one group (all roles, active and pending). */
  async getGroupMembers(_orgId) { throw new Error('IGroupRepository.getGroupMembers not implemented'); }
  /** Group memberships waiting for this user to accept. */
  async getPendingMemberships(_userId) { throw new Error('IGroupRepository.getPendingMemberships not implemented'); }

  // ---- groups & admins ----
  async createSubgroup(_parentOrgId, _name, _orgType, _adminEmail) { throw new Error('IGroupRepository.createSubgroup not implemented'); }
  async nominateGroupAdmin(_orgId, _email) { throw new Error('IGroupRepository.nominateGroupAdmin not implemented'); }
  async respondToMembership(_membershipId, _accept) { throw new Error('IGroupRepository.respondToMembership not implemented'); }
  async removeMembership(_membershipId) { throw new Error('IGroupRepository.removeMembership not implemented'); }
  /** @param {'active'|'suspended'} _status — cascades to the branch below */
  async setGrantStatus(_grantId, _status) { throw new Error('IGroupRepository.setGrantStatus not implemented'); }

  // ---- rate limit (root only) ----
  async setDailyAddLimit(_limit) { throw new Error('IGroupRepository.setDailyAddLimit not implemented'); }
  async setGroupDailyLimit(_orgId, _limit) { throw new Error('IGroupRepository.setGroupDailyLimit not implemented'); }

  // ---- adding athletes ----
  /** @param {{organisationId, email, fullName, dateOfBirth, guardianEmails}} _athlete
   *  @returns {Promise<{data: {user_id, new_account, pending_guardians}, error}>} */
  async addAthlete(_athlete) { throw new Error('IGroupRepository.addAthlete not implemented'); }
}
