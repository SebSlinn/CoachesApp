//repositories/interfaces/ILogSharingRepository.js
// Contract for who can read / add to / edit an athlete's log, including
// guardians of under-18s. Today the only implementation is
// SupabaseLogSharingRepository (the `log_permissions` table + RPCs).
//
// Every method resolves to { data, error } — never throws.

export class ILogSharingRepository {
  /** Active and pending permissions on one athlete's log, with grantee names. */
  async getPermissionsForOwner(_ownerId) { throw new Error('ILogSharingRepository.getPermissionsForOwner not implemented'); }
  /** Logs shared with this user (incl. pending guardianships), with owner names. */
  async getSharedWithMe(_userId) { throw new Error('ILogSharingRepository.getSharedWithMe not implemented'); }
  /** @returns {Promise<{data: boolean, error}>} */
  async canManageSharing(_ownerId) { throw new Error('ILogSharingRepository.canManageSharing not implemented'); }

  /** @param {{read: boolean, add: boolean, edit: boolean}} _access
   *  @param {string|null} _expiresAt ISO timestamp */
  async share(_ownerId, _granteeEmail, _access, _expiresAt) { throw new Error('ILogSharingRepository.share not implemented'); }
  async revoke(_permissionId) { throw new Error('ILogSharingRepository.revoke not implemented'); }

  async nominateGuardian(_juniorId, _guardianEmail) { throw new Error('ILogSharingRepository.nominateGuardian not implemented'); }
  async respondToGuardianship(_permissionId, _accept) { throw new Error('ILogSharingRepository.respondToGuardianship not implemented'); }
}
