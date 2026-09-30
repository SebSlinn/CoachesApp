import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { signOut } from '../services/auth'
import { useNavigate } from 'react-router-dom'
import { getLogsSharedWithMe } from '../services/logSharing'

export default function Dashboard() {
  const { user, profile, isAdmin, isCoach, isManager, isAthlete, memberships } = useAuth()
  const navigate = useNavigate()

  // Athletes I can load: myself, plus everyone whose log is shared with me —
  // which is how a parent's children appear (as guardianships), whether or not
  // they're in any organisation.
  const [sharedAthletes, setSharedAthletes] = useState([])
  useEffect(() => {
    if (!user) return
    let mCancelled = false
    getLogsSharedWithMe(user.id).then(({ data }) => {
      if (mCancelled) return
      const mActive = (data || []).filter((p) => p.status === 'active' && p.can_read !== false)
      setSharedAthletes(mActive)
    })
    return () => { mCancelled = true }
  }, [user])

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
        <button onClick={handleSignOut}>Sign Out</button>
      </div>

      <p>Welcome back, <strong>{profile?.full_name || user?.email}</strong></p>

      {/* Role badges */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {isAdmin && <span style={{ background: '#fee', color: '#c00', padding: '2px 10px', borderRadius: 12, fontSize: 13 }}>Admin</span>}
        {isCoach && <span style={{ background: '#efe', color: '#060', padding: '2px 10px', borderRadius: 12, fontSize: 13 }}>Coach</span>}
        {isManager && <span style={{ background: '#eef', color: '#006', padding: '2px 10px', borderRadius: 12, fontSize: 13 }}>Manager</span>}
        {isAthlete && <span style={{ background: '#fff8e1', color: '#856404', padding: '2px 10px', borderRadius: 12, fontSize: 13 }}>Athlete</span>}
        {memberships.length === 0 && <span style={{ color: '#999', fontSize: 13 }}>No organisation memberships yet</span>}
      </div>

      {/* Navigation cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
        <DashCard title="Training Classifier" desc="Build and analyse training sets" onClick={() => navigate('/classifier')} />
        <DashCard title="Athlete Setup" desc="Manage athlete profiles and times" onClick={() => navigate('/athlete-setup')} />
        <DashCard title="Set Builder" desc="Create and edit training sessions" onClick={() => navigate('/set-builder')} />
        {isCoach && <DashCard title="My Groups" desc="Manage your squads" onClick={() => navigate('/groups')} />}
        {isCoach && <DashCard title="My Athletes" desc="View athlete profiles" onClick={() => navigate('/athletes')} />}
        {isManager && <DashCard title="Manage Invitations" desc="Issue and track invites" onClick={() => navigate('/admin/invites')} />}
        {isAdmin && <DashCard title="Organisations" desc="Manage clubs and bodies" onClick={() => navigate('/admin/orgs')} />}
      </div>

      {/* My Athletes — load one into the coaching tools with a click */}
      <div style={{ marginTop: 32 }}>
        <h3>My Athletes</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AthleteRow
            name={(profile?.full_name || user?.email || 'Me') + ' (me)'}
            onLoad={() => loadAthlete(user?.id, profile?.full_name || user?.email || 'Me')}
          />
          {sharedAthletes.map((p) => (
            <AthleteRow
              key={p.id}
              name={p.owner?.full_name || p.owner?.email || 'Athlete'}
              tag={p.is_guardian ? 'guardian' : 'shared'}
              onLoad={() => loadAthlete(p.owner_user_id, p.owner?.full_name || p.owner?.email || 'Athlete')}
            />
          ))}
        </div>
        {sharedAthletes.length === 0 && (
          <p style={{ color: '#999', fontSize: 13, marginTop: 8 }}>
            No athletes shared with you yet. Children you're guardian for, and any log shared with you, appear here.
          </p>
        )}
      </div>

      {/* Memberships */}
      {memberships.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3>Your Organisations</h3>
          {memberships.map(m => (
            <div key={m.id} style={{ padding: '10px 16px', border: '1px solid #eee', borderRadius: 8, marginBottom: 8 }}>
              <strong>{m.organisations?.name}</strong>
              <span style={{ marginLeft: 12, color: '#666', fontSize: 13 }}>{m.role} · {m.organisations?.org_type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AthleteRow({ name, tag, onLoad }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', border: '1px solid #eee', borderRadius: 8 }}>
      <strong>{name}</strong>
      {tag && <span style={{ background: '#eef', color: '#006', padding: '1px 9px', borderRadius: 10, fontSize: 12 }}>{tag}</span>}
      <span style={{ flex: 1 }} />
      <button onClick={onLoad}>Load</button>
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