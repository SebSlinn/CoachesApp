//repositories/interfaces/IResultsRepository.js
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
// Every method resolves to { data, error } — never throws.

export class IResultsRepository {
  /** @param {{stroke?, distM?, kind?, from?, to?}} _filter */
  async list(_athleteId, _filter) { throw new Error('IResultsRepository.list not implemented'); }
  async add(_athleteId, _result) { throw new Error('IResultsRepository.add not implemented'); }
  async addMany(_athleteId, _results) { throw new Error('IResultsRepository.addMany not implemented'); }
  async update(_resultId, _changes) { throw new Error('IResultsRepository.update not implemented'); }
  async remove(_resultId) { throw new Error('IResultsRepository.remove not implemented'); }
}
