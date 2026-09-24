//services/adminGrants.js
// Adding rights: groups, grants, admins, adding athletes.
// Goes through IGroupRepository via the RepositoryFactory — never touches
// supabaseClient.js. Permission rules are enforced by the database; this
// layer tidies input and turns 'CODE: message' errors into something the
// screens can show.
import { getGroupRepository } from '../repositories/RepositoryFactory'

const repo = () => getGroupRepository()

const cleanEmail = (pEmail) => (pEmail || '').trim().toLowerCase()

// ---- what can I do? ----
export const canAddUsers = async () => repo().canAddUsers()
export const isRoot = async () => repo().isRoot()

// ---- reads ----
export const getMyAdminGroups = async (pUserId) => repo().getMyAdminGroups(pUserId)
export const getGrantTree = async () => repo().getGrantTree()
export const getGroupMembers = async (pOrgId) => repo().getGroupMembers(pOrgId)
export const getMyPendingMemberships = async (pUserId) => repo().getPendingMemberships(pUserId)

// ---- groups & admins ----
export const createSubgroup = async (pParentOrgId, pName, pOrgType = 'club', pAdminEmail = null) => {
  const mName = (pName || '').trim()
  if (!mName) return { data: null, error: { message: 'INVALID: group name is required' } }
  return repo().createSubgroup(pParentOrgId, mName, pOrgType, pAdminEmail ? cleanEmail(pAdminEmail) : null)
}

export const nominateGroupAdmin = async (pOrgId, pEmail) =>
  repo().nominateGroupAdmin(pOrgId, cleanEmail(pEmail))

export const respondToMembership = async (pMembershipId, pAccept) =>
  repo().respondToMembership(pMembershipId, !!pAccept)

// Take someone out of a group, or leave one yourself. Never cascades.
export const removeMembership = async (pMembershipId) => repo().removeMembership(pMembershipId)

// Suspend / restore a group's rights — cascades to the whole branch below.
export const suspendGrant = async (pGrantId) => repo().setGrantStatus(pGrantId, 'suspended')
export const restoreGrant = async (pGrantId) => repo().setGrantStatus(pGrantId, 'active')

// ---- rate limit (root only) ----
export const setDailyAddLimit = async (pLimit) => repo().setDailyAddLimit(Number(pLimit))
// pLimit null = go back to the system-wide figure
export const setGroupDailyLimit = async (pOrgId, pLimit) =>
  repo().setGroupDailyLimit(pOrgId, pLimit == null || pLimit === '' ? null : Number(pLimit))

// ---- adding athletes ----
// pAthlete: { organisationId, email, fullName, dateOfBirth: 'YYYY-MM-DD', guardianEmails: [] }
export const addAthlete = async (pAthlete) => {
  const mAthlete = {
    organisationId: pAthlete.organisationId,
    email: cleanEmail(pAthlete.email),
    fullName: (pAthlete.fullName || '').trim(),
    dateOfBirth: pAthlete.dateOfBirth || null,
    guardianEmails: (pAthlete.guardianEmails || []).map(cleanEmail).filter(Boolean),
  }
  if (!mAthlete.email) return { data: null, error: { message: 'INVALID: email is required' } }
  return repo().addAthlete(mAthlete)
}

// ---- errors ----
const ERROR_TEXT = {
  NOT_ALLOWED: 'You don\'t have permission to do that.',
  RATE_LIMIT: 'This group has reached its daily limit. Try again tomorrow or ask the SwimZone admin.',
  GUARDIAN_REQUIRED: 'An under-18 athlete needs at least one adult athlete as guardian.',
  GUARDIAN_NOT_ADULT: 'The guardian must be an athlete aged 18 or over with a date of birth set.',
  LAST_GUARDIAN: 'An under-18 athlete must keep at least one guardian. Add another guardian first.',
  USER_NOT_FOUND: 'There\'s no SwimZone account with that email.',
}

// Turn { message: 'CODE: detail' } into { code, message, detail } for the UI.
export function parseAccountError(pError) {
  const mText = pError?.message || ''
  const mMatch = mText.match(/^([A-Z_]+):\s*([\s\S]*)$/)
  if (!mMatch) return { code: 'UNKNOWN', message: mText, detail: mText }
  const [, mCode, mDetail] = mMatch
  return { code: mCode, message: ERROR_TEXT[mCode] || mDetail, detail: mDetail }
}
