// Registers: start one for your groups, tick swimmers in, sign them out (full or partial),
// close it; the athlete's note on their own entry. Goes through IRegisterRepository via the
// RepositoryFactory; the database enforces every rule (take_register, members only).
// Words and pure helpers live in registerLabels.js. Plan: claude-docs/teams/REGISTERS-PLAN.md.
import { getRegisterRepository } from '../repositories/RepositoryFactory'
import { ACTIONS, PARTIAL_REASONS, toIso } from './registerLabels'
export { errorText } from './accountErrors'

const repo = () => getRegisterRepository()
const bad = (m) => ({ data: null, error: { message: 'INVALID: ' + m } })
// A client id per create/tap, so a retry after a dropped connection is a no-op in the DB.
const newUuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : null)

// ---- reads ----
// Registers I can see, newest first. pFrom/pTo: ISO timestamps or null.
export const listRegisters = async (pFrom = null, pTo = null) => repo().list(pFrom, pTo)
export const getRegisterSheet = async (pRegisterId) => repo().getSheet(pRegisterId)
export const getRegisterCandidates = async (pRegisterGroupId) => repo().getCandidates(pRegisterGroupId)
// The athlete's own entries; a guardian passes their junior's id.
export const getAthleteRegisterEntries = async (pAthleteId, pFrom = null, pTo = null) =>
  repo().getAthleteEntries(pAthleteId, pFrom, pTo)

// ---- writes ----
// pRegister: { orgIds, date:'YYYY-MM-DD', startTime:'HH:MM', endTime?:'HH:MM', venue?, poolType? }
export const createRegister = async (pRegister) => {
  const mOrgIds = [...new Set(pRegister?.orgIds || [])]
  if (!mOrgIds.length) return bad('pick at least one group')
  const mStart = toIso(pRegister.date, pRegister.startTime)
  if (!mStart) return bad('a date and start time are required')
  const mEnd = pRegister.endTime ? toIso(pRegister.date, pRegister.endTime) : null
  if (pRegister.endTime && (!mEnd || mEnd <= mStart)) return bad('the end must be after the start')
  return repo().create({
    orgIds: mOrgIds, startsAt: mStart, endsAt: mEnd,
    venue: (pRegister.venue || '').trim() || null, poolType: pRegister.poolType || null,
    clientUuid: pRegister.clientUuid || newUuid(),
  })
}

export const addRegisterGroup = async (pRegisterId, pOrgId) => repo().addGroup(pRegisterId, pOrgId)
export const addRegisterEntry = async (pRegisterGroupId, pAthleteId) => repo().addEntry(pRegisterGroupId, pAthleteId)

// One tap. pOpts: { at (ISO, default now), detail, clientUuid }
export const markEntry = async (pEntryId, pAction, pOpts = {}) => {
  if (!ACTIONS.includes(pAction)) return bad('unknown register action ' + pAction)
  return repo().mark(pEntryId, pAction, pOpts.at || new Date().toISOString(), pOpts.detail || {},
    pOpts.clientUuid || newUuid())
}
export const tickIn = async (pEntryId, pOpts) => markEntry(pEntryId, 'in', pOpts)
export const signOutFull = async (pEntryId, pOpts) => markEntry(pEntryId, 'out_full', pOpts)
// pPartial: { reason, doneM?, donePct?, note? }
export const signOutPartial = async (pEntryId, pPartial = {}, pOpts = {}) => {
  if (!PARTIAL_REASONS.some((r) => r.key === pPartial.reason)) return bad('pick a reason for the partial sign-out')
  const num = (v) => (v === '' || v == null ? null : Number(v))
  const mDoneM = num(pPartial.doneM); const mDonePct = num(pPartial.donePct)
  if (mDoneM != null && !(Number.isInteger(mDoneM) && mDoneM >= 0)) return bad('metres done must be a whole number')
  if (mDonePct != null && !(Number.isInteger(mDonePct) && mDonePct >= 0 && mDonePct <= 100)) return bad('% done must be 0–100')
  return markEntry(pEntryId, 'out_partial', { ...pOpts,
    detail: { reason: pPartial.reason, done_m: mDoneM, done_pct: mDonePct, note: (pPartial.note || '').trim() || null } })
}

export const signOutAll = async (pRegisterId) => repo().signOutAll(pRegisterId, new Date().toISOString())
// Refused with STILL_IN while anyone is in but not out, unless pForce (the coach has checked).
export const closeRegister = async (pRegisterId, pForce = false) => repo().close(pRegisterId, pForce)
export const reopenRegister = async (pRegisterId) => repo().reopen(pRegisterId)

// The swimmer's (or guardian's) note. pShare: true = coaches may read it; null = leave as it is.
export const setRegisterNote = async (pEntryId, pNote, pShare = null) => repo().setNote(pEntryId, pNote, pShare)
