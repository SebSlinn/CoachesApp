//repositories/interfaces/IZoneSchemeRepository.js
// Contract for reading/writing the coach's zone display scheme (contracts/ZONES.md).
// Stored value: { id } for a built-in scheme, or a full custom scheme object.
//
// get/save are SYNCHRONOUS, like ISessionRepository: the scheme is needed on the very first
// render so screens never flash the wrong colours. The account version keeps a device copy
// for that and syncs with the account in the background (sync()).

export class IZoneSchemeRepository {
  /** @returns {Object|null} the stored choice, or null if none saved */
  get() {
    throw new Error('IZoneSchemeRepository.get not implemented');
  }
  /** @param {Object|null} _choice  null clears it (back to the default) */
  save(_choice) {
    throw new Error('IZoneSchemeRepository.save not implemented');
  }
  /** Bring the account's choice to this device (async). → { data: { changed }, error }. Optional: device-only versions skip it. */
  async sync() {
    return { data: { changed: false }, error: null };
  }
}
