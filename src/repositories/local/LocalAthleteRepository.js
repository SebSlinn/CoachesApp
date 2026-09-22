//repositories/local/LocalAthleteRepository.js
// Wraps the exact localStorage access that used to live directly in
// pages/AthleteSetup.jsx, pages/Classifier.jsx and pages/SetBuilder.jsx —
// same key (KEYS.ATHLETE), same storage.get/set wrapper, no behaviour change.
// get()/save() are async only so callers don't need to change again when a
// remote-backed repository replaces this one.
import { storage, KEYS } from '../../lib/storage.js';
import { IAthleteRepository } from '../interfaces/IAthleteRepository.js';

export class LocalAthleteRepository extends IAthleteRepository {
  async get() {
    return storage.get(KEYS.ATHLETE);
  }

  async save(athlete) {
    storage.set(KEYS.ATHLETE, athlete);
  }
}
