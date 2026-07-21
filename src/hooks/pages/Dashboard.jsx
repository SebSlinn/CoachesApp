import { useAuth } from '../hooks/useAuth'
import { signOut } from '../services/auth'
import { useNavigate } from 'react-router-dom'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div style={{ padding: 40 }}>
      <h2>Dashboard</h2>
      <p>Welcome, {user?.email}</p>
      <button onClick={() => navigate('/classifier')} style={{ marginRight: 12 }}>
        Open Classifier
      </button>
      <button onClick={handleSignOut}>Sign Out</button>
    </div>
  )
}