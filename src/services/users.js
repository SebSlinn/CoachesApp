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
