//services/sponsorship.js
// Sponsorship: who may bring NEW people into SwimZone (invite-only), the tree of
// sponsored groups, daily limits, and adding a new person. Was adminGrants.js.
// Someone who already has an account joins a group by invite link instead.
// Goes through ISponsorshipRepository via the RepositoryFactory.
import { getSponsorshipRepository } from '../repositories/RepositoryFactory'

const repo = () => getSponsorshipRepository()
const cleanEmail = (pEmail) => (pEmail || '').trim().toLowerCase()

export const canSponsor = async () => repo().canSponsor()
export const isRoot = async () => repo().isRoot()

// Flat rows → tree: [{ ...row, children: [] }]
export const getSponsorshipTree = async () => {
  const { data, error } = await repo().getTree()
  if (error) return { data: null, error }
  const mById = new Map((data || []).map((r) => [r.sponsorship_id, { ...r, children: [] }]))
  const mRoots = []
  for (const n of mById.values()) {
    const p = mById.get(n.parent_sponsorship_id)
    if (p) p.children.push(n); else mRoots.push(n)
  }
  return { data: mRoots, error: null }
}

export const sponsorGroup = async (pSponsorOrgId, pOrgId) => repo().sponsorGroup(pSponsorOrgId, pOrgId)
// Suspend / restore — cascades to the whole branch below.
export const suspendSponsorship = async (pId) => repo().setStatus(pId, 'suspended')
export const restoreSponsorship = async (pId) => repo().setStatus(pId, 'active')

// Root only
export const setDailyAddLimit = async (pLimit) => repo().setDailyAddLimit(Number(pLimit))
export const setGroupDailyLimit = async (pOrgId, pLimit) =>
  repo().setGroupDailyLimit(pOrgId, pLimit == null || pLimit === '' ? null : Number(pLimit))
export const verifyQualification = async (pId, pVerified = true) => repo().verifyQualification(pId, pVerified)

// pPerson: { organisationId, email, fullName, isJunior, guardianEmails: [] }
// No date of birth: adults add their own, a guardian adds their child's.
// Under 18 ⇒ at least one guardian (an adult already in SwimZone), and the child
// joins the group only once a guardian accepts.
export const addPerson = async (pPerson) => {
  const mJunior = !!pPerson.isJunior
  const mPerson = {
    organisationId: pPerson.organisationId,
    email: cleanEmail(pPerson.email),
    fullName: (pPerson.fullName || '').trim(),
    guardianEmails: mJunior ? (pPerson.guardianEmails || []).map(cleanEmail).filter(Boolean) : [],
  }
  if (!mPerson.email) return { data: null, error: { message: 'INVALID: email is required' } }
  if (!mPerson.fullName) return { data: null, error: { message: 'INVALID: full name is required' } }
  if (mJunior && !mPerson.guardianEmails.length) return { data: null, error: { message: 'GUARDIAN_REQUIRED: an under-18 needs a guardian' } }
  return repo().addPerson(mPerson)
}

export { parseAccountError, errorText } from './accountErrors'
