//services/registerLabels.js
// Words and small pure rules for the register screens. Zero imports, so it can be tested
// without Supabase or React.

export const PARTIAL_REASONS = [
  { key: 'left_early', label: 'Left early' },
  { key: 'unwell', label: 'Unwell' },
  { key: 'injured', label: 'Injured' },
  { key: 'other', label: 'Other' },
]
export const PARTIAL_REASON_LABEL = Object.fromEntries(PARTIAL_REASONS.map((r) => [r.key, r.label]))

export const POOL_TYPES = ['25SC', '50LC', '25Y']

// The actions mark_register_entry accepts.
export const ACTIONS = ['in', 'undo_in', 'absent', 'apologies', 'expected', 'out_full', 'out_partial', 'undo_out']

// 'HH:MM' in the device's time zone, or '' for no time.
export function clock(pIso) {
  if (!pIso) return ''
  const d = new Date(pIso)
  return Number.isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5)
}

// "Tue 22 Oct · 18:00–19:30"
export function when(pStartsAt, pEndsAt) {
  if (!pStartsAt) return ''
  const d = new Date(pStartsAt)
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day} · ${clock(pStartsAt)}${pEndsAt ? '–' + clock(pEndsAt) : ''}`
}

// Where an entry stands, in one short phrase for its row.
export function entryStatus(e) {
  if (!e) return ''
  if (e.completion === 'full') return `Out ${clock(e.out_at)} · full session`
  if (e.completion === 'partial') {
    const mDone = e.done_m != null ? ` · ${e.done_m} m` : e.done_pct != null ? ` · ${e.done_pct}%` : ''
    return `Out ${clock(e.out_at)} · partial (${(PARTIAL_REASON_LABEL[e.partial_reason] || 'other').toLowerCase()})${mDone}`
  }
  if (e.attendance === 'in') return `In ${clock(e.in_at)}`
  if (e.attendance === 'absent') return 'Absent'
  if (e.attendance === 'apologies') return 'Apologies'
  return e.expected === false ? 'Added' : ''
}

// Counts for the roll call: whole register and per register group.
//   { all: {on, in, out, stillIn}, byGroup: { [registerGroupId]: {on, in, out, stillIn} } }
export function rollCall(pEntries) {
  const zero = () => ({ on: 0, in: 0, out: 0, stillIn: 0 })
  const all = zero(); const byGroup = {}
  for (const e of pEntries || []) {
    const g = (byGroup[e.register_group_id] ||= zero())
    for (const c of [all, g]) {
      c.on++
      if (e.attendance === 'in') { c.in++; if (e.completion) c.out++; else c.stillIn++ }
    }
  }
  return { all, byGroup }
}

// Groups the user can take registers for, from my_memberships rows: [{ org_id, name }], by name.
export function registerableGroups(pMemberships) {
  const mByOrg = new Map()
  for (const m of pMemberships || []) {
    if (m.status === 'active' && m.take_register && !mByOrg.has(m.org_id)) mByOrg.set(m.org_id, { org_id: m.org_id, name: m.org_name })
  }
  return [...mByOrg.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

// A register "like last time" on a new day: same clock times (local), same groups/venue/pool.
// pDate is 'YYYY-MM-DD' (local). → { orgIds, date, startTime, endTime, venue, poolType }
export function copyOf(pRegister, pDate) {
  if (!pRegister) return null
  return {
    orgIds: [...(pRegister.org_ids || [])],
    date: pDate,
    startTime: clock(pRegister.starts_at),
    endTime: clock(pRegister.ends_at),
    venue: pRegister.venue || '',
    poolType: pRegister.pool_type || '',
  }
}

// Local date + 'HH:MM' → ISO timestamp (null if either is missing or bad).
export function toIso(pDate, pTime) {
  if (!pDate || !pTime) return null
  const d = new Date(`${pDate}T${pTime}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// Today as 'YYYY-MM-DD' in the device's time zone.
export function todayLocal(pNow = new Date()) {
  const d = new Date(pNow.getTime() - pNow.getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 10)
}
