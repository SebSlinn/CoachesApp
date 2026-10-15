//services/groups.js
// Groups: create, join by invite link, members, roles and capabilities,
// visibility ticks, the event log, staff qualifications.
// Goes through IGroupRepository via the RepositoryFactory; the database
// enforces every rule. Words and pure helpers live in groupLabels.js.
import { getGroupRepository } from '../repositories/RepositoryFactory'

const repo = () => getGroupRepository()
const clean = (s) => (s || '').trim()

// ---- reads ----
export const getMyMemberships = async () => repo().getMyMemberships()
export const getPendingRequests = async () => repo().getPendingRequests()
export const getGroup = async (pOrgId) => repo().getGroup(pOrgId)
export const getGroupDirectory = async (pOrgId) => repo().getDirectory(pOrgId)
export const getGroupEvents = async (pOrgId, pLimit = 100) => repo().getEvents(pOrgId, pLimit)
export const getGroupInvites = async (pOrgId) => repo().getInvites(pOrgId)
export const getRoles = async () => repo().getRoles()
// { can_manage, is_staff } — what the signed-in user may do in this group
export const getMyAccess = async (pOrgId) => repo().getMyAccess(pOrgId)

// ---- groups ----
// pGroup: { name, groupType: 'coaching'|'sharing'|'family', orgType, parentOrgId, description }
export const createGroup = async (pGroup) => {
  const mName = clean(pGroup?.name)
  if (!mName) return { data: null, error: { message: 'INVALID: group name is required' } }
  return repo().createGroup({
    name: mName, groupType: pGroup.groupType || 'coaching', orgType: pGroup.orgType || 'club',
    parentOrgId: pGroup.parentOrgId || null, description: clean(pGroup.description) || null,
  })
}

// pChanges: any of { name, description, showPublicName, showFullName, showEmail, membersSeeResults }
export const updateGroupSettings = async (pOrgId, pChanges) => repo().updateSettings(pOrgId, pChanges || {})
// Take up the group's current ticks (yourself, or your junior as guardian).
export const acceptGroupSettings = async (pOrgId, pUserId = null) => repo().acceptSettings(pOrgId, pUserId)
// pTicks: { publicName, fullName, email, results } — only as open as the group allows.
export const setMySharing = async (pOrgId, pTicks, pUserId = null) => repo().setMySharing(pOrgId, pTicks, pUserId)

// ---- invites & joining ----
// pInvite: { role, needsApproval, maxUses, expiresInDays } → { data: code }
export const createInvite = async (pOrgId, pInvite = {}) => {
  const mDays = Number(pInvite.expiresInDays)
  const mExpires = mDays > 0 ? new Date(Date.now() + mDays * 86400000).toISOString() : null
  const mMax = Number(pInvite.maxUses)
  return repo().createInvite(pOrgId, {
    role: pInvite.role || 'member', needsApproval: !!pInvite.needsApproval,
    maxUses: mMax > 0 ? Math.floor(mMax) : null, expiresAt: mExpires,
  })
}
export const revokeInvite = async (pInviteId) => repo().revokeInvite(pInviteId)
const cleanCode = (pCode) => clean(pCode).toUpperCase()
export const previewInvite = async (pCode) => repo().previewInvite(cleanCode(pCode))
export const joinGroup = async (pCode, pUserId = null) => repo().joinGroup(cleanCode(pCode), pUserId)
export const approveMembership = async (pMembershipId, pAccept) => repo().approveMembership(pMembershipId, !!pAccept)
export const approveJuniorMembership = async (pMembershipId, pAccept) => repo().approveJuniorMembership(pMembershipId, !!pAccept)

// ---- members ----
export const addMemberRole = async (pOrgId, pUserId, pRole) => repo().addMemberRole(pOrgId, pUserId, pRole)
// pValue: true / false, or null to go back to the role's default
export const setMemberCapability = async (pMembershipId, pCap, pValue) => repo().setMemberCapability(pMembershipId, pCap, pValue)
// Leave (yourself), take your junior out (guardian), or remove someone (manager).
export const removeMembership = async (pMembershipId) => repo().removeMembership(pMembershipId)

// ---- qualifications ----
export const getMyQualifications = async (pUserId) => repo().getMyQualifications(pUserId)
export const addQualification = async (pQual) => {
  const mTitle = clean(pQual?.title)
  if (!mTitle) return { data: null, error: { message: 'INVALID: a title is required' } }
  return repo().addQualification({ title: mTitle, issuer: clean(pQual.issuer) || null,
    ref: clean(pQual.ref) || null, expiresOn: pQual.expiresOn || null })
}
export const removeQualification = async (pId) => repo().removeQualification(pId)

export { parseAccountError, errorText } from './accountErrors'
