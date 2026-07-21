import { useEffect, useState } from 'react'
import { onAuthChange, getSession } from '../services/auth'
import { getProfile, createProfile, getMemberships } from '../services/users'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [memberships, setMemberships] = useState([])
  const [loading, setLoading] = useState(true)

  const loadUserData = async (authUser) => {
    if (!authUser) {
      setUser(null)
      setProfile(null)
      setMemberships([])
      setLoading(false)
      return
    }
    setUser(authUser)

    // Get or create profile
    let { data: prof } = await getProfile(authUser.id)
    if (!prof) {
      const { data: newProf } = await createProfile(
        authUser.id,
        authUser.email,
        authUser.user_metadata?.full_name || ''
      )
      prof = newProf
    }
    setProfile(prof)

    // Get memberships and roles
    const { data: mem } = await getMemberships(authUser.id)
    setMemberships(mem || [])
    setLoading(false)
  }

  useEffect(() => {
    getSession().then(({ data }) => {
      loadUserData(data.session?.user ?? null)
    })

    const { data: listener } = onAuthChange((_event, session) => {
      loadUserData(session?.user ?? null)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // Helper — does this user have a role anywhere
  const hasRole = (role) => memberships.some(m => m.role === role)

  const isAdmin = hasRole('admin')
  const isCoach = hasRole('coach')
  const isManager = hasRole('manager')
  const isAthlete = hasRole('athlete')

  return { user, profile, memberships, loading, isAdmin, isCoach, isManager, isAthlete }
}