// Contract for who can see an athlete's log outside groups — guardians of
// under-18s — and the list of athletes the signed-in user can load.
// (Personal shares were retired 2026-10-15: groups replace them.)
// Today the only implementation is SupabaseLogSharingRepository.
//
// Every method resolves to { data, error } — never throws.

export class ILogSharingRepository {
  /** Athletes I can load: my juniors (guardian) and members of my groups I can read or add to. */
  async getLoadableAthletes() { throw new Error('ILogSharingRepository.getLoadableAthletes not implemented'); }
  /** Guardians (active and pending) of one athlete, with names. */
  async getGuardians(_ownerId) { throw new Error('ILogSharingRepository.getGuardians not implemented'); }
  /** @returns {Promise<{data: boolean, error}>} */
  async canManageSharing(_ownerId) { throw new Error('ILogSharingRepository.canManageSharing not implemented'); }
  async revoke(_permissionId) { throw new Error('ILogSharingRepository.revoke not implemented'); }
  async nominateGuardian(_juniorId, _guardianEmail) { throw new Error('ILogSharingRepository.nominateGuardian not implemented'); }
  async respondToGuardianship(_permissionId, _accept) { throw new Error('ILogSharingRepository.respondToGuardianship not implemented'); }
}
