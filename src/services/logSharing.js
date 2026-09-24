//services/logSharing.js
// Who can read / add to / edit an athlete's log, and guardians of under-18s.
// Goes through ILogSharingRepository via the RepositoryFactory.
// Rules enforced by the database: adults manage their own sharing, an
// under-18's sharing is managed by their guardian(s), nobody bypasses it.
import { getLogSharingRepository } from '../repositories/RepositoryFactory'

const repo = () => getLogSharingRepository()

const cleanEmail = (pEmail) => (pEmail || '').trim().toLowerCase()

// App rule: add or edit implies read.
export function normaliseAccess(pAccess = {}) {
  const mAdd = !!pAccess.add
  const mEdit = !!pAccess.edit
  return { read: !!pAccess.read || mAdd || mEdit, add: mAdd, edit: mEdit }
}

export const getLogPermissions = async (pOwnerId) => repo().getPermissionsForOwner(pOwnerId)
export const getLogsSharedWithMe = async (pUserId) => repo().getSharedWithMe(pUserId)
export const canManageLogSharing = async (pOwnerId) => repo().canManageSharing(pOwnerId)

// pAccess: { read, add, edit }. pExpiresAt: optional ISO timestamp.
export const shareLog = async (pOwnerId, pGranteeEmail, pAccess = { read: true }, pExpiresAt = null) => {
  const mAccess = normaliseAccess(pAccess)
  if (!mAccess.read) return { data: null, error: { message: 'INVALID: choose at least one of read, add or edit' } }
  return repo().share(pOwnerId, cleanEmail(pGranteeEmail), mAccess, pExpiresAt)
}

export const revokeLogPermission = async (pPermissionId) => repo().revoke(pPermissionId)

export const nominateGuardian = async (pJuniorId, pGuardianEmail) =>
  repo().nominateGuardian(pJuniorId, cleanEmail(pGuardianEmail))

export const respondToGuardianship = async (pPermissionId, pAccept) =>
  repo().respondToGuardianship(pPermissionId, !!pAccept)
