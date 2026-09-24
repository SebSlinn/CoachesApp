//services/results.js
// An athlete's performance results (training / meet log).
// Goes through IResultsRepository via the RepositoryFactory. Results use the
// app's field names (distM, timeSec, poolType, note ...) — see
// repositories/interfaces/IResultsRepository.js for the full shape.
// Who may read/add/edit is enforced by the database.
import { getResultsRepository } from '../repositories/RepositoryFactory'

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

const invalid = (pMessage) => ({ data: null, error: { message: pMessage } })

// pFilter: { stroke, distM, kind, from, to } — all optional
export const getResults = async (pAthleteId, pFilter = {}) => repo().list(pAthleteId, pFilter)

export const addResult = async (pAthleteId, pResult) => {
  const mProblem = validateResult(pResult)
  return mProblem ? invalid(mProblem) : repo().add(pAthleteId, pResult)
}

// e.g. a poolside stopwatch export: [{ stroke, distM, timeSec, splits, source: 'stopwatch' }, ...]
export const addResults = async (pAthleteId, pResults) => {
  for (const [i, mResult] of pResults.entries()) {
    const mProblem = validateResult(mResult)
    if (mProblem) return invalid(`${mProblem} (row ${i + 1})`)
  }
  return repo().addMany(pAthleteId, pResults)
}

export const updateResult = async (pResultId, pChanges) => {
  const mProblem = validateResult(pChanges, true)
  return mProblem ? invalid(mProblem) : repo().update(pResultId, pChanges)
}

export const deleteResult = async (pResultId) => repo().remove(pResultId)
