//repositories/interfaces/IZoneSchemeRepository.js
// Contract for reading/writing the coach's zone display scheme (contracts/ZONES.md).
// Stored value: { id } for a built-in scheme, or a full custom scheme object.
//
// SYNCHRONOUS, like ISessionRepository: the scheme is needed on the very first
// render so screens never flash the wrong colours. A remote (per-coach) version
// would resolve from a cache warmed at sign-in.

export class IZoneSchemeRepository {
  /** @returns {Object|null} the stored choice, or null if none saved */
  get() {
    throw new Error('IZoneSchemeRepository.get not implemented');
  }
  /** @param {Object|null} _choice  null clears it (back to the default) */
  save(_choice) {
    throw new Error('IZoneSchemeRepository.save not implemented');
  }
}
