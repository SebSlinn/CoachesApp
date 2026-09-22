//repositories/interfaces/IAthleteRepository.js
// Contract for reading/writing the current athlete profile. Today the only
// implementation is LocalAthleteRepository (the `swimzone-athlete`
// localStorage key); a future SupabaseAthleteRepository or ApiAthleteRepository
// implements the same shape once athletes move off localStorage.
//
// Deliberately a single get/save pair, matching today's "one athlete"
// behaviour exactly — this pass only moves the storage access, it does not
// change what's stored. Turning this into a real collection (list/get/save/
// delete per athlete) is later, separate work.

export class IAthleteRepository {
  /** @returns {Promise<Object|null>} the stored athlete object, or null if none saved yet */
  async get() {
    throw new Error('IAthleteRepository.get not implemented');
  }
  /** @param {Object} _athlete
   *  @returns {Promise<void>} */
  async save(_athlete) {
    throw new Error('IAthleteRepository.save not implemented');
  }
}
