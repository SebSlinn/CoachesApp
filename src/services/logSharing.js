//services/logSharing.js
// Who can load an athlete, outside the athlete themself: guardians of under-18s,
// and staff/members of their groups (groups replaced personal shares 2026-10-15).
// Goes through ILogSharingRepository via the RepositoryFactory.
import { getLogSharingRepository } from '../repositories/RepositoryFactory'

const repo = () => getLogSharingRepository()
const cleanEmail = (pEmail) => (pEmail || '').trim().toLowerCase()

// [{ athlete_id, name, relation: 'guardian'|'group', via, can_read, can_add, is_junior }]
export const getLoadableAthletes = async () => repo().getLoadableAthletes()
// Kept for callers of the old name; same list.
export const getLogsSharedWithMe = async () => getLoadableAthletes()

export const getGuardians = async (pOwnerId) => repo().getGuardians(pOwnerId)
export const canManageLogSharing = async (pOwnerId) => repo().canManageSharing(pOwnerId)
export const revokeLogPermission = async (pPermissionId) => repo().revoke(pPermissionId)
export const nominateGuardian = async (pJuniorId, pGuardianEmail) =>
  repo().nominateGuardian(pJuniorId, cleanEmail(pGuardianEmail))
export const respondToGuardianship = async (pPermissionId, pAccept) =>
  repo().respondToGuardianship(pPermissionId, !!pAccept)

export { parseAccountError, errorText } from './accountErrors'
