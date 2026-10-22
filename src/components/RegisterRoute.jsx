// components/RegisterRoute.jsx — ProtectedRoute for the register screens, which must work with no signal.
// With no signal Supabase can't refresh an expired sign-in token, so useAuth says "signed out"
// (after retrying for up to ~30 s). If this phone was readied for poolside and the person is still
// signed in on it, show the register anyway; taps wait on the phone and sync once signal and
// sign-in are back. Signing out of SwimZone removes the stored session, so this stops working.
import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { canUseOffline } from '../services/registersOffline'

const WAIT_MS = 3000   // Wi-Fi with no internet still says "online": don't wait for Supabase's retries

export default function RegisterRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const offlineOk = canUseOffline()
  const noSignal = typeof navigator !== 'undefined' && navigator.onLine === false
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    if (!loading) return undefined
    const t = setTimeout(() => setWaited(true), WAIT_MS)
    return () => clearTimeout(t)
  }, [loading])

  if (user) return children
  if (offlineOk && (noSignal || waited || !loading)) return children
  if (loading) return <div style={{ padding: 24, fontFamily: 'sans-serif' }}>Loading…</div>
  return <Navigate to="/login" replace state={{ from: location.pathname }} />
}
