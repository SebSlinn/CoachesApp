// pages/Groups.jsx — /groups and /groups/:orgId
//   /groups         your groups, join with a code, create a group
//   /groups/:orgId  one group: members, join requests, invite links, settings,
//                   what you share, the activity log, sub-groups, leaving
// Anyone signed in can create a group; joining is by invite link only.
// The database enforces every rule; the buttons shown are the ones likely to work.
// Talks only to services/groups.js (+ groupLabels.js for words).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  getGroup, getGroupDirectory, getGroupEvents, getGroupInvites, getRoles, getMyAccess,
  createGroup, updateGroupSettings, acceptGroupSettings, setMySharing,
  createInvite, revokeInvite, approveMembership, addMemberRole, setMemberCapability,
  removeMembership, errorText,
} from '../services/groups'
import {
  GROUP_TYPES, GROUP_TYPE_LABEL, ORG_TYPES, ORG_TYPE_LABEL, CAPABILITIES,
  describeCapabilities, describeVisibility, describeEvent, groupsFromMemberships, inviteLink, statusText,
} from '../services/groupLabels'
import { S, Badge, Message, Tick, useAction } from '../components/AccountsUi'

export default function Groups() {
  const { orgId } = useParams()
  return orgId ? <GroupDetail key={orgId} orgId={orgId} /> : <GroupList />
}

// ---------------------------------------------------------------------------
function GroupList() {
  const navigate = useNavigate()
  const { memberships, refreshMemberships } = useAuth()
  const groups = useMemo(() => groupsFromMemberships(memberships), [memberships])
  const [code, setCode] = useState('')

  return (
    <div style={S.page}>
      <div style={S.head}>
        <h2 style={S.h2}>Groups</h2>
        <button style={S.btn} onClick={() => navigate('/dashboard')}>Back</button>
      </div>

      <div style={{ ...S.card, ...S.row }}>
        <span style={S.small}>Have an invite code?</span>
        <input style={S.input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 3F9A21C07B4D88E2" />
        <button style={S.btn} disabled={!code.trim()} onClick={() => navigate('/join/' + code.trim().toUpperCase())}>Open</button>
      </div>

      <h3 style={S.h3}>Your groups</h3>
      {groups.length === 0 && <p style={S.muted}>You're not in any groups yet. Join one with an invite link, or create one below.</p>}
      {groups.map((g) => (
        <div key={g.org_id} style={{ ...S.card, cursor: 'pointer' }} onClick={() => navigate('/groups/' + g.org_id)}>
          <div style={S.row}>
            <strong>{g.name}</strong>
            <span style={S.muted}>{GROUP_TYPE_LABEL[g.group_type]} · {ORG_TYPE_LABEL[g.org_type] || g.org_type}</span>
            <span style={{ flex: 1 }} />
            {g.roles.map((r) => <Badge key={r.membership_id} kind={r.is_staff ? 'staff' : 'role'}>{r.role_label}</Badge>)}
            {g.waiting && <Badge kind="warn">{statusText(g.waiting)}</Badge>}
            {g.settings_to_accept && <Badge kind="warn">new settings to review</Badge>}
          </div>
        </div>
      ))}

      <h3 style={S.h3}>Create a group</h3>
      <CreateGroupForm onCreated={async (id) => { await refreshMemberships(); navigate('/groups/' + id) }} />
    </div>
  )
}

function CreateGroupForm({ parentOrgId = null, parentName = null, onCreated }) {
  const [name, setName] = useState('')
  const [groupType, setGroupType] = useState('coaching')
  const [orgType, setOrgType] = useState(parentOrgId ? 'squad' : 'club')
  const [description, setDescription] = useState('')
  const act = useAction()
  const type = GROUP_TYPES.find((t) => t.value === groupType)

  const submit = async () => {
    const r = await act.run(() => createGroup({ name, groupType, orgType, parentOrgId, description }), null, errorText)
    if (r?.data) { setName(''); setDescription(''); onCreated?.(r.data) }
  }

  return (
    <div style={S.card}>
      {parentName && <p style={{ ...S.small, marginTop: 0 }}>A group inside <strong>{parentName}</strong>. Its Team Managers can manage it too; coaches need adding to it separately.</p>}
      <label style={S.label}>Name</label>
      <input style={{ ...S.input, width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} placeholder={parentOrgId ? 'e.g. Development squad' : 'e.g. Riverside SC'} />
      <div style={{ ...S.row, alignItems: 'flex-start' }}>
        <div>
          <label style={S.label}>Kind of group</label>
          <select style={S.input} value={groupType} onChange={(e) => setGroupType(e.target.value)}>
            {GROUP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Describe it as</label>
          <select style={S.input} value={orgType} onChange={(e) => setOrgType(e.target.value)}>
            {ORG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>
      <p style={S.muted}>{type?.blurb} You can change what members see later.</p>
      <label style={S.label}>Description (optional)</label>
      <input style={{ ...S.input, width: '100%' }} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div style={{ marginTop: 12 }}>
        <button style={S.primary} disabled={act.busy || !name.trim()} onClick={submit}>{act.busy ? 'Creating…' : 'Create group'}</button>
      </div>
      <Message error={act.error} />
      <p style={S.muted}>You'll be its Team Manager. Then make an invite link to bring people in.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
function GroupDetail({ orgId }) {
  const navigate = useNavigate()
  const { user, memberships, refreshMemberships } = useAuth()
  const [group, setGroup] = useState(null)
  const [access, setAccess] = useState({ can_manage: false, is_staff: false })
  const [directory, setDirectory] = useState([])
  const [events, setEvents] = useState([])
  const [invites, setInvites] = useState([])
  const [roles, setRoles] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [loaded, setLoaded] = useState(false)

  const myRows = useMemo(() => memberships.filter((m) => m.org_id === orgId), [memberships, orgId])
  const myMemberRow = myRows.find((m) => m.status === 'active' && !m.is_staff)

  const load = useCallback(async () => {
    const [g, a, d, e, r] = await Promise.all([
      getGroup(orgId), getMyAccess(orgId), getGroupDirectory(orgId), getGroupEvents(orgId, 50), getRoles(),
    ])
    if (g.error || !g.data) { setLoadError(g.error ? errorText(g.error) : 'This group doesn\'t exist, or you can\'t see it.'); setLoaded(true); return }
    setGroup(g.data); setAccess(a.data || { can_manage: false, is_staff: false })
    setDirectory(d.data || []); setEvents(e.data || []); setRoles(r.data || [])
    if (a.data?.can_manage) setInvites((await getGroupInvites(orgId)).data || [])
    setLoaded(true)
  }, [orgId])

  useEffect(() => { load() }, [load])
  const reload = async () => { await Promise.all([load(), refreshMemberships()]) }

  if (!loaded) return <div style={S.page}><p style={S.muted}>Loading…</p></div>
  if (loadError) return (
    <div style={S.page}>
      <div style={S.head}><h2 style={S.h2}>Group</h2><button style={S.btn} onClick={() => navigate('/groups')}>Back</button></div>
      <p>{loadError}</p>
    </div>
  )

  const pending = directory.filter((m) => m.status !== 'active')
  const active = directory.filter((m) => m.status === 'active')
  const parent = memberships.find((m) => m.org_id === group.parent_org_id)

  return (
    <div style={S.page}>
      <div style={S.head}>
        <div>
          <h2 style={S.h2}>{group.name}</h2>
          <div style={S.muted}>
            {GROUP_TYPE_LABEL[group.group_type]} · {ORG_TYPE_LABEL[group.org_type] || group.org_type}
            {group.parent_org_id && <> · inside {parent ? <Link to={'/groups/' + group.parent_org_id}>{parent.org_name}</Link> : 'another group'}</>}
          </div>
          {group.description && <p style={{ ...S.small, margin: '6px 0 0' }}>{group.description}</p>}
        </div>
        <button style={S.btn} onClick={() => navigate('/groups')}>All groups</button>
      </div>

      {myMemberRow?.settings_to_accept && <LoosenedBanner group={group} orgId={orgId} onDone={reload} />}

      {access.can_manage && pending.length > 0 && (
        <>
          <h3 style={S.h3}>Waiting</h3>
          {pending.map((m) => <PendingRow key={m.membership_id} m={m} onDone={reload} />)}
        </>
      )}

      <h3 style={S.h3}>Members ({active.length})</h3>
      {active.map((m) => (
        <MemberRow key={m.membership_id} m={m} me={user?.id} canManage={access.can_manage} roles={roles}
          orgId={orgId} onDone={reload} />
      ))}
      {!access.can_manage && !access.is_staff && (
        <p style={S.muted}>You see staff, and other members as far as this group's settings and their own choices allow.</p>
      )}

      {access.can_manage && <InvitesPanel orgId={orgId} invites={invites} roles={roles} onDone={reload} />}
      {access.can_manage && <SettingsPanel group={group} orgId={orgId} onDone={reload} />}
      {myMemberRow && <MySharingPanel group={group} row={myMemberRow} orgId={orgId} onDone={reload} />}

      <h3 style={S.h3}>Activity</h3>
      <p style={{ ...S.muted, marginTop: -4 }}>Everyone in the group, and members' guardians, can see this.</p>
      {events.length === 0 && <p style={S.muted}>Nothing yet.</p>}
      {events.map((e) => (
        <div key={e.id} style={{ ...S.small, padding: '4px 0', borderBottom: '1px solid #8883' }}>
          <span style={{ ...S.muted, display: 'inline-block', minWidth: 120 }}>{new Date(e.created_at).toLocaleString()}</span>
          {describeEvent(e)}
        </div>
      ))}

      {access.can_manage && (
        <>
          <h3 style={S.h3}>Add a group inside this one</h3>
          <CreateGroupForm parentOrgId={orgId} parentName={group.name}
            onCreated={async (id) => { await refreshMemberships(); navigate('/groups/' + id) }} />
        </>
      )}

      {myRows.filter((m) => m.status !== 'removed').length > 0 && (
        <>
          <h3 style={S.h3}>Leave</h3>
          {myRows.map((m) => <LeaveRow key={m.membership_id} m={m} onDone={async () => { await refreshMemberships(); navigate('/groups') }} />)}
        </>
      )}
    </div>
  )
}

function LoosenedBanner({ group, orgId, onDone }) {
  const act = useAction()
  return (
    <div style={S.banner}>
      <strong>This group now shares more about its members.</strong>
      <div style={{ ...S.small, marginTop: 4 }}>{describeVisibility(group)} Nothing more about you is shown until you agree.</div>
      <div style={{ ...S.row, marginTop: 8 }}>
        <button style={S.btn} disabled={act.busy} onClick={async () => { if (await act.run(() => acceptGroupSettings(orgId), null, errorText)) onDone() }}>Share as the group does</button>
        <span style={S.muted}>or choose below under “What you share”.</span>
      </div>
      <Message error={act.error} />
    </div>
  )
}

function PendingRow({ m, onDone }) {
  const act = useAction()
  const go = async (accept) => { if (await act.run(() => approveMembership(m.membership_id, accept), null, errorText)) onDone() }
  return (
    <div style={S.card}>
      <div style={S.row}>
        <strong>{m.full_name || m.public_name || 'Someone'}</strong>
        <Badge kind={m.is_staff ? 'staff' : 'role'}>{m.role_label}</Badge>
        {m.is_junior && <Badge kind="warn">under 18</Badge>}
        <span style={S.muted}>{statusText(m.status)}</span>
        <span style={{ flex: 1 }} />
        {m.status === 'pending' && <>
          <button style={S.btn} disabled={act.busy} onClick={() => go(true)}>Approve</button>
          <button style={S.btn} disabled={act.busy} onClick={() => go(false)}>Decline</button>
        </>}
      </div>
      {m.is_staff && <div style={S.muted}>As {m.role_label} they would: {describeCapabilities(m) || 'no extra access'}.</div>}
      <Message error={act.error} />
    </div>
  )
}

function MemberRow({ m, me, canManage, roles, orgId, onDone }) {
  const act = useAction()
  const [open, setOpen] = useState(false)
  const [newRole, setNewRole] = useState('')
  const name = m.full_name || m.public_name || 'Member'
  const caps = describeCapabilities(m)

  const setCap = async (cap, value) => {
    const role = roles.find((r) => r.key === m.role)
    const mValue = role && role[cap] === value ? null : value   // back to the default when it matches
    if (await act.run(() => setMemberCapability(m.membership_id, cap, mValue), null, errorText)) onDone()
  }
  const remove = async () => { if (await act.run(() => removeMembership(m.membership_id), null, errorText)) onDone() }
  const addRole = async () => { if (newRole && await act.run(() => addMemberRole(orgId, m.user_id, newRole), null, errorText)) { setNewRole(''); onDone() } }

  return (
    <div style={S.card}>
      <div style={S.row}>
        <strong>{name}</strong>
        {m.public_name && m.full_name && m.public_name !== m.full_name && <span style={S.muted}>({m.public_name})</span>}
        {m.user_id === me && <Badge>you</Badge>}
        <Badge kind={m.is_staff ? 'staff' : 'role'}>{m.role_label}</Badge>
        {m.is_junior && <Badge kind="warn">under 18</Badge>}
        {m.email && <span style={S.muted}>{m.email}</span>}
        <span style={{ flex: 1 }} />
        {caps && <span style={S.muted}>{caps}</span>}
        {canManage && <button style={S.btn} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Manage'}</button>}
      </div>
      {open && canManage && (
        <div style={S.panel}>
          <div style={S.small}><strong>What this person can do as {m.role_label}</strong></div>
          {CAPABILITIES.map((c) => (
            <Tick key={c.key} checked={m[c.key]} disabled={act.busy} onChange={(v) => setCap(c.key, v)}>{c.label}</Tick>
          ))}
          <p style={S.muted}>Changes are logged and every member can see them.</p>
          <div style={{ ...S.row, marginTop: 8 }}>
            <select style={S.input} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="">Give another role…</option>
              {roles.filter((r) => r.key !== m.role).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <button style={S.btn} disabled={!newRole || act.busy} onClick={addRole}>Add role</button>
            <span style={{ flex: 1 }} />
            <button style={S.btn} disabled={act.busy} onClick={remove}>{m.user_id === me ? 'Leave this role' : 'Remove from group'}</button>
          </div>
          <Message error={act.error} />
        </div>
      )}
    </div>
  )
}

function InvitesPanel({ orgId, invites, roles, onDone }) {
  const [role, setRole] = useState('member')
  const [needsApproval, setNeedsApproval] = useState(false)
  const [maxUses, setMaxUses] = useState('')
  const [days, setDays] = useState('14')
  const [made, setMade] = useState(null)
  const act = useAction()
  const staffRole = roles.find((r) => r.key === role)?.is_staff
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const make = async () => {
    const r = await act.run(() => createInvite(orgId, { role, needsApproval, maxUses, expiresInDays: days }), null, errorText)
    if (r?.data) { setMade(r.data); onDone() }
  }
  const copy = (code) => navigator.clipboard?.writeText(inviteLink(code, origin))
  const live = invites.filter((i) => !i.revoked_at && (!i.expires_at || new Date(i.expires_at) > new Date()) && (!i.max_uses || i.uses < i.max_uses))

  return (
    <>
      <h3 style={S.h3}>Invite links</h3>
      <div style={S.card}>
        <div style={{ ...S.row, alignItems: 'flex-end' }}>
          <div>
            <label style={S.label}>Joins as</label>
            <select style={S.input} value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Expires after (days)</label>
            <input style={{ ...S.input, minWidth: 80, width: 80 }} type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Max uses (blank = any)</label>
            <input style={{ ...S.input, minWidth: 80, width: 80 }} type="number" min="1" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
          </div>
        </div>
        <Tick checked={needsApproval || staffRole} disabled={staffRole} onChange={setNeedsApproval}
          hint={staffRole ? 'Always on for staff roles.' : 'Otherwise adults join straight away. Under-18s always wait for a guardian.'}>
          A Team Manager approves each person
        </Tick>
        <button style={S.primary} disabled={act.busy} onClick={make}>Make invite link</button>
        <Message error={act.error} />
        {made && (
          <div style={{ ...S.panel, ...S.row }}>
            <code style={{ fontSize: 13 }}>{inviteLink(made, origin)}</code>
            <button style={S.btn} onClick={() => copy(made)}>Copy</button>
            <span style={S.muted}>Share it however suits: email, the club WhatsApp, a poster.</span>
          </div>
        )}
      </div>
      {live.map((i) => <InviteRow key={i.id} i={i} roles={roles} origin={origin} onCopy={copy} onDone={onDone} />)}
      {invites.length > live.length && <p style={S.muted}>{invites.length - live.length} expired, used up or revoked.</p>}
    </>
  )
}

function InviteRow({ i, roles, origin, onCopy, onDone }) {
  const act = useAction()
  const label = roles.find((r) => r.key === i.role)?.label || i.role
  return (
    <div style={{ ...S.card, ...S.row }}>
      <code style={{ fontSize: 13 }}>{i.code}</code>
      <Badge kind="role">{label}</Badge>
      {i.needs_approval && <Badge kind="warn">approval</Badge>}
      <span style={S.muted}>
        used {i.uses}{i.max_uses ? ` of ${i.max_uses}` : ''}{i.expires_at ? ` · until ${new Date(i.expires_at).toLocaleDateString()}` : ''}
      </span>
      <span style={{ flex: 1 }} />
      <button style={S.btn} onClick={() => onCopy(i.code)} title={inviteLink(i.code, origin)}>Copy link</button>
      <button style={S.btn} disabled={act.busy} onClick={async () => { if (await act.run(() => revokeInvite(i.id), null, errorText)) onDone() }}>Revoke</button>
      <Message error={act.error} />
    </div>
  )
}

function SettingsPanel({ group, orgId, onDone }) {
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description || '')
  const [t, setT] = useState({
    showPublicName: group.show_public_name, showFullName: group.show_full_name,
    showEmail: group.show_email, membersSeeResults: group.members_see_results,
  })
  const act = useAction()
  const loosening = (!group.show_public_name && t.showPublicName) || (!group.show_full_name && t.showFullName)
    || (!group.show_email && t.showEmail) || (!group.members_see_results && t.membersSeeResults)
  const save = async () => {
    if (await act.run(() => updateGroupSettings(orgId, { name, description, ...t }), 'Saved.', errorText)) onDone()
  }
  const set = (k) => (v) => setT({ ...t, [k]: v })

  return (
    <>
      <h3 style={S.h3}>Settings</h3>
      <div style={S.card}>
        <label style={S.label}>Name</label>
        <input style={{ ...S.input, width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} />
        <label style={S.label}>Description</label>
        <input style={{ ...S.input, width: '100%' }} value={description} onChange={(e) => setDescription(e.target.value)} />
        <label style={S.label}>What members see of each other</label>
        <Tick checked={t.showPublicName} onChange={set('showPublicName')} hint="Off: members see only the staff and themselves.">Public names (the member list)</Tick>
        <Tick checked={t.showFullName} onChange={set('showFullName')}>Full names</Tick>
        <Tick checked={t.showEmail} onChange={set('showEmail')}>Email addresses</Tick>
        <Tick checked={t.membersSeeResults} onChange={set('membersSeeResults')} hint="Members can read each other's results. Nobody can add to anyone else's.">Each other's results</Tick>
        <p style={S.muted}>Staff always see members' full names and emails. Under-18s never show full name or email to other members.</p>
        {loosening && <div style={{ ...S.banner, margin: '8px 0' }}>Turning these on takes effect only for members who agree; everyone else stays as they are and is asked. Turning things off applies straight away.</div>}
        <button style={S.primary} disabled={act.busy} onClick={save}>Save settings</button>
        <Message error={act.error} ok={act.ok} />
      </div>
    </>
  )
}

function MySharingPanel({ group, row, orgId, onDone }) {
  const [t, setT] = useState({
    publicName: row.share_public_name, fullName: row.share_full_name, email: row.share_email, results: row.share_results,
  })
  const act = useAction()
  const set = (k) => (v) => setT({ ...t, [k]: v })
  const save = async () => { if (await act.run(() => setMySharing(orgId, t), 'Saved.', errorText)) onDone() }
  return (
    <>
      <h3 style={S.h3}>What you share</h3>
      <div style={S.card}>
        <Tick checked={t.publicName && group.show_public_name} disabled={!group.show_public_name} onChange={set('publicName')}>Your public name</Tick>
        <Tick checked={t.fullName && group.show_full_name} disabled={!group.show_full_name} onChange={set('fullName')}>Your full name</Tick>
        <Tick checked={t.email && group.show_email} disabled={!group.show_email} onChange={set('email')}>Your email</Tick>
        <Tick checked={t.results && group.members_see_results} disabled={!group.members_see_results} onChange={set('results')}>Your results</Tick>
        <p style={S.muted}>Greyed-out items are switched off for the whole group. Staff always see your name and email, and coaches read your results.</p>
        <button style={S.btn} disabled={act.busy} onClick={save}>Save</button>
        <Message error={act.error} ok={act.ok} />
      </div>
    </>
  )
}

function LeaveRow({ m, onDone }) {
  const act = useAction()
  const [sure, setSure] = useState(false)
  return (
    <div style={{ ...S.row, margin: '6px 0' }}>
      <span style={S.small}>{m.role_label}{m.status !== 'active' ? ` (${statusText(m.status)})` : ''}</span>
      {!sure ? <button style={S.btn} onClick={() => setSure(true)}>{m.status === 'active' ? 'Leave' : 'Withdraw'}</button> : <>
        <span style={S.muted}>{m.is_staff ? 'You will lose access to members\' results.' : 'Staff will lose access to your results.'}</span>
        <button style={S.btn} disabled={act.busy} onClick={async () => { if (await act.run(() => removeMembership(m.membership_id), null, errorText)) onDone() }}>Yes, leave</button>
        <button style={S.btn} onClick={() => setSure(false)}>Cancel</button>
      </>}
      <Message error={act.error} />
    </div>
  )
}
