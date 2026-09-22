//repositories/local/LocalSessionRepository.js
// Wraps the exact localStorage access that used to live directly in
// pages/SetBuilder.jsx and pages/Classifier.jsx — same keys (KEYS.SESSION,
// KEYS.ACTIVE_GROUP), same storage.get/set/getRaw/setRaw/remove calls, no
// behaviour change. Synchronous — see ISessionRepository's header comment
// for why this one isn't async like LocalAthleteRepository.
import { storage, KEYS } from '../../lib/storage.js';
import { ISessionRepository } from '../interfaces/ISessionRepository.js';

export class LocalSessionRepository extends ISessionRepository {
  get() {
    return storage.get(KEYS.SESSION);
  }

  save(session) {
    storage.set(KEYS.SESSION, session);
  }

  getActiveGroup() {
    return storage.getRaw(KEYS.ACTIVE_GROUP);
  }

  setActiveGroup(groupId) {
    if (groupId) storage.setRaw(KEYS.ACTIVE_GROUP, groupId);
    else storage.remove(KEYS.ACTIVE_GROUP);
  }
}
