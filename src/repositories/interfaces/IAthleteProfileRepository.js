//repositories/interfaces/IAthleteProfileRepository.js
// Contract for the per-athlete coaching profile (athlete type, PHV status,
// derived-profile snapshot, SE number, club), keyed by the athlete's user id.
// Distinct from IAthleteRepository, which is the device-local "active athlete"
// slot the Classifier and Set Builder read.
//
// Profile shape (app fields):
//   { athleteId, athleteType, phvStatus, derivedProfile, seNumber, club,
//     maxHr, maxHrSource ('typed'|'test'), maxHrOn (YYYY-MM-DD),   ← 2026-10-14
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
  /** The athlete's date of birth (for the 220 − age max HR estimate).
   *  @param {string} _athleteId
   *  @returns {Promise<{data: string|null, error: Object|null}>} 'YYYY-MM-DD', or null if unknown/not visible */
  async getDateOfBirth(_athleteId) {
    throw new Error('IAthleteProfileRepository.getDateOfBirth not implemented');
  }
}
