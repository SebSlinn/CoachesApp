import { useCallback, useEffect, useState } from 'react'
import { onAuthChange, getSession } from '../services/auth'
import { getProfile, createProfile, getMemberships } from '../services/users'
import { hasCapability } from '../services/groupLabels'

// Who am I, and what can I do?
//   memberships  my_memberships() rows: active, pending and awaiting-guardian, one per role per group,
//                each with effective manage_members / read_results / add_results / is_staff
//   can(cap)     true if any ACTIVE membership gives it: 'manage_members' | 'read_results' | 'add_results' | 'staff'
//   isCoach      kept for older callers: can('add_results') via a staff role
// Roles are data (group_roles), so screens ask about capabilities, never role names.
export function useAuth() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [memberships, setMemberships] = useState([])
  const [loading, setLoading] = useState(true)

  const loadMemberships = useCallback(async () => {
    const { data: mem } = await getMemberships()
    setMemberships(mem || [])
  }, [])

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

    await loadMemberships()
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

  const can = (pCap) => hasCapability(memberships, pCap)
  const isCoach = memberships.some((m) => m.status === 'active' && m.is_staff && m.add_results)

  return { user, profile, memberships, loading, can, isCoach, refreshMemberships: loadMemberships }
}
