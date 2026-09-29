//src/services/results.js

//services/results.js
// An athlete's performance results (training / meet log).
// Goes through IResultsRepository via the RepositoryFactory. Results use the
// app's field names (distM, timeSec, poolType, note ...) — see
// repositories/interfaces/IResultsRepository.js for the full shape.
// Who may read/add/edit is enforced by the database.
//
// Athlete Records (Part A): append-only import, sets-as-swum, progression
// history. Set snapshots use swimzone.set/1 (see session/setFormat).
import { getResultsRepository } from '../repositories/RepositoryFactory'
import { validateSetFormat } from '../session/setFormat'
import { recordsToResultRows } from '../athlete/swimmingResults'

const repo = () => getResultsRepository()

const STROKES = ['FS', 'BK', 'BR', 'Fly', 'IM', 'Kick']
const POOLS = ['25SC', '50LC', '25Y']

// Returns an error message, or null if the result looks valid.
// pPartial = true for updates, where only changed fields are present.
export function validateResult(pResult, pPartial = false) {
  const mHas = (k) => pResult[k] !== undefined
  if ((!pPartial || mHas('stroke')) && !STROKES.includes(pResult.stroke)) return 'INVALID: choose a stroke'
  if ((!pPartial || mHas('distM')) && !(Number(pResult.distM) > 0)) return 'INVALID: distance must be more than 0'
  if ((!pPartial || mHas('timeSec')) && !(Number(pResult.timeSec) > 0)) return 'INVALID: time must be more than 0'
  if (mHas('poolType') && pResult.poolType != null && !POOLS.includes(pResult.poolType)) return 'INVALID: unknown pool type'
  return null
}

// Fill effort when the caller didn't set it, so single swims land in the right
// bucket for PB/CS queries (which count only effort='maximal'). A race or a
// time trial is a maximal effort; a stopwatch training swim is submaximal;
// otherwise leave it unknown.
function withEffort(pResult) {
  if (pResult.effort) return pResult
  let effort = 'unknown'
  if (pResult.kind === 'meet' || pResult.kind === 'time_trial') effort = 'maximal'
  else if (pResult.source === 'stopwatch') effort = 'submaximal'
  return { ...pResult, effort }
}

const invalid = (pMessage) => ({ data: null, error: { message: pMessage } })

// pFilter: { stroke, distM, kind, from, to } — all optional. Single swims only
// (set reps are excluded; see getSetResults for those).
export const getResults = async (pAthleteId, pFilter = {}) => repo().list(pAthleteId, pFilter)

// All single swims for one event, oldest→newest — for a progression graph that
// shows improvement AND regression (every race kept, never overwritten).
export const getResultHistory = async (pAthleteId, pFilter = {}) => repo().listHistory(pAthleteId, pFilter)

export const addResult = async (pAthleteId, pResult) => {
  const mProblem = validateResult(pResult)
  return mProblem ? invalid(mProblem) : repo().add(pAthleteId, withEffort(pResult))
}

// e.g. a poolside stopwatch export: [{ stroke, distM, timeSec, splits, source: 'stopwatch' }, ...]
export const addResults = async (pAthleteId, pResults) => {
  for (const [i, mResult] of pResults.entries()) {
    const mProblem = validateResult(mResult)
    if (mProblem) return invalid(`${mProblem} (row ${i + 1})`)
  }
  return repo().addMany(pAthleteId, pResults.map(withEffort))
}

// Append-only competition import, idempotent via a DETERMINISTIC client_uuid
// derived from each swim's natural key (its unique meet licence + event + date,
// or event+date+meet when no licence). Re-importing the same page is a no-op;
// dedup is keyed on client_uuid (a plain unique index that ON CONFLICT can use —
// unlike a partial/expression index, which Supabase upsert cannot target).
// Rows are official races → maximal. Returns { added, skipped }.
export const importResults = async (pAthleteId, pRows) => {
  if (!Array.isArray(pRows) || pRows.length === 0) return { data: { added: 0, skipped: 0 }, error: null }
  for (const [i, mRow] of pRows.entries()) {
    const mProblem = validateResult(mRow)
    if (mProblem) return invalid(`${mProblem} (row ${i + 1})`)
  }
  const mRows = pRows.map((r) => {
    // Dedup on the swim's NATURAL identity — athlete + stroke + distance + date +
    // time — so the SAME swim dedups whether it arrived from the best-times page
    // (which carries a meet licence) or a single-event page (which doesn't). A
    // heat and final on the same day differ by time, so both are kept. The meet
    // licence is still stored in import_ref for traceability, just not used here.
    const mNatural = `swim|${pAthleteId}|${r.stroke}|${r.distM}|${r.swumOn}|${r.timeSec}`
    return { effort: 'maximal', kind: r.kind || 'meet', source: 'import', ...r, id: r.id || stableUuid(mNatural) }
  })
  return repo().addManyIdempotent(pAthleteId, mRows)
}

function monthsSinceIso(pIso) {
  const t = Date.parse(pIso)
  if (isNaN(t)) return Infinity
  return (Date.now() - t) / (1000 * 60 * 60 * 24 * 30.4375)
}

// An athlete's bests, derived from their records: the fastest MAXIMAL single swim
// per event (set reps and submaximal swims excluded, as PB logic requires).
// Official (meet) and non-official (time_trial) rank purely on time — a trial
// neither out- nor under-ranks a meet; the ONLY selector is the time window.
//
//   getAthleteBests(id)                       → all-time bests (true PBs)
//   getAthleteBests(id, { windowMonths: 6 })  → fastest within the last 6 months
//                                               (the classify filter: 1 / 6 / 12 / all)
// An event with nothing inside the window is simply absent — pick a wider window.
// Returns { pbByEvent:{ 'FS100':64.0, ... }, bests:[ { stroke, distM, timeSec,
//           swumOn, poolType, kind, official, ageMonths } ] }.
// pbByEvent is the exact shape swimzone.set/1's resolveTarget() reads.
export const getAthleteBests = async (pAthleteId, pOpts = {}) => {
  const mWindow = pOpts.windowMonths || null   // null = all-time
  const { data, error } = await repo().listHistory(pAthleteId, {})
  if (error) return { data: null, error }
  const mBestRow = new Map()   // key `${stroke}${distM}` → row with min timeSec
  for (const mRow of data || []) {
    if (mRow.effort !== 'maximal') continue
    if (!(Number(mRow.timeSec) > 0)) continue
    if (mWindow && monthsSinceIso(mRow.swumOn) > mWindow) continue
    const mKey = `${mRow.stroke}${mRow.distM}`
    const mPrev = mBestRow.get(mKey)
    if (!mPrev || Number(mRow.timeSec) < Number(mPrev.timeSec)) mBestRow.set(mKey, mRow)
  }
  const pbByEvent = {}
  const bests = []
  for (const [mKey, mRow] of mBestRow) {
    pbByEvent[mKey] = Number(mRow.timeSec)
    bests.push({
      stroke: mRow.stroke, distM: mRow.distM, timeSec: Number(mRow.timeSec),
      swumOn: mRow.swumOn, poolType: mRow.poolType, kind: mRow.kind,
      official: mRow.kind === 'meet', ageMonths: Math.round(monthsSinceIso(mRow.swumOn) * 10) / 10,
    })
  }
  return { data: { pbByEvent, bests }, error: null }
}

// Persist official SwimmingResults records (parsed with full provenance: date,
// meet, venue, licence) as maximal meets. Append-only + deduped by event+date+meet
// so re-importing the same page is a no-op. This is the OFFICIAL path — richer
// than the grid (keeps both LC and SC PBs, and the meet detail).
export const importOfficialRecords = async (pAthleteId, pRecords) => {
  if (!pAthleteId) return invalid('INVALID: no athlete to save to — load an athlete first')
  const mRows = recordsToResultRows(pRecords || [], pAthleteId)
  if (mRows.length === 0) return { data: { added: 0, skipped: 0 }, error: null }
  return importResults(pAthleteId, mRows)
}

// ── Persisting the Athlete Setup time grid to the DB ───────────────────────
// The setup page parses SwimmingResults / accepts manual entry, but those times
// only lived in the local athlete object. This writes them to performance_results
// so they persist as the swimmer's log and best times.
//
// Split by provenance:
//   • dated times (parsed from SwimmingResults) → OFFICIAL meets (append-only,
//     deduped by event+date so re-parsing is a no-op).
//   • undated times (typed by the coach) → TIME TRIALS (non-official maximal
//     efforts), deduped by a deterministic key of (athlete, event, time) so
//     re-saving the same value doesn't duplicate; a changed value is a new trial.
// Both are maximal, so both feed PB/working-best queries.
const POOL_FROM_SETUP = { LC: '50LC', SC: '25SC' }

// Normalise a date to YYYY-MM-DD. SwimmingResults is UK, so slash/dot dates are
// DD/MM/YYYY — parsed explicitly, NOT via JS Date (which reads 12/03 as US
// December and would mis-order/mis-dedup a PB). ISO passes straight through.
function normIsoDate(pD) {
  if (!pD) return null
  const s = String(pD).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/)
  if (m) {
    const dd = m[1].padStart(2, '0'), mm = m[2].padStart(2, '0')
    let yy = m[3]
    if (yy.length === 2) yy = (Number(yy) > 70 ? '19' : '20') + yy
    const mo = Number(mm), da = Number(dd)
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return `${yy}-${mm}-${dd}`
  }
  return null   // unrecognised → treat as undated (a trial) rather than mis-date an official PB
}

// Deterministic UUID-shaped key (FNV-ish → v4 shape) so an unchanged manual time
// trial re-saved dedups to one row via the client_uuid unique index.
function stableUuid(pStr) {
  let h1 = 0x811c9dc5, h2 = 0x1000193
  for (let i = 0; i < pStr.length; i++) {
    const c = pStr.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0
    h2 = Math.imul(h2 ^ ((c << 5) | 3), 16777619) >>> 0
  }
  const hex = (n) => ('00000000' + (n >>> 0).toString(16)).slice(-8)
  const s = (hex(h1) + hex(h2) + hex(Math.imul(h1 ^ h2, 2654435761)) + hex(Math.imul(h1 + h2, 40503))).slice(0, 32)
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-8' + s.slice(17, 20) + '-' + s.slice(20, 32)
}

// Convert the setup `times` object into result rows, split official vs trial.
export function timesToResultRows(pTimes, pAthleteId, pTodayIso) {
  const official = [], trials = []
  for (const t of Object.values(pTimes || {})) {
    const stroke = t.code, distM = Number(t.dist), timeSec = Number(t.sec)
    if (!STROKES.includes(stroke) || !(distM > 0) || !(timeSec > 0)) continue
    const poolType = POOL_FROM_SETUP[t.pool] || '25SC'
    const dt = normIsoDate(t.date)
    if (dt) {
      official.push({
        kind: 'meet', source: 'import', effort: 'maximal', swumOn: dt,
        stroke, distM, poolType, timeSec,
        provenance: { sanctioned: true, importRef: `sr:${pAthleteId}:${distM}${stroke}:${dt}` },
      })
    } else {
      trials.push({
        id: stableUuid(`tt|${pAthleteId}|${distM}${stroke}|${timeSec}`),
        kind: 'time_trial', source: 'manual', effort: 'maximal', swumOn: pTodayIso,
        stroke, distM, poolType, timeSec,
      })
    }
  }
  return { official, trials }
}

// Persist an athlete's setup times to their records. Returns
// { added, skipped, official, trials }. Requires an athleteId (a loaded member/
// child); write rights are enforced by the database.
export const persistAthleteTimes = async (pAthleteId, pTimes) => {
  if (!pAthleteId) return invalid('INVALID: no athlete to save to — load an athlete first')
  const mToday = new Date().toISOString().slice(0, 10)
  const { official, trials } = timesToResultRows(pTimes || {}, pAthleteId, mToday)
  for (const [i, r] of [...official, ...trials].entries()) {
    const mProblem = validateResult(r)
    if (mProblem) return invalid(`${mProblem} (time ${i + 1})`)
  }
  let mAdded = 0, mSkipped = 0
  if (official.length) {
    const r = await importResults(pAthleteId, official)   // deterministic client_uuid dedup
    if (r.error) return { data: null, error: r.error }
    mAdded += r.data.added; mSkipped += r.data.skipped
  }
  if (trials.length) {
    const r = await repo().addManyIdempotent(pAthleteId, trials)
    if (r.error) return { data: null, error: r.error }
    mAdded += r.data.added; mSkipped += r.data.skipped
  }
  return { data: { added: mAdded, skipped: mSkipped, official: official.length, trials: trials.length }, error: null }
}

// Ingest a Poolside export file (swimzone.import/1 envelope of result/1 records)
// into one athlete's records. Idempotent — re-importing the same file adds
// nothing (records carry client_uuid). Returns { added, skipped }.
export const ingestPoolsideExport = async (pAthleteId, pEnvelope) => {
  if (!pEnvelope || pEnvelope.fmt !== 'swimzone.import/1') return invalid('INVALID: not a SwimZone import file')
  const mRows = Array.isArray(pEnvelope.records) ? pEnvelope.records : []
  if (mRows.length === 0) return { data: { added: 0, skipped: 0 }, error: null }
  for (const [i, mRow] of mRows.entries()) {
    const mProblem = validateResult(mRow)
    if (mProblem) return invalid(`${mProblem} (record ${i + 1})`)
  }
  return repo().addManyIdempotent(pAthleteId, mRows.map(withEffort))
}

// A set as swum: a swimzone.set/1 snapshot + an achieved time per rep. Persists
// as one set_efforts parent + one child row per rep.
export const addSetResult = async (pAthleteId, pSetResult) => {
  const mSetErr = pSetResult && pSetResult.set ? validateSetFormat(pSetResult.set) : 'set snapshot missing'
  if (mSetErr) return invalid(`INVALID set: ${mSetErr}`)
  if (!Array.isArray(pSetResult.reps)) return invalid('INVALID: reps missing')
  return repo().addSetResult(pAthleteId, pSetResult)
}

// pFilter: { protocolId, from, to } — all optional.
export const getSetResults = async (pAthleteId, pFilter = {}) => repo().listSetEfforts(pAthleteId, pFilter)

// Same recognised test across the season, efforts + reps, for side-by-side view.
export const getSetResultsByProtocol = async (pProtocolId, pAthleteId) => repo().listSetEffortsByProtocol(pProtocolId, pAthleteId)

export const updateResult = async (pResultId, pChanges) => {
  const mProblem = validateResult(pChanges, true)
  return mProblem ? invalid(mProblem) : repo().update(pResultId, pChanges)
}

export const deleteResult = async (pResultId) => repo().remove(pResultId)
