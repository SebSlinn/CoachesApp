import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signIn, requestPasswordReset } from '../services/auth'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(null)
  const navigate = useNavigate()

  const handleForgot = async () => {
    setError(null)
    setNotice(null)
    if (!email) { setError('Type your email above first, then click Forgot password.'); return }
    const { error } = await requestPasswordReset(email)
    if (error) setError(error.message)
    else setNotice(`If ${email} has a SwimZone account, a link to set a new password is on its way.`)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { error } = await signIn(email, password)
      if (error) {
        setError(error.message)
        setLoading(false)
      } else {
        navigate('/dashboard')
      }
    } catch (err) {
      setError(err.message || 'Sign-in failed unexpectedly.')
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '100px auto', padding: 24 }}>
      <h2>SwimZone Login</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: '100%', padding: 10 }}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
      <button type="button" onClick={handleForgot}
        style={{ marginTop: 12, background: 'none', border: 'none', color: '#8cf', cursor: 'pointer', padding: 0 }}>
        Forgot password?
      </button>
      {notice && <p style={{ color: '#6c6' }}>{notice}</p>}
    </div>
  )
}