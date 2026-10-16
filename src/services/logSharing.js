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
// Accepting needs the child's date of birth ('YYYY-MM-DD') when none is on record.
export const respondToGuardianship = async (pPermissionId, pAccept, pDateOfBirth = null) =>
  repo().respondToGuardianship(pPermissionId, !!pAccept, pDateOfBirth || null)
// A guardian adds their child's date of birth, once (must be under 18).
export const setJuniorDateOfBirth = async (pJuniorId, pDate) => repo().setJuniorDateOfBirth(pJuniorId, pDate)

export { parseAccountError, errorText } from './accountErrors'
