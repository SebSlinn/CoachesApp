// pages/Signup.jsx — /signup (public). A parent creates their own SwimZone account while root has
// "Open sign-up" switched on. They get an email to set a password; then they add their children
// from the Dashboard and join the club with its invite link. Talks only to services/signup.js.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSignupOpen, signUp, errorText } from '../services/signup'
import { S, Message, useAction } from '../components/AccountsUi'

const PAGE = { ...S.page, padding: 'clamp(16px, 4vw, 40px)', maxWidth: 520 }

export default function Signup() {
  const [open, setOpen] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')   // hidden: only bots fill it in
  const [done, setDone] = useState(null)
  const act = useAction()

  useEffect(() => { isSignupOpen().then((r) => setOpen(!!r.data)) }, [])

  const submit = async (e) => {
    e.preventDefault()
    const r = await act.run(() => signUp({ fullName: name, email, website }), null, errorText)
    if (r) setDone(email.trim())
  }

  return (
    <div style={PAGE}>
      <h2 style={S.h2}>Join SwimZone</h2>
      {open === null && <p style={S.muted}>Loading…</p>}
      {open === false && (
        <>
          <p>SwimZone is invite-only at the moment. Ask your club or coach for an invite.</p>
          <p><Link to="/login">Already have an account? Sign in</Link></p>
        </>
      )}
      {open && done && (
        <div style={S.card}>
          <p><strong>Check your email.</strong> We've sent a link to <strong>{done}</strong> (look in spam too). Click it and choose a password.</p>
          <Steps />
        </div>
      )}
      {open && !done && (
        <>
          <p style={S.small}>For parents and swimmers joining a club on SwimZone. You'll add your children after you've signed in.</p>
          <form onSubmit={submit} style={S.card}>
            <label style={S.label}>Your full name</label>
            <input style={{ ...S.input, width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            <label style={S.label}>Your email</label>
            <input style={{ ...S.input, width: '100%' }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            <div aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}>
              <label>Website <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
            </div>
            <div style={{ ...S.row, marginTop: 14 }}>
              <button style={S.primary} disabled={act.busy} type="submit">{act.busy ? 'Sending…' : 'Create my account'}</button>
              <Link to="/login" style={S.small}>Already have an account? Sign in</Link>
            </div>
            <Message error={act.error} />
          </form>
          <Steps />
        </>
      )}
    </div>
  )
}

function Steps() {
  return (
    <div style={{ ...S.small, marginTop: 16 }}>
      <strong>What happens next</strong>
      <ol style={{ paddingLeft: 20, lineHeight: 1.6 }}>
        <li>Open the email from SwimZone and choose a password.</li>
        <li>On the Dashboard, add your date of birth (needed to look after a child's account).</li>
        <li>Press <strong>Add my child</strong> for each child — name, date of birth and an email for them. No email? Use yours with <em>+name</em> before the @, e.g. <em>you+sam@gmail.com</em>.</li>
        <li>Open your club's invite link and choose to join yourself or your child.</li>
      </ol>
    </div>
  )
}
