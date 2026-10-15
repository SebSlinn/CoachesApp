import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { signOut } from '../services/auth'
import { useNavigate } from 'react-router-dom'
import { getLoadableAthletes, respondToGuardianship } from '../services/logSharing'
import { getPendingRequests, approveMembership, approveJuniorMembership, errorText } from '../services/groups'
import { canSponsor as fetchCanSponsor } from '../services/sponsorship'
import { GROUP_TYPE_LABEL, groupsFromMemberships, statusText } from '../services/groupLabels'
import { S, Badge, Message, useAction } from '../components/AccountsUi'

export default function Dashboard() {
  const { user, profile, memberships, refreshMemberships } = useAuth()
  const navigate = useNavigate()
  const groups = useMemo(() => groupsFromMemberships(memberships), [memberships])

  // Athletes I can load: myself, my children (guardian), and members of my groups
  // whose results I can read (or, as a Poolside Assistant, only add to).
  const [athletes, setAthletes] = useState([])
  const [requests, setRequests] = useState([])
  const [canSponsor, setCanSponsor] = useState(false)

  const load = useCallback(async () => {
    const [a, r, c] = await Promise.all([getLoadableAthletes(), getPendingRequests(), fetchCanSponsor()])
    setAthletes(a.data || []); setRequests(r.data || []); setCanSponsor(!!c.data)
  }, [])
  useEffect(() => { if (user) load() }, [user, load])

  // Hand the athlete off to Athlete Setup, which pre-fills from their records.
  const loadAthlete = (pAthleteId, pName) =>
    navigate('/athlete-setup', { state: { loadAthlete: { athleteId: pAthleteId, name: pName } } })

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <h2 style={{ margin: 0 }}>SwimZone</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/account')}>Account</button>
          <button onClick={handleSignOut}>Sign Out</button>
        </div>
      </div>

      <p>Welcome back, <strong>{profile?.full_name || user?.email}</strong></p>

      {requests.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3>Waiting for you</h3>
          {requests.map((r) => <RequestRow key={r.kind + r.id} r={r} onDone={async () => { await load(); await refreshMemberships() }} />)}
        </div>
      )}

      {/* Navigation cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
        <DashCard title="Training Classifier" desc="Build and analyse training sets" onClick={() => navigate('/classifier')} />
        <DashCard title="Athlete Setup" desc="Manage athlete profiles and times" onClick={() => navigate('/athlete-setup')} />
        <DashCard title="Set Builder" desc="Create and edit training sessions" onClick={() => navigate('/set-builder')} />
        <DashCard title="Groups" desc="Your clubs, squads and sharing groups" onClick={() => navigate('/groups')} />
        {canSponsor && <DashCard title="Sponsorship" desc="Bring new people into SwimZone" onClick={() => navigate('/sponsorship')} />}
      </div>

      {/* My Athletes — load one into the coaching tools with a click */}
      <div style={{ marginTop: 32 }}>
        <h3>My Athletes</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AthleteRow
            name={(profile?.full_name || user?.email || 'Me') + ' (me)'}
            onLoad={() => loadAthlete(user?.id, profile?.full_name || user?.email || 'Me')}
          />
          {athletes.map((a) => (
            <AthleteRow
              key={a.athlete_id}
              name={a.name || 'Athlete'}
              tags={[a.relation === 'guardian' ? 'your child' : a.via, !a.can_read && 'add only'].filter(Boolean)}
              onLoad={a.can_read ? () => loadAthlete(a.athlete_id, a.name || 'Athlete') : null}
            />
          ))}
        </div>
        {athletes.length === 0 && (
          <p style={{ color: '#999', fontSize: 13, marginTop: 8 }}>
            Children you're guardian for, and members of groups where you coach, appear here.
          </p>
        )}
      </div>

      {/* Groups */}
      <div style={{ marginTop: 32 }}>
        <h3>Your Groups</h3>
        {groups.length === 0 && <p style={{ color: '#999', fontSize: 13 }}>None yet. <a href="/groups" onClick={(e) => { e.preventDefault(); navigate('/groups') }}>Create or join one</a>.</p>}
        {groups.map((g) => (
          <div key={g.org_id} onClick={() => navigate('/groups/' + g.org_id)}
            style={{ padding: '10px 16px', border: '1px solid #eee', borderRadius: 8, marginBottom: 8, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{g.name}</strong>
            <span style={{ color: '#666', fontSize: 13 }}>{GROUP_TYPE_LABEL[g.group_type]}</span>
            <span style={{ flex: 1 }} />
            {g.roles.map((r) => <Badge key={r.membership_id} kind={r.is_staff ? 'staff' : 'role'}>{r.role_label}</Badge>)}
            {g.waiting && <Badge kind="warn">{statusText(g.waiting)}</Badge>}
            {g.settings_to_accept && <Badge kind="warn">new settings to review</Badge>}
          </div>
        ))}
      </div>
    </div>
  )
}

function RequestRow({ r, onDone }) {
  const act = useAction()
  const navigate = useNavigate()
  const run = (pFn) => act.run(pFn, null, errorText).then((x) => x && onDone())
  let text, yes, no
  if (r.kind === 'junior_join') {
    text = <><strong>{r.name}</strong> wants to join <strong>{r.org_name}</strong> as {r.role_label}.</>
    yes = () => run(() => approveJuniorMembership(r.id, true)); no = () => run(() => approveJuniorMembership(r.id, false))
  } else if (r.kind === 'member_approval') {
    text = <><strong>{r.name}</strong> asked to join <strong>{r.org_name}</strong> as {r.role_label}.</>
    yes = () => run(() => approveMembership(r.id, true)); no = () => run(() => approveMembership(r.id, false))
  } else {
    text = <>You've been asked to be <strong>{r.name}</strong>'s guardian.</>
    yes = () => run(() => respondToGuardianship(r.id, true)); no = () => run(() => respondToGuardianship(r.id, false))
  }
  return (
    <div style={{ ...S.card, ...S.row }}>
      <span style={S.small}>{text}</span>
      <span style={{ flex: 1 }} />
      {r.kind === 'junior_join' && <button style={S.btn} onClick={() => navigate('/groups/' + r.org_id)} title="The group's staff and what it shares">Details</button>}
      <button style={S.btn} disabled={act.busy} onClick={yes}>{r.kind === 'guardianship' ? 'Accept' : 'Approve'}</button>
      <button style={S.btn} disabled={act.busy} onClick={no}>Decline</button>
      <Message error={act.error} />
    </div>
  )
}

function AthleteRow({ name, tags = [], onLoad }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', border: '1px solid #eee', borderRadius: 8 }}>
      <strong>{name}</strong>
      {tags.map((t) => <span key={t} style={{ background: '#eef', color: '#006', padding: '1px 9px', borderRadius: 10, fontSize: 12 }}>{t}</span>)}
      <span style={{ flex: 1 }} />
      {onLoad ? <button onClick={onLoad}>Load</button> : <span style={{ color: '#999', fontSize: 12 }}>record swims in Poolside</span>}
    </div>
  )
}

function DashCard({ title, desc, onClick }) {
  return (
    <div onClick={onClick} style={{ padding: 20, border: '1px solid #eee', borderRadius: 12, cursor: 'pointer', transition: 'box-shadow 0.2s' }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#666' }}>{desc}</div>
    </div>
  )
}
