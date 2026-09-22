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

export const getMemberships = async (userId) => {
  return getMembershipRepository().getMemberships(userId)
}
