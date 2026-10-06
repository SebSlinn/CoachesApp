//repositories/interfaces/IAthleteProfileRepository.js
// Contract for the per-athlete coaching profile (athlete type, PHV status,
// derived-profile snapshot, SE number, club), keyed by the athlete's user id.
// Distinct from IAthleteRepository, which is the device-local "active athlete"
// slot the Classifier and Set Builder read.
//
// Profile shape (app fields):
//   { athleteId, athleteType, phvStatus, derivedProfile, seNumber, club,
//     updatedBy, updatedAt }
// All methods return { data, error }.

export class IAthleteProfileRepository {
  /** @param {string} _athleteId
   *  @returns {Promise<{data: Object|null, error: Object|null}>} null data = no profile saved yet */
  async get(_athleteId) {
    throw new Error('IAthleteProfileRepository.get not implemented');
  }
  /** Insert or update the athlete's profile (one row per athlete).
   *  @param {string} _athleteId
   *  @param {Object} _profile
   *  @returns {Promise<{data: Object|null, error: Object|null}>} the saved profile */
  async upsert(_athleteId, _profile) {
    throw new Error('IAthleteProfileRepository.upsert not implemented');
  }
}
