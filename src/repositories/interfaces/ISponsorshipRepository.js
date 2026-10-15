// Contract for sponsorship: who may bring NEW people into SwimZone, the tree of
// sponsored groups (suspending cascades down a branch), daily limits, and
// adding a new person through the add-athlete Edge Function.
// Today the only implementation is SupabaseSponsorshipRepository.
//
// Every method resolves to { data, error } — never throws.

export class ISponsorshipRepository {
  /** @returns {Promise<{data: boolean, error}>} */
  async canSponsor() { throw new Error('ISponsorshipRepository.canSponsor not implemented'); }
  /** @returns {Promise<{data: boolean, error}>} */
  async isRoot() { throw new Error('ISponsorshipRepository.isRoot not implemented'); }
  /** Sponsorships the caller can use or manage, flat (parent ids give the tree). */
  async getTree() { throw new Error('ISponsorshipRepository.getTree not implemented'); }
  /** Give sponsorship to a group, using the sponsorship of one of your groups. */
  async sponsorGroup(_sponsorOrgId, _orgId) { throw new Error('ISponsorshipRepository.sponsorGroup not implemented'); }
  /** @param {'active'|'suspended'} _status — cascades to the branch below */
  async setStatus(_sponsorshipId, _status) { throw new Error('ISponsorshipRepository.setStatus not implemented'); }
  async setDailyAddLimit(_limit) { throw new Error('ISponsorshipRepository.setDailyAddLimit not implemented'); }
  async setGroupDailyLimit(_orgId, _limit) { throw new Error('ISponsorshipRepository.setGroupDailyLimit not implemented'); }
  /** @param {{organisationId, email, fullName, dateOfBirth, guardianEmails}} _person
   *  @returns {Promise<{data: {user_id, pending_guardians}, error}>} */
  async addPerson(_person) { throw new Error('ISponsorshipRepository.addPerson not implemented'); }
  /** Root only. */
  async verifyQualification(_id, _verified) { throw new Error('ISponsorshipRepository.verifyQualification not implemented'); }
}
