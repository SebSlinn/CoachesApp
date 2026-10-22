// Registers with or without signal. The register screens talk to this file.
//
//   Every tap is applied on the phone first (same rules as the database, registerOffline.js),
//   queued with its own time and client_uuid, then sent with sync_register. With signal that's
//   immediate; without, the queue waits and goes when signal returns. Sending twice is harmless.
//   "Get ready" (prepareForPoolside) downloads the group lists and recent registers so a register
//   can be opened, or started, with no signal at all.
//
// Talks to the RepositoryFactory only (server repository + the phone store). Pure rules live in
// registerOffline.js; words in registerLabels.js. Plan: claude-docs/teams/REGISTERS.md ("Offline").
import { getRegisterRepository, getRegisterStore } from '../repositories/RepositoryFactory'
import {
  LOCAL_PREFIX, GUEST_PREFIX, isLocalKey, buildLocalSheet, applyOp, viewWithPending, signOutAllOps, orgOf, stillIn,
  membersByOrg, isNetworkError, personKey,
} from './registerOffline'
import { rollCall, toIso } from './registerLabels'

const repo = () => getRegisterRepository()
const store = () => getRegisterStore()
const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)
const netErr = (e) => isNetworkError(e, online())
const newUuid = () => globalThis.crypto.randomUUID()
const bad = (m) => ({ data: null, error: { message: m } })
const nowIso = () => new Date().toISOString()
let flushing = null   // one sync at a time

// ---------------------------------------------------------------------------
// Getting ready
// ---------------------------------------------------------------------------
// Download my registerable groups with their members, and recent/upcoming registers.
export async function prepareForPoolside() {
  const r = await repo().prepare()
  if (r.error) return { data: null, error: netErr(r.error) ? { message: 'OFFLINE: needs signal — try again with internet' } : r.error }
  const p = r.data
  const s = store().update((st) => {
    // A different person signed in on this phone: start clean (their queue is theirs).
    if (st.userId && st.userId !== p.user_id) st = { ...st, sheets: {}, pending: {}, failed: [], moved: {} }
    st.userId = p.user_id; st.preparedAt = p.prepared_at; st.groups = p.groups || []
    for (const sh of p.registers || []) st.sheets[sh.register.id] = sh
    return st
  })
  return { data: summaryOf(s), error: null }
}

export const offlineSummary = () => summaryOf(store().read())
function summaryOf(st) {
  const mPend = Object.values(st.pending || {})
  return {
    userId: st.userId, preparedAt: st.preparedAt, groups: (st.groups || []).map((g) => ({ org_id: g.org_id, name: g.name })),
    pendingTaps: mPend.reduce((a, p) => a + (p.ops?.length || 0), 0),
    pendingRegisters: mPend.filter((p) => (p.ops?.length || 0) > 0 || p.create || p.close || p.comment != null).length,
    failed: st.failed || [],
  }
}

// Can the register screens run for this device with no signal? (prepared, and still signed in here)
export function canUseOffline() {
  const st = store().read()
  return !!st.userId && store().hasDeviceSession(st.userId)
}

export const dismissFailed = () => { store().update((st) => ({ ...st, failed: [] })) }

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------
// Rows like my_registers(), plus registers made on this phone that haven't synced; falls back to
// the phone's copies with no signal. → { data: rows, offline }
export async function listForScreen(pFrom = null) {
  await flushAll()
  const st = store().read()
  const mLocal = Object.keys(st.pending).filter(isLocalKey).map((k) => rowFromSheet(st, k)).filter(Boolean)
  const r = await repo().list(pFrom, null)
  if (!r.error) return { data: [...mLocal, ...(r.data || []).map((x) => ({ ...x, key: x.register_id }))], error: null, offline: false }
  if (!netErr(r.error)) return { data: null, error: r.error, offline: false }
  const mRows = Object.keys(st.sheets).filter((k) => !isLocalKey(k)).map((k) => rowFromSheet(st, k)).filter(Boolean)
  return { data: [...mLocal, ...mRows].sort((a, b) => (b.starts_at || '').localeCompare(a.starts_at || '')), error: null, offline: true }
}

function rowFromSheet(st, pKey) {
  const v = viewOf(st, pKey)
  if (!v) return null
  const c = rollCall(v.entries).all
  return {
    key: pKey, register_id: isLocalKey(pKey) ? null : pKey, starts_at: v.register.starts_at, ends_at: v.register.ends_at,
    venue: v.register.venue, pool_type: v.register.pool_type, status: v.register.status,
    org_ids: v.groups.map((g) => g.org_id), group_names: v.groups.map((g) => g.name), can_run: v.register.can_run !== false,
    expected: c.on, in_count: c.in, out_count: c.out, still_in: c.stillIn,
    unsynced: (st.pending[pKey]?.ops?.length || 0) + (st.pending[pKey]?.create ? 1 : 0),
  }
}

// ---------------------------------------------------------------------------
// One register
// ---------------------------------------------------------------------------
// The sheet to show. → { data: { key, sheet, pending, offline, movedTo } }
// movedTo: a phone-made register has synced and now has a real id — open that instead.
export async function openRegister(pKey) {
  let st = store().read()
  if (st.moved[pKey]) return { data: { key: pKey, movedTo: st.moved[pKey] }, error: null }
  const f = await flushOne(pKey)
  st = store().read()
  if (st.moved[pKey]) return { data: { key: pKey, movedTo: st.moved[pKey] }, error: null }
  let offline = !!f?.offline
  if (!isLocalKey(pKey)) {
    const r = await repo().getSheet(pKey)
    if (!r.error) { st = store().update((x) => { x.sheets[pKey] = r.data; return x }) }
    else if (netErr(r.error)) offline = true
    else return { data: null, error: r.error }
  }
  const v = viewOf(st, pKey)
  if (!v) return { data: null, error: { message: offline ? 'OFFLINE: this register isn\'t on this phone. Use "Get ready" with signal first.' : 'NOT_FOUND: no such register' } }
  return { data: { key: pKey, sheet: v, pending: st.pending[pKey]?.ops?.length || 0, offline }, error: null }
}

function viewOf(st, pKey) {
  const base = st.sheets[pKey]
  if (!base) return null
  const p = st.pending[pKey]
  let v = viewWithPending(base, p?.ops, membersByOrg(st.groups))
  if (p?.close) v = { ...v, register: { ...v.register, status: 'closed' } }
  if (p?.comment != null) v = { ...v, register: { ...v.register, comment: p.comment || null } }
  return v
}

// Start a register. With signal the server makes it; without, the phone does (from "Get ready" lists).
// pForm: { orgIds, date, startTime, endTime?, venue?, poolType? } → { data: key }
export async function startRegister(pForm) {
  const mOrgIds = [...new Set(pForm?.orgIds || [])]
  if (!mOrgIds.length) return bad('INVALID: pick at least one group')
  const mStart = toIso(pForm.date, pForm.startTime)
  if (!mStart) return bad('INVALID: a date and start time are required')
  const mEnd = pForm.endTime ? toIso(pForm.date, pForm.endTime) : null
  if (pForm.endTime && (!mEnd || mEnd <= mStart)) return bad('INVALID: the end must be after the start')
  const spec = { client_uuid: newUuid(), org_ids: mOrgIds, starts_at: mStart, ends_at: mEnd,
                 venue: (pForm.venue || '').trim() || null, pool_type: pForm.poolType || null }

  const r = await repo().create({ orgIds: spec.org_ids, startsAt: spec.starts_at, endsAt: spec.ends_at,
    venue: spec.venue, poolType: spec.pool_type, clientUuid: spec.client_uuid })
  if (!r.error) return { data: r.data, error: null }
  if (!netErr(r.error)) return r

  const st = store().read()
  if (!st.userId || !st.groups.length) return bad('OFFLINE: no signal, and this phone has no group lists yet. Use "Get ready" with signal first.')
  const mMissing = mOrgIds.filter((id) => !st.groups.some((g) => g.org_id === id))
  if (mMissing.length) return bad('OFFLINE: one of those groups isn\'t on this phone. Use "Get ready" with signal first.')
  const key = LOCAL_PREFIX + spec.client_uuid
  store().update((x) => {
    x.sheets[key] = buildLocalSheet(spec, x.groups, 'you (on this phone)')
    x.pending[key] = { registerId: null, create: spec, ops: [], close: null }
    return x
  })
  return { data: key, error: null, offline: true }
}

// One tap on one entry. pAction: in | undo_in | absent | apologies | expected | out_full | out_partial | undo_out
// pDetail for out_partial: { reason, done_m, done_pct, note }. → same shape as openRegister.
export async function tap(pKey, pEntry, pAction, pDetail = {}) {
  const st = store().read()
  const v = viewOf(st, pKey)
  if (!v) return bad('NOT_FOUND: open the register again')
  const op = { client_uuid: newUuid(), athlete_user_id: personKey(pEntry), org_id: orgOf(v, pEntry),
               action: pAction, at: nowIso(), detail: pDetail || {} }
  return queue(pKey, [op])
}

// A typed-in guest (name only), ticked in now. Works offline.
export async function addGuest(pKey, pRegisterGroup, pName) {
  const name = (pName || '').trim()
  if (!name) return bad('INVALID: type the guest\'s name')
  const op = { client_uuid: newUuid(), athlete_user_id: GUEST_PREFIX + newUuid(), org_id: pRegisterGroup.org_id,
               action: 'guest', at: nowIso(), detail: { name: name.slice(0, 80) } }
  return queue(pKey, [op])
}

// The coach's comment on one swimmer (empty clears it). Works offline.
export async function commentEntry(pKey, pEntry, pText) {
  return tap(pKey, pEntry, 'comment', { comment: (pText || '').trim() })
}

// The comment on the whole session. Works offline (sent with the next sync).
export async function commentRegister(pKey, pText) {
  if (!viewOf(store().read(), pKey)) return bad('NOT_FOUND: open the register again')
  store().update((x) => { x.pending[pKey] = { ...emptyPending(pKey), ...(x.pending[pKey] || {}), comment: (pText || '').trim() }; return x })
  return openRegister(pKey)
}

// Partial sign-out with checks. pPartial: { reason, doneM?, donePct?, note? }
export async function tapPartial(pKey, pEntry, pPartial = {}) {
  const num = (x) => (x === '' || x == null ? null : Number(x))
  const m = num(pPartial.doneM); const pc = num(pPartial.donePct)
  if (m != null && !(Number.isInteger(m) && m >= 0)) return bad('INVALID: metres done must be a whole number')
  if (pc != null && !(Number.isInteger(pc) && pc >= 0 && pc <= 100)) return bad('INVALID: % done must be 0–100')
  return tap(pKey, pEntry, 'out_partial', { reason: pPartial.reason, done_m: m, done_pct: pc, note: (pPartial.note || '').trim() || null })
}

// Put a member of one of the register's groups on it. pMember: { athlete_user_id }
export async function addSwimmer(pKey, pRegisterGroup, pMember) {
  const op = { client_uuid: newUuid(), athlete_user_id: pMember.athlete_user_id, org_id: pRegisterGroup.org_id,
               action: 'add', at: nowIso(), detail: {} }
  return queue(pKey, [op])
}

// Members of the group not on the register: from the server with signal, else from "Get ready".
export async function swimmersToAdd(pKey, pRegisterGroup) {
  if (!isLocalKey(pKey) && !isLocalKey(pRegisterGroup.id)) {
    const r = await repo().getCandidates(pRegisterGroup.id)
    if (!r.error) return r
    if (!netErr(r.error)) return r
  }
  const st = store().read()
  const v = viewOf(st, pKey)
  const on = new Set((v?.entries || []).map((e) => e.athlete_user_id))
  const g = st.groups.find((x) => x.org_id === pRegisterGroup.org_id)
  return { data: (g?.members || []).filter((m) => !on.has(m.athlete_user_id)), error: null }
}

export async function tapSignOutAll(pKey) {
  const v = viewOf(store().read(), pKey)
  if (!v) return bad('NOT_FOUND: open the register again')
  const ops = signOutAllOps(v, nowIso(), newUuid)
  if (!ops.length) return openRegister(pKey)
  const r = await queue(pKey, ops)
  return r.error ? r : { ...r, signedOut: ops.length }
}

// Close. Refused while anyone is in but not out, unless pForce (the coach has checked).
export async function tapClose(pKey, pForce = false) {
  const v = viewOf(store().read(), pKey)
  if (!v) return bad('NOT_FOUND: open the register again')
  if (v.register.can_run === false) return bad('NOT_ALLOWED: you need take_register in every group on the register')
  const n = stillIn(v)
  if (n > 0 && !pForce) return bad(`STILL_IN: ${n} swimmer(s) ticked in but not signed out`)
  store().update((x) => { x.pending[pKey] = { ...emptyPending(pKey), ...(x.pending[pKey] || {}), close: { force: !!pForce } }; return x })
  return openRegister(pKey)
}

// Reopen needs signal (it's rare, and a manager's decision).
export async function reopen(pKey) {
  if (isLocalKey(pKey)) return bad('OFFLINE: sync this register first')
  const r = await repo().reopen(pKey)
  if (r.error) return netErr(r.error) ? bad('OFFLINE: reopening needs signal') : r
  return openRegister(pKey)
}

// Check against the rules, store, then try to send.
async function queue(pKey, pOps) {
  const st = store().read()
  let v = viewOf(st, pKey)
  if (!v) return bad('NOT_FOUND: open the register again')
  if (v.register.status === 'closed') return bad('CLOSED: this register is closed. Reopen it first.')
  const members = membersByOrg(st.groups)
  for (const op of pOps) {
    const r = applyOp(v, op, members)
    if (r.error) return bad(r.error)
    v = r.sheet
  }
  store().update((x) => {
    const p = x.pending[pKey] || emptyPending(pKey)
    x.pending[pKey] = { ...p, ops: [...(p.ops || []), ...pOps] }
    return x
  })
  return openRegister(pKey)   // sends the queue if there's signal, then shows the result
}

const emptyPending = (pKey) => ({ registerId: isLocalKey(pKey) ? null : pKey, create: null, ops: [], close: null, comment: null })

// ---------------------------------------------------------------------------
// Sending the queue
// ---------------------------------------------------------------------------
export async function flushAll() {
  for (const k of Object.keys(store().read().pending)) await flushOne(k)
  return { data: offlineSummary(), error: null }
}

// Send one register's queue. Leaves it queued if there's no signal.
export async function flushOne(pKey) {
  if (flushing) await flushing.catch(() => {})
  flushing = (async () => {
    const st = store().read()
    const p = st.pending[pKey]
    if (!p) return { sent: 0 }
    if (!p.ops?.length && !p.create && !p.close && p.comment == null) {
      store().update((x) => { delete x.pending[pKey]; return x })
      return { sent: 0 }
    }
    const sent = new Set((p.ops || []).map((o) => o.client_uuid))
    const payload = { register_id: isLocalKey(pKey) ? null : pKey, create: p.create || null, ops: p.ops || [], close: p.close || null }
    if (p.comment != null) payload.comment = p.comment
    const r = await repo().sync(payload)
    if (r.error) {
      if (netErr(r.error)) return { offline: true }
      // The database refused the whole register (e.g. permission): keep the taps visible as failed.
      store().update((x) => {
        x.failed = [...(x.failed || []), ...(p.ops || []).map((op) => ({ registerKey: pKey, op, error: r.error.message, at: nowIso() }))]
        delete x.pending[pKey]
        return x
      })
      return { error: r.error }
    }
    const res = r.data
    store().update((x) => {
      const cur = x.pending[pKey] || emptyPending(pKey)
      const left = (cur.ops || []).filter((o) => !sent.has(o.client_uuid))
      for (const rr of res.results || []) {
        if (!rr.ok) {
          const op = (p.ops || []).find((o) => o.client_uuid === rr.client_uuid)
          x.failed = [...(x.failed || []), { registerKey: res.register_id, op, error: rr.error, at: nowIso() }]
        }
      }
      if (res.close && !res.close.ok) x.failed = [...(x.failed || []), { registerKey: res.register_id, op: { action: 'close' }, error: res.close.error, at: nowIso() }]
      x.sheets[res.register_id] = res.sheet
      const rest = { registerId: res.register_id, create: null, ops: left, close: p.close && res.close ? null : cur.close,
                     comment: cur.comment !== p.comment ? cur.comment : null }
      if (isLocalKey(pKey)) {
        x.moved[pKey] = res.register_id
        delete x.sheets[pKey]
        delete x.pending[pKey]
      }
      if (rest.ops.length || rest.close || rest.comment != null) x.pending[res.register_id] = rest
      else if (!isLocalKey(pKey)) delete x.pending[pKey]
      return x
    })
    return { sent: sent.size }
  })()
  try { return await flushing } finally { flushing = null }
}
