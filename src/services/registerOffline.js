//services/registerOffline.js
// The register's rules, run on the phone — pure, zero imports — so a tap shows at once with no
// signal, and is refused at once for the same reasons the database would refuse it.
// Mirrors mark_register_entry / create_register / close_register in
// supabase/migrations/20261022130000_registers.sql. If you change a rule there, change it here
// (registerOffline.test.mjs checks the pairs).
//
// A queued tap ("op"): { client_uuid, athlete_user_id, org_id, action, at, detail }
//   athlete_user_id is the person_key: an athlete id, or 'guest:<uuid>' for a typed-in guest
//   action: add | guest | comment | in | undo_in | absent | apologies | expected | out_full | out_partial | undo_out

export const LOCAL_PREFIX = 'local:'
export const GUEST_PREFIX = 'guest:'
// The key a queued tap uses for a person on the sheet (athlete id, or guest:<uuid>).
export const personKey = (e) => e?.person_key || e?.athlete_user_id
export const isLocalKey = (pKey) => typeof pKey === 'string' && pKey.startsWith(LOCAL_PREFIX)

const ATTENDANCE = ['in', 'undo_in', 'absent', 'apologies', 'expected']
const SIGN_OUT = ['out_full', 'out_partial', 'undo_out']
const REASONS = ['left_early', 'unwell', 'injured', 'other']
const t = (pIso) => (pIso ? new Date(pIso).getTime() : null)

// A brand-new register made on the phone, from the downloaded group lists.
// pSpec: { client_uuid, org_ids[], starts_at, ends_at, venue, pool_type }
// pGroups: register_prepare().groups → [{ org_id, name, members:[{ athlete_user_id, name, is_junior }] }]
// A swimmer in two of the groups lands in the first, as on the server.
export function buildLocalSheet(pSpec, pGroups, pMyName = 'me') {
  const mKey = LOCAL_PREFIX + pSpec.client_uuid
  const mSeen = new Set()
  const groups = []; const entries = []
  pSpec.org_ids.forEach((pOrg, i) => {
    const g = (pGroups || []).find((x) => x.org_id === pOrg)
    const mRgId = `${mKey}:g:${pOrg}`
    groups.push({ id: mRgId, org_id: pOrg, name: g?.name || 'Group', label: null, sort: i + 1, can_take: true,
                  plan_title: null, plan_summary: null })
    for (const m of g?.members || []) {
      if (mSeen.has(m.athlete_user_id)) continue
      mSeen.add(m.athlete_user_id)
      entries.push(newEntry(mKey, mRgId, m, true))
    }
  })
  entries.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  return {
    register: { id: mKey, starts_at: pSpec.starts_at, ends_at: pSpec.ends_at || null, venue: pSpec.venue || null,
                pool_type: pSpec.pool_type || null, status: 'open', closed_at: null, created_by_name: pMyName, can_run: true },
    groups, entries,
  }
}

function newEntry(pKey, pRgId, pMember, pExpected, pKind = 'member') {
  const guest = pKind === 'guest'
  return {
    id: `${pKey}:e:${pMember.athlete_user_id}`, register_group_id: pRgId,
    athlete_user_id: guest ? null : pMember.athlete_user_id, person_key: pMember.athlete_user_id, kind: pKind,
    name: pMember.name, is_junior: !!pMember.is_junior, expected: pExpected, attendance: 'expected',
    in_at: null, attendance_at: null, out_at: null, out_state_at: null, completion: null, partial_reason: null,
    done_m: null, done_pct: null, coach_note: null, athlete_note: null,
  }
}

// Apply one op to a sheet. → { sheet, error } (error = 'CODE: words', sheet unchanged).
// pMembers: optional { [org_id]: [{ athlete_user_id, name, is_junior }] } for 'add' and for taps on
// someone not on the sheet yet. pNow (ms) clamps device clocks more than 10 min ahead, like the server.
export function applyOp(pSheet, pOp, pMembers = null, pNow = Date.now()) {
  const err = (m) => ({ sheet: pSheet, error: m })
  if (!pSheet) return err('NOT_FOUND: no such register')
  let mAt = pOp.at || new Date(pNow).toISOString()
  if (t(mAt) > pNow + 10 * 60000) mAt = new Date(pNow).toISOString()
  let e = pSheet.entries.find((x) => personKey(x) === pOp.athlete_user_id)
  let entries = pSheet.entries

  if (!e && pOp.action === 'guest') {
    const name = (pOp.detail?.name || '').trim()
    if (!name) return err('INVALID: type the guest\'s name')
    const g = pSheet.groups.find((x) => (!pOp.org_id || x.org_id === pOp.org_id) && x.can_take !== false)
    if (!g) return err('NOT_ALLOWED: you cannot take that group')
    e = { ...newEntry(pSheet.register.id, g.id, { athlete_user_id: pOp.athlete_user_id, name: name.slice(0, 80) }, false, 'guest'),
          attendance: 'in', in_at: mAt, attendance_at: mAt }
    return { sheet: { ...pSheet, entries: [...entries, e].sort((a, b) => (a.name || '').localeCompare(b.name || '')) }, error: null }
  }
  if (!e && String(pOp.athlete_user_id || '').startsWith(GUEST_PREFIX)) return err('NOT_FOUND: that guest isn\'t on the register')

  if (!e) {
    const g = pSheet.groups.find((x) => (!pOp.org_id || x.org_id === pOp.org_id)
      && (pMembers?.[x.org_id] || []).some((m) => m.athlete_user_id === pOp.athlete_user_id))
    if (!g) return err('NOT_A_MEMBER: only active members of the register\'s groups can be on it')
    const m = pMembers[g.org_id].find((x) => x.athlete_user_id === pOp.athlete_user_id)
    e = newEntry(pSheet.register.id, g.id, m, false)
    entries = [...entries, e].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }
  const g = pSheet.groups.find((x) => x.id === e.register_group_id)
  if (g && g.can_take === false) return err('NOT_ALLOWED: you cannot take this group\'s register')
  if (pOp.action === 'add' || pOp.action === 'guest') return { sheet: { ...pSheet, entries }, error: null }
  if (pOp.action === 'comment') {
    const n = { ...e, coach_note: (pOp.detail?.comment || '').trim() || null }
    return { sheet: { ...pSheet, entries: entries.map((x) => (x.id === e.id ? n : x)) }, error: null }
  }

  let n = { ...e }
  if (ATTENDANCE.includes(pOp.action)) {
    if (e.attendance_at && t(mAt) < t(e.attendance_at)) return { sheet: { ...pSheet, entries }, error: null }
    if (pOp.action !== 'in' && e.completion) return err('SIGNED_OUT: undo the sign-out first')
    n.attendance = pOp.action === 'in' ? 'in' : pOp.action === 'undo_in' ? 'expected' : pOp.action
    n.in_at = pOp.action === 'in' ? (e.attendance === 'in' && e.in_at ? e.in_at : mAt) : null
    n.attendance_at = mAt
  } else if (SIGN_OUT.includes(pOp.action)) {
    if (e.out_state_at && t(mAt) < t(e.out_state_at)) return { sheet: { ...pSheet, entries }, error: null }
    if (pOp.action !== 'undo_out' && e.attendance !== 'in') return err('NOT_IN: tick them in before signing them out')
    const d = pOp.detail || {}
    if (pOp.action === 'out_partial' && !REASONS.includes(d.reason)) {
      return err('INVALID: a partial sign-out needs a reason (left_early, unwell, injured, other)')
    }
    const p = pOp.action === 'out_partial'
    n.completion = pOp.action === 'out_full' ? 'full' : p ? 'partial' : null
    n.out_at = pOp.action === 'undo_out' ? null : mAt
    n.partial_reason = p ? d.reason : null
    n.done_m = p ? (d.done_m ?? null) : null
    n.done_pct = p ? (d.done_pct ?? null) : null
    n.coach_note = p ? ((d.note || '').trim() || null) : e.coach_note
    n.out_state_at = mAt
  } else {
    return err('INVALID: unknown register action ' + pOp.action)
  }
  return { sheet: { ...pSheet, entries: entries.map((x) => (x.id === e.id ? n : x)) }, error: null }
}

// The sheet as the coach should see it: the last copy from the server (or the phone-made one)
// with the not-yet-sent taps on top, in time order. Taps the rules refuse are skipped.
export function viewWithPending(pBase, pOps, pMembers = null, pNow = Date.now()) {
  let s = pBase
  const mOps = [...(pOps || [])].sort((a, b) => t(a.at) - t(b.at))
  for (const op of mOps) s = applyOp(s, op, pMembers, pNow).sheet
  return s
}

// "Sign everyone still in out": one out_full per entry in and not out, in groups I can take.
export function signOutAllOps(pSheet, pAt, pNewUuid) {
  const mTake = new Set(pSheet.groups.filter((g) => g.can_take !== false).map((g) => g.id))
  return pSheet.entries
    .filter((e) => e.attendance === 'in' && !e.completion && mTake.has(e.register_group_id))
    .map((e) => ({ client_uuid: pNewUuid(), athlete_user_id: personKey(e), org_id: orgOf(pSheet, e),
                   action: 'out_full', at: pAt, detail: { bulk: true } }))
}

export const orgOf = (pSheet, pEntry) => pSheet.groups.find((g) => g.id === pEntry.register_group_id)?.org_id || null

// How many are in but not signed out (closing is refused while > 0, unless forced).
export const stillIn = (pSheet) => (pSheet?.entries || []).filter((e) => e.attendance === 'in' && !e.completion).length

// { org_id: members[] } from register_prepare().groups
export const membersByOrg = (pGroups) => Object.fromEntries((pGroups || []).map((g) => [g.org_id, g.members || []]))

// Did this fail because there's no connection (rather than the database saying no)?
// supabase-js reports network failures as a TypeError message with no Postgres code.
export function isNetworkError(pError, pOnline = true) {
  if (!pError) return false
  if (pOnline === false) return true
  if (pError.code && /^[0-9A-Z]{5}$/.test(pError.code)) return false     // a Postgres error code: the DB answered
  return /fetch|network|load failed|timed? ?out|offline|ECONN|ENOTFOUND|aborted/i.test(pError.message || String(pError))
}
