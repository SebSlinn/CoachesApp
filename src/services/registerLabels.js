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

// The coach's attendance grid: one letter per swimmer per register (group_attendance).
// Colours work as a background with dark text, and the letter carries the meaning on its own.
export const ATTENDANCE_CODES = [
  { code: 'C',  label: 'Complete',                 bg: '#c8ecd0', fg: '#0b5a1e' },
  { code: 'P',  label: 'Partial',                  bg: '#ffe2a8', fg: '#6b4500' },
  { code: 'I',  label: 'In, not signed out',       bg: '#cfe8f3', fg: '#0d4a63' },
  { code: 'A',  label: 'Absent',                   bg: '#f6c9c4', fg: '#7a1a10' },
  { code: 'Ap', label: 'Apologies',                bg: '#f3e1df', fg: '#7a1a10' },
  { code: 'E',  label: 'Expected (register open)', bg: '#eeeeee', fg: '#444444' },
  { code: 'N',  label: 'Not booked',               bg: 'transparent', fg: '#9a9a9a' },
]
export const ATTENDANCE_CODE = Object.fromEntries(ATTENDANCE_CODES.map((c) => [c.code, c]))

// One swimmer's row → { booked, attended, complete, partial, absent, pct } over the registers they were on.
// Attended = complete + partial + in-not-signed-out. Booked excludes N (not on it) and E (still open).
export function attendanceTotals(pCells) {
  const v = Object.values(pCells || {})
  const n = (c) => v.filter((x) => x === c).length
  const booked = v.filter((x) => x !== 'N' && x !== 'E').length
  const attended = n('C') + n('P') + n('I')
  return { booked, attended, complete: n('C'), partial: n('P'), absent: n('A') + n('Ap'),
           pct: booked ? Math.round((100 * attended) / booked) : null }
}

// What a scan did, in words.
export function scanText(r) {
  if (!r) return ''
  const who = r.name || 'Swimmer'
  switch (r.result) {
    case 'in': return `${who} — in${r.visitor ? ' (visitor, not in these groups)' : ''}`
    case 'out': return `${who} — signed out, full session`
    case 'already_in': return `${who} is already in (scan again after 10 minutes to sign out)`
    case 'already_out': return `${who} is already signed out`
    case 'unknown_card': return `Card ${r.code} isn't linked to anyone yet`
    default: return who
  }
}

// The grid's letter for one entry (same rules as group_attendance in SQL).
export function entryCode(e, pRegisterStatus) {
  if (!e) return 'N'
  if (e.completion === 'full') return 'C'
  if (e.completion === 'partial') return 'P'
  if (e.attendance === 'in') return 'I'
  if (e.attendance === 'apologies') return 'Ap'
  if (e.attendance === 'absent') return 'A'
  return (pRegisterStatus ?? e.register_status) === 'closed' ? 'A' : 'E'
}
