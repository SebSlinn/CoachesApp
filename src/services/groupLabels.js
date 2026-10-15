//services/groupLabels.js
// Words and small rules for groups, shared by the screens. Zero imports, so it
// can be tested without Supabase.

export const GROUP_TYPES = [
  { value: 'coaching', label: 'Coaching group',
    blurb: 'Coaches read and add members\' results. Members see the staff and each other\'s public names, not each other\'s results.' },
  { value: 'sharing', label: 'Sharing group',
    blurb: 'Members see each other\'s results. Nobody can add to anyone else\'s.' },
  { value: 'family', label: 'Family',
    blurb: 'Like a sharing group, with full names shown. For a household.' },
]
export const GROUP_TYPE_LABEL = Object.fromEntries(GROUP_TYPES.map((t) => [t.value, t.label]).concat([['root', 'SwimZone']]))

// org_type is only a descriptive label.
export const ORG_TYPES = [
  { value: 'club', label: 'Club' },
  { value: 'squad', label: 'Squad' },
  { value: 'school', label: 'School' },
  { value: 'county', label: 'County / region' },
  { value: 'governing_body', label: 'Governing body' },
  { value: 'family', label: 'Family' },
  { value: 'other', label: 'Other' },
]
export const ORG_TYPE_LABEL = Object.fromEntries(ORG_TYPES.map((t) => [t.value, t.label]).concat([['root', 'SwimZone'], ['private', 'Private']]))

export const CAPABILITIES = [
  { key: 'manage_members', label: 'Manage members' },
  { key: 'read_results', label: 'Read results' },
  { key: 'add_results', label: 'Add results' },
]

// "reads and adds results", "manages members and reads results", "—"
export function describeCapabilities(pRow) {
  if (!pRow) return ''
  const mParts = []
  if (pRow.manage_members) mParts.push('manages members')
  if (pRow.read_results && pRow.add_results) mParts.push('reads and adds results')
  else if (pRow.read_results) mParts.push('reads results')
  else if (pRow.add_results) mParts.push('adds results (can\'t read them)')
  if (!mParts.length) return ''
  return mParts.length === 1 ? mParts[0] : mParts.slice(0, -1).join(', ') + ' and ' + mParts[mParts.length - 1]
}

// What other members will see of you, in words.
export function describeVisibility(pTicks) {
  if (!pTicks) return ''
  const mShown = []
  if (pTicks.public_name ?? pTicks.show_public_name) mShown.push('your public name')
  if (pTicks.full_name ?? pTicks.show_full_name) mShown.push('your full name')
  if (pTicks.email ?? pTicks.show_email) mShown.push('your email')
  if (pTicks.results ?? pTicks.members_see_results) mShown.push('your results')
  if (!mShown.length) return 'Other members won\'t see you in the member list. Staff always can.'
  const mList = mShown.length === 1 ? mShown[0] : mShown.slice(0, -1).join(', ') + ' and ' + mShown[mShown.length - 1]
  return `Other members will see ${mList}. Under-18s never show full name or email to other members.`
}

// Does any of these memberships give this capability? (my_memberships rows)
export function hasCapability(pMemberships, pCap) {
  return (pMemberships || []).some((m) => m.status === 'active' && (pCap === 'staff' ? m.is_staff : m[pCap]))
}

// my_memberships rows → one entry per group, roles gathered.
export function groupsFromMemberships(pMemberships) {
  const mByOrg = new Map()
  for (const m of pMemberships || []) {
    let g = mByOrg.get(m.org_id)
    if (!g) {
      g = { org_id: m.org_id, name: m.org_name, group_type: m.group_type, org_type: m.org_type,
            parent_org_id: m.parent_org_id, description: m.description, roles: [],
            manage_members: false, read_results: false, add_results: false, is_staff: false,
            settings_to_accept: false, waiting: null }
      mByOrg.set(m.org_id, g)
    }
    g.roles.push(m)
    if (m.status === 'active') {
      g.manage_members ||= m.manage_members
      g.read_results ||= m.read_results
      g.add_results ||= m.add_results
      g.is_staff ||= m.is_staff
      g.settings_to_accept ||= m.settings_to_accept
    } else if (!g.waiting) {
      g.waiting = m.status   // 'pending' | 'awaiting_guardian'
    }
  }
  return [...mByOrg.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

export const inviteLink = (pCode, pOrigin) => `${pOrigin || ''}/join/${pCode}`

const STATUS_TEXT = {
  pending: 'waiting for a Team Manager to approve',
  awaiting_guardian: 'waiting for a guardian to approve',
}
export const statusText = (pStatus) => STATUS_TEXT[pStatus] || ''

// One line for the activity log.
export function describeEvent(e) {
  const who = e.actor_name || 'Someone'
  const subj = e.subject_name || 'someone'
  const role = e.detail?.role_label || 'member'
  switch (e.event) {
    case 'created': return `${who} created the group`
    case 'joined': return `${subj} joined as ${role}`
    case 'left': return `${subj} left (${role})`
    case 'removed': return `${who} removed ${subj} (${role})`
    case 'role_added': return `${subj} is now also ${role}`
    case 'capability_changed': {
      const mTo = e.detail?.to || {}
      const mFrom = e.detail?.from || {}
      const mChanged = CAPABILITIES.filter((c) => mTo[c.key] !== mFrom[c.key])
        .map((c) => `${c.label.toLowerCase()} ${mTo[c.key] === null ? 'back to the role default' : mTo[c.key] ? 'on' : 'off'}`)
      return `${who} changed ${subj} (${role}): ${mChanged.join(', ') || 'permissions'}`
    }
    case 'settings_changed': {
      const mTo = e.detail?.to || {}
      const mFrom = e.detail?.from || {}
      const mLabels = { name: 'name', show_public_name: 'public names', show_full_name: 'full names',
                        show_email: 'emails', members_see_results: 'members see results' }
      const mChanged = Object.keys(mLabels).filter((k) => mTo[k] !== mFrom[k])
        .map((k) => (k === 'name' ? `renamed to “${mTo.name}”` : `${mLabels[k]} ${mTo[k] ? 'on' : 'off'}`))
      return `${who} changed the settings: ${mChanged.join(', ') || 'description'}`
    }
    case 'sponsored': return `${who} gave this group sponsorship`
    default: return `${who}: ${e.event}`
  }
}
