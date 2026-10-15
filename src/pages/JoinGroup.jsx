// pages/JoinGroup.jsx — /join/:code
// What an invite link opens. Shows the group before you join: who the staff are,
// their qualifications, what each of them can do, and what other members will
// see of you. Then join yourself, or — as a guardian — join your child.
// Talks only to services/groups.js and services/logSharing.js.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { previewInvite, joinGroup, getMyMemberships, errorText } from '../services/groups'
import { getLoadableAthletes } from '../services/logSharing'
import { GROUP_TYPE_LABEL, ORG_TYPE_LABEL, describeCapabilities, describeVisibility, statusText } from '../services/groupLabels'
import { S, Badge, Message, useAction } from '../components/AccountsUi'

export default function JoinGroup() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { profile, memberships, refreshMemberships } = useAuth()
  const [preview, setPreview] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [juniors, setJuniors] = useState([])
  const [done, setDone] = useState({})   // userId|'me' → status text
  const act = useAction()

  useEffect(() => {
    let cancelled = false
    previewInvite(code).then(({ data, error }) => {
      if (cancelled) return
      if (error) setLoadError(errorText(error)); else setPreview(data)
    })
    getLoadableAthletes().then(({ data }) => {
      if (!cancelled) setJuniors((data || []).filter((a) => a.relation === 'guardian' && a.is_junior))
    })
    return () => { cancelled = true }
  }, [code])

  const alreadyIn = useMemo(() => preview && memberships.find((m) => m.org_id === preview.org_id && m.role === preview.role), [preview, memberships])
  const iAmJunior = profile?.date_of_birth && new Date(profile.date_of_birth) > new Date(new Date().setFullYear(new Date().getFullYear() - 18))

  const join = async (pUserId, pKey) => {
    const r = await act.run(() => joinGroup(code, pUserId), null, errorText)
    if (!r) return
    let status
    if (pUserId) status = preview.needs_approval ? 'pending' : 'active'
    else {
      const { data } = await getMyMemberships()
      status = (data || []).find((m) => m.membership_id === r.data)?.status || 'active'
      await refreshMemberships()
    }
    setDone({ ...done, [pKey]: status })
  }

  if (loadError) return (
    <div style={S.page}>
      <div style={S.head}><h2 style={S.h2}>Join a group</h2><button style={S.btn} onClick={() => navigate('/dashboard')}>Dashboard</button></div>
      <p>{loadError}</p>
    </div>
  )
  if (!preview) return <div style={S.page}><p style={S.muted}>Loading…</p></div>

  const outcome = (s) => s === 'active' ? 'In — welcome.' : s === 'pending' ? 'Asked — a Team Manager will approve it.'
    : s === 'awaiting_guardian' ? 'Asked — your guardian needs to approve it on their Dashboard.' : statusText(s)

  return (
    <div style={S.page}>
      <div style={S.head}>
        <div>
          <h2 style={S.h2}>Join {preview.name}</h2>
          <div style={S.muted}>{GROUP_TYPE_LABEL[preview.group_type]} · {ORG_TYPE_LABEL[preview.org_type] || preview.org_type}</div>
        </div>
        <button style={S.btn} onClick={() => navigate('/dashboard')}>Dashboard</button>
      </div>
      {preview.description && <p>{preview.description}</p>}

      <div style={S.card}>
        <div style={S.row}><span>You're invited as</span><Badge kind="role">{preview.role_label}</Badge>
          {preview.needs_approval && <span style={S.muted}>— a Team Manager approves each person</span>}</div>
      </div>

      <h3 style={S.h3}>Staff</h3>
      {preview.staff.length === 0 && <p style={S.muted}>No staff yet.</p>}
      {preview.staff.map((s, i) => (
        <div key={i} style={S.card}>
          <div style={S.row}>
            <strong>{s.full_name || s.public_name}</strong>
            <Badge kind="staff">{s.role_label}</Badge>
            <span style={S.muted}>{describeCapabilities(s) || 'no access to results'}</span>
          </div>
          {s.qualifications.length > 0 && (
            <div style={{ ...S.small, marginTop: 6 }}>
              {s.qualifications.map((q, j) => (
                <div key={j}>
                  {q.title}{q.issuer ? ` (${q.issuer})` : ''}{q.expires_on ? `, until ${new Date(q.expires_on).toLocaleDateString()}` : ''}
                  {' '}{q.verified ? <Badge kind="staff">verified</Badge> : <span style={S.muted}>self-declared</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <h3 style={S.h3}>What's shared</h3>
      <div style={S.card}>
        <p style={{ ...S.small, margin: 0 }}>{describeVisibility(preview.visibility)}</p>
        <p style={S.muted}>Staff see members' full names and emails. You can leave at any time, and staff lose access when you do. Every change to who can do what is logged for all members to see.</p>
      </div>

      <h3 style={S.h3}>Join</h3>
      <div style={S.card}>
        <div style={S.row}>
          <strong>{profile?.full_name || 'Me'}</strong>
          <span style={{ flex: 1 }} />
          {alreadyIn ? <span style={S.muted}>{alreadyIn.status === 'active' ? 'Already in.' : statusText(alreadyIn.status)}</span>
            : done.me ? <span style={S.ok}>{outcome(done.me)}</span>
            : <button style={S.primary} disabled={act.busy} onClick={() => join(null, 'me')}>Join</button>}
        </div>
        {iAmJunior && !alreadyIn && !done.me && <p style={S.muted}>You're under 18, so your guardian will be asked to approve.</p>}
        {juniors.map((j) => (
          <div key={j.athlete_id} style={{ ...S.row, marginTop: 8 }}>
            <span>{j.name}</span><Badge kind="warn">your child</Badge>
            <span style={{ flex: 1 }} />
            {done[j.athlete_id] ? <span style={S.ok}>{outcome(done[j.athlete_id])}</span>
              : <button style={S.btn} disabled={act.busy} onClick={() => join(j.athlete_id, j.athlete_id)}>Join for {j.name.split(' ')[0]}</button>}
          </div>
        ))}
        <Message error={act.error} />
      </div>
      {(alreadyIn || Object.values(done).includes('active')) && (
        <button style={S.btn} onClick={() => navigate('/groups/' + preview.org_id)}>Go to the group</button>
      )}
    </div>
  )
}
