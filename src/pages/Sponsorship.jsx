// pages/Sponsorship.jsx — /sponsorship
// SwimZone is invite-only: a new person comes in through a group that has
// sponsorship. This page shows the sponsorship tree you can see:
//   • groups whose sponsorship you can use → add a new person, sponsor another group
//   • groups below yours                   → suspend / restore (cascades down the branch)
//   • root                                 → daily limits
// Someone who already has an account joins with an invite link instead (Groups).
// Talks only to services/sponsorship.js.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  getSponsorshipTree, isRoot as fetchIsRoot, sponsorGroup, suspendSponsorship, restoreSponsorship,
  setDailyAddLimit, setGroupDailyLimit, addPerson, errorText,
} from '../services/sponsorship'
import { groupsFromMemberships } from '../services/groupLabels'
import { S, Badge, Message, Tick, useAction } from '../components/AccountsUi'

export default function Sponsorship() {
  const navigate = useNavigate()
  const { memberships } = useAuth()
  const [tree, setTree] = useState([])
  const [root, setRoot] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const [t, r] = await Promise.all([getSponsorshipTree(), fetchIsRoot()])
    setTree(t.data || []); setRoot(!!r.data); setLoaded(true)
  }, [])
  useEffect(() => { load() }, [load])

  const flat = useMemo(() => { const out = []; const walk = (n) => { out.push(n); n.children.forEach(walk) }; tree.forEach(walk); return out }, [tree])
  const usable = flat.filter((n) => n.can_use)
  const sponsoredIds = new Set(flat.map((n) => n.org_id))
  const myGroups = groupsFromMemberships(memberships).filter((g) => !sponsoredIds.has(g.org_id) && !g.waiting)

  return (
    <div style={S.page}>
      <div style={S.head}>
        <h2 style={S.h2}>Sponsorship</h2>
        <button style={S.btn} onClick={() => navigate('/dashboard')}>Back</button>
      </div>
      <p style={S.small}>SwimZone is invite-only. A group with sponsorship can bring <strong>new people</strong> in and pass sponsorship on to other groups.
        Suspending a group's sponsorship also suspends every group it sponsored. It never affects anyone's membership or results.</p>

      {!loaded ? <p style={S.muted}>Loading…</p> : flat.length === 0 ? (
        <p style={S.muted}>None of your groups has sponsorship. To bring someone new into SwimZone, ask a Team Manager of a sponsored group. People who already have an account can join your groups with an invite link.</p>
      ) : (
        <>
          <h3 style={S.h3}>Tree</h3>
          {tree.map((n) => <Node key={n.sponsorship_id} n={n} depth={0} root={root} onDone={load} />)}

          {usable.length > 0 && <AddPerson usable={usable} onDone={load} />}
          {usable.length > 0 && <SponsorGroup usable={usable} candidates={myGroups} onDone={load} />}
          {root && <RootLimits />}
        </>
      )}
    </div>
  )
}

function Node({ n, depth, root, onDone }) {
  const act = useAction()
  const [limit, setLimit] = useState('')
  const toggle = () => act.run(() => (n.status === 'active' ? suspendSponsorship : restoreSponsorship)(n.sponsorship_id), null, errorText).then((r) => r && onDone())
  return (
    <>
      <div style={{ ...S.card, marginLeft: depth * 24 }}>
        <div style={S.row}>
          <strong>{n.org_name}</strong>
          {n.status === 'suspended' ? <Badge kind="danger">suspended</Badge> : !n.effective ? <Badge kind="warn">suspended above</Badge> : <Badge kind="staff">active</Badge>}
          {n.can_use && <Badge kind="role">you can use</Badge>}
          <span style={S.muted}>{n.used_last_24h} of {n.daily_limit} in the last 24 h</span>
          <span style={{ flex: 1 }} />
          {n.can_manage && <button style={S.btn} disabled={act.busy} onClick={toggle}>{n.status === 'active' ? 'Suspend' : 'Restore'}</button>}
        </div>
        {root && (
          <div style={{ ...S.row, marginTop: 6 }}>
            <span style={S.muted}>Daily limit for this group</span>
            <input style={{ ...S.input, minWidth: 70, width: 70 }} type="number" min="0" value={limit} placeholder={String(n.daily_limit)} onChange={(e) => setLimit(e.target.value)} />
            <button style={S.btn} disabled={act.busy} onClick={() => act.run(() => setGroupDailyLimit(n.org_id, limit), 'Saved.', errorText).then((r) => r && onDone())}>Set</button>
            <button style={S.btn} disabled={act.busy} onClick={() => act.run(() => setGroupDailyLimit(n.org_id, null), 'Back to the default.', errorText).then((r) => r && onDone())}>Default</button>
          </div>
        )}
        <Message error={act.error} ok={act.ok} />
      </div>
      {n.children.map((c) => <Node key={c.sponsorship_id} n={c} depth={depth + 1} root={root} onDone={onDone} />)}
    </>
  )
}

function AddPerson({ usable, onDone }) {
  const [orgId, setOrgId] = useState(usable[0]?.org_id || '')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [isJunior, setIsJunior] = useState(false)
  const [guardians, setGuardians] = useState('')
  const act = useAction()
  const groupName = usable.find((u) => u.org_id === orgId)?.org_name

  const submit = async () => {
    const r = await act.run(() => addPerson({
      organisationId: orgId, email, fullName, isJunior,
      guardianEmails: guardians.split(/[,\s]+/).filter(Boolean),
    }), () => isJunior
      ? `Invitation sent to ${email}. Their guardian has been asked to accept; ${fullName.split(' ')[0]} joins ${groupName} once they do.`
      : `Invitation sent to ${email}. They join ${groupName} as a member when they set a password.`, errorText)
    if (r) { setEmail(''); setFullName(''); setIsJunior(false); setGuardians(''); onDone() }
  }

  return (
    <>
      <h3 style={S.h3}>Bring a new person into SwimZone</h3>
      <div style={S.card}>
        <p style={{ ...S.muted, marginTop: 0 }}>Only for someone with no SwimZone account. They get an email to set a password, and join the group as a member.
          You're never asked for anyone's date of birth: adults add their own if they need to, and a guardian adds their child's.</p>
        <label style={S.label}>Into group</label>
        <select style={S.input} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          {usable.map((u) => <option key={u.org_id} value={u.org_id}>{u.org_name}</option>)}
        </select>
        <div style={{ ...S.row, alignItems: 'flex-end' }}>
          <div><label style={S.label}>Email</label><input style={S.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label style={S.label}>Full name</label><input style={S.input} value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
        </div>
        <Tick checked={isJunior} onChange={setIsJunior}>Under 18</Tick>
        {isJunior && <>
          <label style={S.label}>Guardian email(s)</label>
          <input style={{ ...S.input, width: '100%' }} value={guardians} onChange={(e) => setGuardians(e.target.value)} placeholder="parent@example.com" />
          <p style={S.muted}>The guardian must already be in SwimZone (bring the parent in first) and have added their own date of birth.
            They'll be asked to accept and to enter the child's date of birth; the child joins the group only after that.</p>
        </>}
        <button style={S.primary} disabled={act.busy || !email || !fullName || (isJunior && !guardians.trim())} onClick={submit}>{act.busy ? 'Sending…' : 'Send invitation'}</button>
        <Message error={act.error} ok={act.ok} />
      </div>
    </>
  )
}

function SponsorGroup({ usable, candidates, onDone }) {
  const [from, setFrom] = useState(usable[0]?.org_id || '')
  const [to, setTo] = useState('')
  const act = useAction()
  return (
    <>
      <h3 style={S.h3}>Give a group sponsorship</h3>
      <div style={S.card}>
        <p style={{ ...S.muted, marginTop: 0 }}>Its Team Managers will be able to bring new people in. You can only sponsor a group you're in. You can suspend it later.</p>
        {candidates.length === 0 ? <p style={S.muted}>All your groups already have sponsorship.</p> : (
          <div style={{ ...S.row, alignItems: 'flex-end' }}>
            <div><label style={S.label}>Using</label>
              <select style={S.input} value={from} onChange={(e) => setFrom(e.target.value)}>
                {usable.map((u) => <option key={u.org_id} value={u.org_id}>{u.org_name}</option>)}
              </select></div>
            <div><label style={S.label}>Sponsor</label>
              <select style={S.input} value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose a group…</option>
                {candidates.map((g) => <option key={g.org_id} value={g.org_id}>{g.name}</option>)}
              </select></div>
            <button style={S.btn} disabled={!to || act.busy} onClick={() => act.run(() => sponsorGroup(from, to), 'Sponsored.', errorText).then((r) => { if (r) { setTo(''); onDone() } })}>Sponsor</button>
          </div>
        )}
        <Message error={act.error} ok={act.ok} />
      </div>
    </>
  )
}

function RootLimits() {
  const [limit, setLimit] = useState('')
  const act = useAction()
  return (
    <>
      <h3 style={S.h3}>Root: default daily limit</h3>
      <div style={{ ...S.card, ...S.row }}>
        <span style={S.small}>New people + groups sponsored, per group, per 24 h</span>
        <input style={{ ...S.input, minWidth: 80, width: 80 }} type="number" min="0" value={limit} onChange={(e) => setLimit(e.target.value)} />
        <button style={S.btn} disabled={!limit || act.busy} onClick={() => act.run(() => setDailyAddLimit(limit), 'Saved.', errorText)}>Set</button>
        <Message error={act.error} ok={act.ok} />
      </div>
    </>
  )
}
