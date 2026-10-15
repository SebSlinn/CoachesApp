// Contract for groups: creating them, joining by invite link, members and their
// roles/capabilities, visibility ticks, the event log and staff qualifications.
// Today the only implementation is SupabaseGroupRepository. The rules live in
// the database (supabase/migrations/20261015120000_groups_sponsorship.sql);
// an implementation just carries requests there.
//
// Every method resolves to { data, error } — never throws.

export class IGroupRepository {
  // ---- reads ----
  /** My memberships (active, pending, awaiting guardian) with effective capabilities. */
  async getMyMemberships() { throw new Error('IGroupRepository.getMyMemberships not implemented'); }
  /** Things waiting for me: juniors' join requests, join requests to approve, guardianships offered. */
  async getPendingRequests() { throw new Error('IGroupRepository.getPendingRequests not implemented'); }
  /** One group's settings (name, description, ticks). */
  async getGroup(_orgId) { throw new Error('IGroupRepository.getGroup not implemented'); }
  /** Members as the caller may see them (hidden fields null). */
  async getDirectory(_orgId) { throw new Error('IGroupRepository.getDirectory not implemented'); }
  /** The group's event log, newest first. */
  async getEvents(_orgId, _limit) { throw new Error('IGroupRepository.getEvents not implemented'); }
  /** Invite links (managers only). */
  async getInvites(_orgId) { throw new Error('IGroupRepository.getInvites not implemented'); }
  /** { can_manage, is_staff } for the signed-in user in one group (managing includes parent groups). */
  async getMyAccess(_orgId) { throw new Error('IGroupRepository.getMyAccess not implemented'); }
  /** The role catalogue. */
  async getRoles() { throw new Error('IGroupRepository.getRoles not implemented'); }

  // ---- groups ----
  /** @param {{name, groupType, orgType, parentOrgId, description}} _group */
  async createGroup(_group) { throw new Error('IGroupRepository.createGroup not implemented'); }
  /** @param {{name, description, showPublicName, showFullName, showEmail, membersSeeResults}} _changes */
  async updateSettings(_orgId, _changes) { throw new Error('IGroupRepository.updateSettings not implemented'); }
  async acceptSettings(_orgId, _userId) { throw new Error('IGroupRepository.acceptSettings not implemented'); }
  /** @param {{publicName, fullName, email, results}} _ticks */
  async setMySharing(_orgId, _ticks, _userId) { throw new Error('IGroupRepository.setMySharing not implemented'); }

  // ---- invites & joining ----
  /** @param {{role, needsApproval, maxUses, expiresAt}} _invite → { data: code } */
  async createInvite(_orgId, _invite) { throw new Error('IGroupRepository.createInvite not implemented'); }
  async revokeInvite(_inviteId) { throw new Error('IGroupRepository.revokeInvite not implemented'); }
  async previewInvite(_code) { throw new Error('IGroupRepository.previewInvite not implemented'); }
  /** Join yourself, or (as guardian) your junior. → { data: membershipId } */
  async joinGroup(_code, _userId) { throw new Error('IGroupRepository.joinGroup not implemented'); }
  async approveMembership(_membershipId, _accept) { throw new Error('IGroupRepository.approveMembership not implemented'); }
  async approveJuniorMembership(_membershipId, _accept) { throw new Error('IGroupRepository.approveJuniorMembership not implemented'); }

  // ---- members ----
  async addMemberRole(_orgId, _userId, _role) { throw new Error('IGroupRepository.addMemberRole not implemented'); }
  /** @param {'manage_members'|'read_results'|'add_results'} _cap  @param {boolean|null} _value null = role default */
  async setMemberCapability(_membershipId, _cap, _value) { throw new Error('IGroupRepository.setMemberCapability not implemented'); }
  async removeMembership(_membershipId) { throw new Error('IGroupRepository.removeMembership not implemented'); }

  // ---- qualifications (own) ----
  async getMyQualifications(_userId) { throw new Error('IGroupRepository.getMyQualifications not implemented'); }
  /** @param {{title, issuer, ref, expiresOn}} _qual */
  async addQualification(_qual) { throw new Error('IGroupRepository.addQualification not implemented'); }
  async removeQualification(_id) { throw new Error('IGroupRepository.removeQualification not implemented'); }
}
