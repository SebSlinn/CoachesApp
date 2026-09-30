//services/protocols.js
// The Test Set Library: named, versioned tests coaches share (see
// TEST-PROTOCOLS-CONTEXT.md). Goes through IProtocolsRepository via the
// RepositoryFactory. Visibility (global library + your club's subtree) and edit
// rights are enforced by the database; a protocol locks on first use.
//
// Pure logic (validation, params, prescriptions, analysers) lives in
// session/protocolFormat.js so Poolside can share it.
import { getProtocolsRepository } from '../repositories/RepositoryFactory'
import { validateProtocol, prescribe, prescribeGroup } from '../session/protocolFormat'
import { getAthleteBests } from './results'

const repo = () => getProtocolsRepository()
const invalid = (pMessage) => ({ data: null, error: { message: pMessage } })

// Fields a coach may still change once a protocol has been used.
const EDITABLE_WHEN_LOCKED = ['name', 'description']
const DEFINITION_FIELDS = ['key', 'set', 'measures', 'params', 'analyser']

// The library as a picker wants it: the LATEST version of each test, global
// first then club-private, alphabetical. pOpts.allVersions = true returns every
// version (for history / comparing across versions).
// Each protocol gains `scope`: 'global' | 'club'.
export const listProtocols = async (pOpts = {}) => {
  const { data, error } = await repo().list({ key: pOpts.key })
  if (error) return { data: null, error }
  const mAll = (data || []).map((p) => ({ ...p, scope: p.ownerOrgId ? 'club' : 'global' }))
  let mOut = mAll
  if (!pOpts.allVersions) {
    const mLatest = new Map()          // `${owner}|${key}` → highest version
    for (const p of mAll) {
      const k = `${p.ownerOrgId || ''}|${p.key}`
      if (!mLatest.has(k) || p.version > mLatest.get(k).version) mLatest.set(k, p)
    }
    mOut = [...mLatest.values()]
  }
  mOut.sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'global' ? -1 : 1)
    || a.name.localeCompare(b.name) || b.version - a.version)
  return { data: mOut, error: null }
}

export const getProtocol = async (pId) => repo().get(pId)

// Add a new test (version 1). pOrgId null = the global library (root only);
// otherwise a club you coach/administer.
export const createProtocol = async (pOrgId, pDef) => {
  const mProtocol = {
    key: pDef.key, version: 1, name: pDef.name, description: pDef.description ?? null,
    ownerOrgId: pOrgId || null, set: pDef.set, measures: pDef.measures || ['time'],
    params: pDef.params || {}, analyser: pDef.analyser || 'series',
  }
  const mProblem = validateProtocol(mProtocol)
  if (mProblem) return invalid(`INVALID protocol: ${mProblem}`)
  return repo().create(mProtocol)
}

// Change a protocol. Unused (unlocked) → any field. Used (locked) → name and
// description only; for anything else call newVersion(). The DB enforces the
// same rule; this just gives a clear message first.
export const updateProtocol = async (pId, pChanges) => {
  const { data: mCur, error } = await repo().get(pId)
  if (error) return { data: null, error }
  if (mCur.locked) {
    const mBad = Object.keys(pChanges).filter((k) => !EDITABLE_WHEN_LOCKED.includes(k))
    if (mBad.length) {
      return invalid(`LOCKED: ${mCur.name} v${mCur.version} has results against it — change ${mBad.join(', ')} by creating version ${mCur.version + 1}`)
    }
  }
  if (DEFINITION_FIELDS.some((k) => pChanges[k] !== undefined)) {
    const mProblem = validateProtocol({ ...mCur, ...pChanges })
    if (mProblem) return invalid(`INVALID protocol: ${mProblem}`)
  }
  return repo().update(pId, pChanges)
}

// A new version of an existing test: same key and owner, next version number,
// with pChanges applied. The old version (and every result against it) is kept.
export const newVersion = async (pId, pChanges = {}) => {
  const { data: mCur, error } = await repo().get(pId)
  if (error) return { data: null, error }
  const { data: mMax, error: e2 } = await repo().maxVersion(mCur.ownerOrgId, mCur.key)
  if (e2) return { data: null, error: e2 }
  const mNext = {
    key: mCur.key, ownerOrgId: mCur.ownerOrgId,
    name: pChanges.name ?? mCur.name, description: pChanges.description ?? mCur.description,
    set: pChanges.set ?? mCur.set, measures: pChanges.measures ?? mCur.measures,
    params: pChanges.params ?? mCur.params, analyser: pChanges.analyser ?? mCur.analyser,
    version: Math.max(mMax || 0, mCur.version) + 1,
  }
  const mProblem = validateProtocol(mNext)
  if (mProblem) return invalid(`INVALID protocol: ${mProblem}`)
  return repo().create(mNext)
}

// Only an unused protocol can be deleted (a used one is kept for its results).
export const deleteProtocol = async (pId) => repo().remove(pId)

// ── Prescriptions ──────────────────────────────────────────────────────────
// A test resolved for real swimmers: the chosen params (send-off, rest) plus
// each athlete's own targets from their bests. This is what the library UI
// previews and what gets handed to Poolside.
//
//   pAthletes: [{ id, name }]   — pbByEvent is fetched for each from their records
//   pOpts: { chosen: { sendOff:'5:30' }, windowMonths: 12 }   (window: which bests to use)
export const prescribeForAthletes = async (pProtocolId, pAthletes = [], pOpts = {}) => {
  const { data: mProtocol, error } = await repo().get(pProtocolId)
  if (error) return { data: null, error }
  const mWith = []
  for (const a of pAthletes) {
    const { data: mBests, error: e2 } = await getAthleteBests(a.id, { windowMonths: pOpts.windowMonths })
    if (e2) return { data: null, error: e2 }
    mWith.push({ id: a.id, name: a.name || '', pbByEvent: (mBests && mBests.pbByEvent) || {} })
  }
  return { data: prescribeGroup(mProtocol, { chosen: pOpts.chosen || {}, athletes: mWith }), error: null }
}

// Same, for one athlete whose bests the page already has (e.g. the loaded
// athlete in Athlete Setup) — no fetch.
export const prescribeForLoadedAthlete = (pProtocol, pAthlete, pChosen = {}) =>
  prescribe(pProtocol, { chosen: pChosen, athlete: pAthlete })
