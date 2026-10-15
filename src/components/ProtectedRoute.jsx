import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Signed out → /login, remembering where you were going (e.g. an invite link),
// so Login can send you back there.
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div>Loading...</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}
