import { supabase } from '../supabaseClient'

export const getProfile = async (userId) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()
  return { data, error }
}

export const createProfile = async (userId, email, fullName) => {
  const { data, error } = await supabase
    .from('users')
    .insert({ id: userId, email, full_name: fullName })
    .select()
    .single()
  return { data, error }
}

export const getMemberships = async (userId) => {
  const { data, error } = await supabase
    .from('memberships')
    .select(`
      id,
      role,
      status,
      organisations (
        id,
        name,
        org_type
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
  return { data, error }
}