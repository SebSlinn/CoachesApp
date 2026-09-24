//pages/admin/Organisations.jsx
// The adding-rights tree: every group you administer and everything below it.
//   • your own active groups  → add a sub-group, add an athlete, manage members
//   • groups below yours      → suspend / restore (cascades down that branch),
//                                manage members (e.g. replace an absent admin)
//   • invitations to you      → accept / decline
// All rules are enforced by the database; the buttons shown are just the
// ones likely to succeed. Talks only to services/adminGrants.js.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import {
  getGrantTree, getMyAdminGroups, getMyPendingMemberships, getGroupMembers,
  createSubgroup, addAthlete, nominateGroupAdmin, respondToMembership,
  removeMembership, suspendGrant, restoreGrant, parseAccountError,
} from '../../services/adminGrants'
import { getLogsSharedWithMe, respondToGuardianship } from '../../services/logSharing'

const ORG_TYPES = [
  { value: 'club', label: 'Club' },
  { value: 'governing_body', label: 'Governing body / region' },
  { value: 'private', label: 'Private (single person)' },
]
const TYPE_LABEL = { root: 'Root', club: 'Club', governing_body: 'Governing body', private: 'Private' }

const S = {
  page: { padding: 40, fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto' },
  card: { border: '1px solid #444', borderRadius: 10, padding: '12px 16px', marginBottom: 8 },
  row: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  badge: (pBg, pFg) => ({ background: pBg, color: pFg, padding: '1px 9px', borderRadius: 10, fontSize: 12 }),
  muted: { color: '#999', fontSize: 13 },
  btn: { padding: '4px 10px', fontSize: 13, cursor: 'pointer', borderRadius: 6 },
  panel: { marginTop: 10, padding: 12, border: '1px dashed #555', borderRadius: 8 },
  input: { padding: '5px 8px', fontSize: 14, borderRadius: 6, border: '1px solid #666', minWidth: 180 },
  error: { color: '#f66', fontSize: 13, marginTop: 6 },
  ok: { color: '#6c6', fontSize: 13, marginTop: 6 },
}

// Turn the flat grant list into a tree, working out what the user may do at each node.
function buildTree(pGrants, pMyOrgIds) {
  const mById = new Map(pGrants.map((g) => [g.id, { ...g, children: [] }]))
  const mRoots = []
  for (const mNode of mById.values()) {
    const mParent = mById.get(mNode.parent_grant_id)
    if (mParent) mParent.children.push(mNode)
    else mRoots.push(mNode)
  }
  const walk = (pNode, pParentEffective, pAncestorMine) => {
    pNode.effective = pParentEffective && pNode.status === 'active'
    pNode.isMine = pMyOrgIds.has(pNode.organisations?.id)
    pNode.canAct = pNode.isMine && pNode.effective
    pNode.canManageFromAbove = pAncestorMine
    pNode.children.sort((a, b) => (a.organisations?.name || '').localeCompare(b.organisations?.name || ''))
    pNode.children.forEach((c) => walk(c, pNode.effective, pAncestorMine || pNode.canAct))
  }
  mRoots.forEach((r) => walk(r, true, false))
  return mRoots
}

export default function Organisations() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [grants, setGrants] = useState([])
  const [myOrgIds, setMyOrgIds] = useState(new Set())
  const [pending, setPending] = useState([])
  const [pendingGuardianships, setPendingGuardianships] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const reload = useCallback(async () => {
    if (!user) return
    setLoadError(null)
    const [mTree, mMine, mPending, mShared] = await Promise.all([
      getGrantTree(), getMyAdminGroups(user.id), getMyPendingMemberships(user.id), getLogsSharedWithMe(user.id),
    ])
    const mError = mTree.error || mMine.error || mPending.error || mShared.error
    if (mError) setLoadError(parseAccountError(mError).message)
    setGrants(mTree.data || [])
    setMyOrgIds(new Set((mMine.data || []).filter((m) => m.status === 'active').map((m) => m.organisations?.id)))
    setPending(mPending.data || [])
    setPendingGuardianships((mShared.data || []).filter((p) => p.is_guardian && p.status === 'pending'))
    setLoading(false)
  }, [user])

  useEffect(() => { reload() }, [reload])

  const tree = useMemo(() => buildTree(grants, myOrgIds), [grants, myOrgIds])

  return (
    <div style={S.page}>
      <div style={{ ...S.row, justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>Organisations</h2>
        <button style={S.btn} onClick={() => navigate('/dashboard')}>← Dashboard</button>
      </div>

      {(pending.length > 0 || pendingGuardianships.length > 0) && (
        <div style={{ ...S.card, borderColor: '#c90', marginBottom: 24 }}>
          <strong>Invitations for you</strong>
          {pending.map((m) => (
            <PendingInvite key={m.id} membership={m} onDone={reload} />
          ))}
          {pendingGuardianships.map((p) => (
            <PendingGuardianship key={p.id} permission={p} onDone={reload} />
          ))}
        </div>
      )}

      {loading && <p style={S.muted}>Loading…</p>}
      {loadError && <p style={S.error}>{loadError}</p>}
      {!loading && tree.length === 0 && (
        <p style={S.muted}>You don't administer any groups yet. When someone makes you a group admin, the invitation appears here.</p>
      )}

      {tree.map((mNode) => <GroupNode key={mNode.id} node={mNode} depth={0} onChanged={reload} />)}

      <p style={{ ...S.muted, marginTop: 24 }}>
        Suspending a group removes adding rights from it and every group below it; restoring brings them all back.
        Removing a person from a group never affects the groups below.
      </p>
    </div>
  )
}

function PendingInvite({ membership, onDone }) {
  const [error, setError] = useState(null)
  const respond = async (pAccept) => {
    const { error: mError } = await respondToMembership(membership.id, pAccept)
    if (mError) setError(parseAccountError(mError).message)
    else onDone()
  }
  return (
    <div style={{ ...S.row, marginTop: 8 }}>
      <span>
        <strong>{membership.organisations?.name}</strong>{' '}
        <span style={S.muted}>asks you to be {membership.role === 'admin' ? 'an admin' : `a ${membership.role}`}</span>
      </span>
      <button style={S.btn} onClick={() => respond(true)}>Accept</button>
      <button style={S.btn} onClick={() => respond(false)}>Decline</button>
      {error && <span style={S.error}>{error}</span>}
    </div>
  )
}

function PendingGuardianship({ permission, onDone }) {
  const [error, setError] = useState(null)
  const respond = async (pAccept) => {
    const { error: mError } = await respondToGuardianship(permission.id, pAccept)
    if (mError) setError(parseAccountError(mError).message)
    else onDone()
  }
  return (
    <div style={{ ...S.row, marginTop: 8 }}>
      <span>
        Be guardian for <strong>{permission.owner?.full_name || 'an athlete'}</strong>{' '}
        <span style={S.muted}>— full access to their log, and you decide who else can see it</span>
      </span>
      <button style={S.btn} onClick={() => respond(true)}>Accept</button>
      <button style={S.btn} onClick={() => respond(false)}>Decline</button>
      {error && <span style={S.error}>{error}</span>}
    </div>
  )
}

function GroupNode({ node, depth, onChanged }) {
  const [panel, setPanel] = useState(null)        // 'subgroup' | 'athlete' | 'members' | null
  const [error, setError] = useState(null)
  const mOrg = node.organisations || {}
  const toggle = (pName) => setPanel(panel === pName ? null : pName)

  const changeStatus = async () => {
    const mSuspending = node.status === 'active'
    if (mSuspending && !window.confirm(`Suspend ${mOrg.name}? It and every group below it will lose adding rights until restored.`)) return
    const { error: mError } = mSuspending ? await suspendGrant(node.id) : await restoreGrant(node.id)
    if (mError) setError(parseAccountError(mError).message)
    else { setError(null); onChanged() }
  }

  return (
    <div style={{ marginLeft: depth * 24 }}>
      <div style={{ ...S.card, opacity: node.effective ? 1 : 0.6 }}>
        <div style={S.row}>
          <strong>{mOrg.name}</strong>
          <span style={S.badge('#333', '#ccc')}>{TYPE_LABEL[mOrg.org_type] || mOrg.org_type}</span>
          {node.isMine && <span style={S.badge('#123', '#8cf')}>you're admin</span>}
          {node.status === 'suspended' && <span style={S.badge('#400', '#f99')}>suspended</span>}
          {node.status === 'active' && !node.effective && <span style={S.badge('#330', '#dd8')}>suspended above</span>}
          <span style={{ flex: 1 }} />
          {node.canAct && <button style={S.btn} onClick={() => toggle('subgroup')}>+ Sub-group</button>}
          {node.canAct && <button style={S.btn} onClick={() => toggle('athlete')}>+ Athlete</button>}
          {(node.isMine || node.canManageFromAbove) && <button style={S.btn} onClick={() => toggle('members')}>Members</button>}
          {node.canManageFromAbove && (
            <button style={S.btn} onClick={changeStatus}>{node.status === 'active' ? 'Suspend' : 'Restore'}</button>
          )}
        </div>
        {error && <div style={S.error}>{error}</div>}

        {panel === 'subgroup' && <SubgroupForm parentOrgId={mOrg.id} onDone={() => { setPanel(null); onChanged() }} />}
        {panel === 'athlete' && <AthleteForm orgId={mOrg.id} orgName={mOrg.name} />}
        {panel === 'members' && <MembersPanel orgId={mOrg.id} />}
      </div>

      {node.children.map((c) => <GroupNode key={c.id} node={c} depth={depth + 1} onChanged={onChanged} />)}
    </div>
  )
}

function SubgroupForm({ parentOrgId, onDone }) {
  const [txtName, setTxtName] = useState('')
  const [txtType, setTxtType] = useState('club')
  const [txtAdminEmail, setTxtAdminEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const { error: mError } = await createSubgroup(parentOrgId, txtName, txtType, txtAdminEmail || null)
    setBusy(false)
    if (mError) setError(parseAccountError(mError).message)
    else onDone()
  }

  return (
    <form style={S.panel} onSubmit={submit}>
      <div style={S.row}>
        <input style={S.input} placeholder="Group name" value={txtName} onChange={(e) => setTxtName(e.target.value)} required />
        <select style={S.input} value={txtType} onChange={(e) => setTxtType(e.target.value)}>
          {ORG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input style={S.input} type="email" placeholder="First admin's email (optional)"
          value={txtAdminEmail} onChange={(e) => setTxtAdminEmail(e.target.value)} />
        <button style={S.btn} type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
      </div>
      <div style={S.muted}>The admin must already have a SwimZone account; they'll see an invitation to accept.</div>
      {error && <div style={S.error}>{error}</div>}
    </form>
  )
}

function ageFrom(pDob) {
  if (!pDob) return null
  const mDob = new Date(pDob)
  const mNow = new Date()
  let mAge = mNow.getFullYear() - mDob.getFullYear()
  if (mNow < new Date(mNow.getFullYear(), mDob.getMonth(), mDob.getDate())) mAge -= 1
  return mAge
}

function AthleteForm({ orgId, orgName }) {
  const [txtEmail, setTxtEmail] = useState('')
  const [txtName, setTxtName] = useState('')
  const [txtDob, setTxtDob] = useState('')
  const [txtGuardians, setTxtGuardians] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  const mAge = ageFrom(txtDob)
  const mIsJunior = mAge !== null && mAge < 18

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null); setDone(null)
    const { data, error: mError } = await addAthlete({
      organisationId: orgId,
      email: txtEmail,
      fullName: txtName,
      dateOfBirth: txtDob || null,
      guardianEmails: txtGuardians.split(/[,;\s]+/).filter(Boolean),
    })
    setBusy(false)
    if (mError) { setError(parseAccountError(mError).message); return }
    setDone(data?.new_account
      ? `Invitation emailed to ${txtEmail}.${data.pending_guardians?.length ? ' Guardian asked to accept.' : ''}`
      : `${txtEmail} already had an account — added to ${orgName}.`)
    setTxtEmail(''); setTxtName(''); setTxtDob(''); setTxtGuardians('')
  }

  return (
    <form style={S.panel} onSubmit={submit}>
      <div style={S.row}>
        <input style={S.input} type="email" placeholder="Athlete's email" value={txtEmail} onChange={(e) => setTxtEmail(e.target.value)} required />
        <input style={S.input} placeholder="Full name" value={txtName} onChange={(e) => setTxtName(e.target.value)} />
        <label style={S.muted}>Date of birth{' '}
          <input style={{ ...S.input, minWidth: 0 }} type="date" value={txtDob} onChange={(e) => setTxtDob(e.target.value)} />
        </label>
      </div>
      {mIsJunior && (
        <div style={{ ...S.row, marginTop: 8 }}>
          <input style={{ ...S.input, minWidth: 320 }} placeholder="Guardian email(s) — existing adult athletes"
            value={txtGuardians} onChange={(e) => setTxtGuardians(e.target.value)} required />
          <span style={S.muted}>Under 18 ({mAge}) — at least one guardian needed</span>
        </div>
      )}
      <div style={{ ...S.row, marginTop: 8 }}>
        <button style={S.btn} type="submit" disabled={busy}>{busy ? 'Adding…' : `Add to ${orgName}`}</button>
        <span style={S.muted}>New emails get an invitation to set their password.</span>
      </div>
      {error && <div style={S.error}>{error}</div>}
      {done && <div style={S.ok}>{done}</div>}
    </form>
  )
}

function MembersPanel({ orgId }) {
  const [members, setMembers] = useState(null)
  const [txtEmail, setTxtEmail] = useState('')
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const { data, error: mError } = await getGroupMembers(orgId)
    if (mError) setError(parseAccountError(mError).message)
    setMembers(data || [])
  }, [orgId])

  useEffect(() => { load() }, [load])

  const act = async (pPromise) => {
    const { error: mError } = await pPromise
    if (mError) setError(parseAccountError(mError).message)
    else { setError(null); load() }
  }

  const remove = (pMember) => {
    const mWho = pMember.users?.full_name || pMember.users?.email || 'this person'
    if (window.confirm(`Remove ${mWho} (${pMember.role}) from this group? The group keeps its rights.`)) {
      act(removeMembership(pMember.id))
    }
  }

  const nominate = (e) => {
    e.preventDefault()
    act(nominateGroupAdmin(orgId, txtEmail)).then(() => setTxtEmail(''))
  }

  return (
    <div style={S.panel}>
      {members === null && <div style={S.muted}>Loading…</div>}
      {members?.length === 0 && <div style={S.muted}>No members yet.</div>}
      {members?.map((m) => (
        <div key={m.id} style={{ ...S.row, padding: '3px 0' }}>
          <span style={{ minWidth: 180 }}>{m.users?.full_name || m.users?.email || m.user_id}</span>
          <span style={S.muted}>{m.users?.email}</span>
          <span style={S.badge('#333', '#ccc')}>{m.role}</span>
          {m.status === 'pending' && <span style={S.badge('#330', '#dd8')}>pending</span>}
          <span style={{ flex: 1 }} />
          <button style={S.btn} onClick={() => remove(m)}>Remove</button>
        </div>
      ))}
      <form style={{ ...S.row, marginTop: 10 }} onSubmit={nominate}>
        <input style={S.input} type="email" placeholder="Add an admin by email" value={txtEmail}
          onChange={(e) => setTxtEmail(e.target.value)} required />
        <button style={S.btn} type="submit">Nominate admin</button>
      </form>
      {error && <div style={S.error}>{error}</div>}
    </div>
  )
}
