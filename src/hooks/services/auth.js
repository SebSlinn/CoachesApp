import { supabase } from '../supabaseClient'

export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email, password })

export const signOut = () =>
  supabase.auth.signOut()

export const getSession = () =>
  supabase.auth.getSession()

export const onAuthChange = (callback) =>
  supabase.auth.onAuthStateChange(callback)