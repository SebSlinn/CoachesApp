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
}
