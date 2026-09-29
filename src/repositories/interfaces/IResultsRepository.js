//src/repositories/interfaces/IResultsRepository.js

// Contract for an athlete's performance results (training / meet log).
// Today the only implementation is SupabaseResultsRepository.
//
// Results use the app's canonical field names, not database column names:
//   { id, athleteId, swumOn: 'YYYY-MM-DD', kind: 'training'|'meet'|'time_trial',
//     stroke: 'FS'|'BK'|'BR'|'Fly'|'IM'|'Kick', distM: number,
//     poolType: '25SC'|'50LC'|'25Y', timeSec: number, splits: array|null,
//     location, note, source: 'manual'|'stopwatch'|'import',
//     createdBy, updatedBy, createdAt, updatedAt }
// Mapping to storage columns is the implementation's job.
//
// Athlete Records (Part A) adds append-only history, sets-as-swum and
// progression reads. A set-as-swum stores a swimzone.set/1 snapshot plus a
// time per rep (see session/setFormat and ATHLETE-RECORDS-CONTEXT.md).
//
// Every method resolves to { data, error } — never throws.

export class IResultsRepository {
  /** @param {{stroke?, distM?, kind?, from?, to?}} _filter */
  async list(_athleteId, _filter) { throw new Error('IResultsRepository.list not implemented'); }
  async add(_athleteId, _result) { throw new Error('IResultsRepository.add not implemented'); }
  async addMany(_athleteId, _results) { throw new Error('IResultsRepository.addMany not implemented'); }
  async update(_resultId, _changes) { throw new Error('IResultsRepository.update not implemented'); }
  async remove(_resultId) { throw new Error('IResultsRepository.remove not implemented'); }

  // --- Athlete Records (Part A) ---------------------------------------------
  /** All single swims for one event, oldest→newest (progression). */
  async listHistory(_athleteId, _filter) { throw new Error('IResultsRepository.listHistory not implemented'); }
  /** Append-only competition import; dedup by event+date+meet. → { added, skipped } */
  async importMany(_athleteId, _rows) { throw new Error('IResultsRepository.importMany not implemented'); }
  /** Idempotent bulk insert keyed on client_uuid (Poolside file ingest). → { added, skipped } */
  async addManyIdempotent(_athleteId, _results) { throw new Error('IResultsRepository.addManyIdempotent not implemented'); }
  /** A set as swum → one parent effort + one row per rep. */
  async addSetResult(_athleteId, _setResult) { throw new Error('IResultsRepository.addSetResult not implemented'); }
  /** @param {{protocolId?, from?, to?}} _filter */
  async listSetEfforts(_athleteId, _filter) { throw new Error('IResultsRepository.listSetEfforts not implemented'); }
  /** Efforts + their reps for one recognised test (side-by-side comparison). */
  async listSetEffortsByProtocol(_protocolId, _athleteId) { throw new Error('IResultsRepository.listSetEffortsByProtocol not implemented'); }
}
