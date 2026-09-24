//services/auth.js
// Same exported function names/signatures as before — hooks/useAuth.js,
// pages/Login.jsx and pages/Dashboard.jsx are untouched by this refactor.
// The only change: this file no longer touches supabaseClient.js directly,
// it goes through IAuthRepository via the RepositoryFactory.
import { getAuthRepository } from '../repositories/RepositoryFactory'

export const signIn = async (email, password) => {
  return getAuthRepository().signInWithPassword(email, password)
}

export const signOut = async () => {
  return getAuthRepository().signOut()
}

export const getSession = async () => {
  return getAuthRepository().getSession()
}

export const onAuthChange = (callback) => {
  return getAuthRepository().onAuthStateChange(callback)
}

// Added 2026-09-24 — invitations and password resets.
export const setPassword = async (newPassword) => {
  if (!newPassword || newPassword.length < 8) {
    return { data: null, error: { message: 'Password must be at least 8 characters.' } }
  }
  return getAuthRepository().updatePassword(newPassword)
}

// The reset link lands on this app's /set-password page.
export const requestPasswordReset = async (email) => {
  return getAuthRepository().sendPasswordReset(
    (email || '').trim().toLowerCase(),
    `${window.location.origin}/set-password`
  )
}
