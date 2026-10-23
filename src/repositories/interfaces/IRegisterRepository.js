// Contract for registers: attendance at a training sitting (who's expected, ticked in,
// signed out full or partial), and the athlete's own note on each entry.
// Today the only implementation is SupabaseRegisterRepository. The rules live in the
// database (supabase/migrations/20261022130000_registers.sql); an implementation just
// carries requests there. A local outbox version can sit in front of it later (phase 4).
//
// Every method resolves to { data, error } — never throws.

export class IRegisterRepository {
  // ---- reads ----
  /** Registers I can see, newest first: { register_id, starts_at, ends_at, venue, pool_type, status, org_ids,
   *  group_names, can_run, expected, in_count, out_count, still_in }[] */
  async list(_from, _to) { throw new Error('IRegisterRepository.list not implemented'); }
  /** One register for the coach screen: { register, groups[], entries[] } */
  async getSheet(_registerId) { throw new Error('IRegisterRepository.getSheet not implemented'); }
  /** Members of a register group not yet on the register: { athlete_user_id, name }[] */
  async getCandidates(_registerGroupId) { throw new Error('IRegisterRepository.getCandidates not implemented'); }
  /** An athlete's own entries (or their junior's, for a guardian). */
  async getAthleteEntries(_athleteId, _from, _to) { throw new Error('IRegisterRepository.getAthleteEntries not implemented'); }

  // ---- writes ----
  /** @param {{orgIds: string[], startsAt: string, endsAt?: string, venue?: string, poolType?: string, clientUuid?: string}} _r → register id */
  async create(_r) { throw new Error('IRegisterRepository.create not implemented'); }
  async addGroup(_registerId, _orgId) { throw new Error('IRegisterRepository.addGroup not implemented'); }
  async addEntry(_registerGroupId, _athleteId) { throw new Error('IRegisterRepository.addEntry not implemented'); }
  /** One tap. → the entry as it now stands. */
  async mark(_entryId, _action, _at, _detail, _clientUuid) { throw new Error('IRegisterRepository.mark not implemented'); }
  /** → how many were signed out */
  async signOutAll(_registerId, _at) { throw new Error('IRegisterRepository.signOutAll not implemented'); }
  async close(_registerId, _force) { throw new Error('IRegisterRepository.close not implemented'); }
  async reopen(_registerId) { throw new Error('IRegisterRepository.reopen not implemented'); }
  async setNote(_entryId, _note, _share) { throw new Error('IRegisterRepository.setNote not implemented'); }

  // ---- scanning and cards (online) ----
  /** → { result: in|out|already_in|already_out|unknown_card, name, entry_id, visitor, code } */
  async scan(_registerId, _code, _at, _orgId, _clientUuid) { throw new Error('IRegisterRepository.scan not implemented'); }
  /** The person's SwimZone QR code (made on first ask). */
  async qrCode(_userId) { throw new Error('IRegisterRepository.qrCode not implemented'); }
  /** [{ user_id, name, is_junior, code }] for printing a group's cards. */
  async groupQrCodes(_orgId) { throw new Error('IRegisterRepository.groupQrCodes not implemented'); }
  async linkCard(_userId, _code, _kind, _label) { throw new Error('IRegisterRepository.linkCard not implemented'); }
  async revokeCard(_cardId) { throw new Error('IRegisterRepository.revokeCard not implemented'); }
  async listCards(_userId) { throw new Error('IRegisterRepository.listCards not implemented'); }
  /** { registers:[…], athletes:[{ user_id, name, is_junior, member, cells:{ registerId: C|P|I|A|Ap|E|N } }] } */
  async attendance(_orgId, _from, _to) { throw new Error('IRegisterRepository.attendance not implemented'); }

  // ---- summaries and volume (online) ----
  async setSessionSummary(_rgId, _text, _volumeM, _breakdown) { throw new Error('IRegisterRepository.setSessionSummary not implemented'); }
  async setEntryVolume(_entryId, _volumeM) { throw new Error('IRegisterRepository.setEntryVolume not implemented'); }
  async setMySessionSummary(_entryId, _volumeM, _breakdown) { throw new Error('IRegisterRepository.setMySessionSummary not implemented'); }
  /** The athlete's timeline: [{ kind: session|test, at, … }] newest first (athlete_training_log). */
  async trainingLog(_athleteId, _from, _to) { throw new Error('IRegisterRepository.trainingLog not implemented'); }
  /** One grid cell's details for the coach (register_cell_detail). */
  async cellDetail(_entryId) { throw new Error('IRegisterRepository.cellDetail not implemented'); }

  // ---- offline ----
  /** { user_id, prepared_at, groups:[{ org_id, name, members[] }], registers:[sheet…] } */
  async prepare() { throw new Error('IRegisterRepository.prepare not implemented'); }
  /** One register's queue → { register_id, results[], close, sheet } (see sync_register) */
  async sync(_payload) { throw new Error('IRegisterRepository.sync not implemented'); }
}
