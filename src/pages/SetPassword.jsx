//pages/SetPassword.jsx
// Where invitation and password-reset emails land. The link signs the user
// in (Supabase reads the token from the address automatically); this page
// then lets them choose a password so they can log in normally afterwards.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSession, onAuthChange, setPassword } from '../services/auth'

export default function SetPassword() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('checking')   // checking | ready | no-session | saving | done
  const [email, setEmail] = useState('')
  const [txtPassword, setTxtPassword] = useState('')
  const [txtConfirm, setTxtConfirm] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    let mSettled = false
    const accept = (pSession) => {
      if (pSession?.user) {
        mSettled = true
        setEmail(pSession.user.email || '')
        setStatus((s) => (s === 'checking' || s === 'no-session' ? 'ready' : s))
      }
    }
    const { data: listener } = onAuthChange((_event, pSession) => accept(pSession))
    getSession().then(({ data }) => accept(data?.session))
    // The token in the link is processed asynchronously; give it a moment.
    const mTimer = setTimeout(() => { if (!mSettled) setStatus('no-session') }, 3000)
    return () => { clearTimeout(mTimer); listener.subscription.unsubscribe() }
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (txtPassword !== txtConfirm) { setError('The two passwords don\'t match.'); return }
    setStatus('saving')
    const { error: mError } = await setPassword(txtPassword)
    if (mError) { setError(mError.message); setStatus('ready'); return }
    setStatus('done')
    setTimeout(() => navigate('/dashboard'), 1200)
  }

  return (
    <div style={{ maxWidth: 400, margin: '100px auto', padding: 24 }}>
      <h2>Set your SwimZone password</h2>

      {status === 'checking' && <p>Checking your link…</p>}

      {status === 'no-session' && (
        <>
          <p>This link has expired or has already been used.</p>
          <p>Go to the login page and use <strong>Forgot password?</strong> to get a new one.</p>
          <button style={{ width: '100%', padding: 10 }} onClick={() => navigate('/login')}>Go to login</button>
        </>
      )}

      {(status === 'ready' || status === 'saving') && (
        <form onSubmit={submit}>
          {email && <p style={{ color: '#999' }}>Signed in as {email}</p>}
          <div style={{ marginBottom: 12 }}>
            <input type="password" placeholder="New password (at least 8 characters)" value={txtPassword}
              onChange={(e) => setTxtPassword(e.target.value)} required minLength={8}
              autoComplete="new-password" style={{ width: '100%', padding: 8 }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <input type="password" placeholder="Type it again" value={txtConfirm}
              onChange={(e) => setTxtConfirm(e.target.value)} required minLength={8}
              autoComplete="new-password" style={{ width: '100%', padding: 8 }} />
          </div>
          {error && <p style={{ color: 'red' }}>{error}</p>}
          <button type="submit" disabled={status === 'saving'} style={{ width: '100%', padding: 10 }}>
            {status === 'saving' ? 'Saving…' : 'Set password'}
          </button>
        </form>
      )}

      {status === 'done' && <p>Password set. Taking you to SwimZone…</p>}
    </div>
  )
}
