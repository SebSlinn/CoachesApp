//services/users.js
// Same exported function names/signatures as before — hooks/useAuth.js is
// untouched by this refactor. This file no longer touches supabaseClient.js
// directly, it goes through IMembershipRepository via the RepositoryFactory.
import { getMembershipRepository } from '../repositories/RepositoryFactory'

export const getProfile = async (userId) => {
  return getMembershipRepository().getProfile(userId)
}

export const createProfile = async (userId, email, fullName) => {
  return getMembershipRepository().createProfile(userId, email, fullName)
}

// The signed-in user's memberships (my_memberships()): active, pending and
// awaiting-guardian rows with effective capabilities. userId is optional.
export const getMemberships = async (userId) => {
  return getMembershipRepository().getMemberships(userId)
}

// Display names for a list of user ids → { data: { [userId]: name } }.
// For "Added by" on set results: resolve created_by to a readable coach name.
export const getDisplayNames = async (ids) => {
  return getMembershipRepository().displayNames(ids)
}

// Update the signed-in user's own profile — { publicName, fullName }. RLS limits
// this to the caller's own row.
export const updateProfile = async (userId, changes) => {
  return getMembershipRepository().updateProfile(userId, changes)
}

// About me: { has_date_of_birth, is_junior, is_adult, juniors_missing_date_of_birth }
export const getAccountStatus = async () => getMembershipRepository().getAccountStatus()

// My own date of birth → 'YYYY-MM-DD' or null. Only I and a guardian can read it.
export const getMyDateOfBirth = async () => getMembershipRepository().getMyDateOfBirth()

// My date of birth, once ('YYYY-MM-DD'). Private: only I and a guardian can read it;
// coaches see my age. Optional for adults — needed to be a guardian.
export const setMyDateOfBirth = async (pDate) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pDate || '')) return { data: null, error: { message: 'INVALID: choose a date' } }
  return getMembershipRepository().setMyDateOfBirth(pDate)
}
