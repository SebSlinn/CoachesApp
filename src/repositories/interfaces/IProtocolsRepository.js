// Contract for the Test Set Library (test_protocols).
// Today the only implementation is SupabaseProtocolsRepository.
//
// Protocols use the app's field names, not column names:
//   { id, key, version, name, description, ownerOrgId (null = global library),
//     set (swimzone.set/1), measures: string[], params: {}, analyser, locked,
//     createdBy, createdAt, updatedAt }
// Who may see / edit is enforced by the database (grant-tree RLS); a locked
// protocol refuses definition changes (DB trigger, error starts 'LOCKED:').
//
// Every method resolves to { data, error } — never throws.

export class IProtocolsRepository {
  /** Every protocol the signed-in user can see, all versions. @param {{key?}} _filter */
  async list(_filter) { throw new Error('IProtocolsRepository.list not implemented'); }
  async get(_id) { throw new Error('IProtocolsRepository.get not implemented'); }
  /** Highest version number for (ownerOrgId, key), or 0 if none visible. */
  async maxVersion(_ownerOrgId, _key) { throw new Error('IProtocolsRepository.maxVersion not implemented'); }
  async create(_protocol) { throw new Error('IProtocolsRepository.create not implemented'); }
  async update(_id, _changes) { throw new Error('IProtocolsRepository.update not implemented'); }
  async remove(_id) { throw new Error('IProtocolsRepository.remove not implemented'); }
}
