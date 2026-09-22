//repositories/interfaces/ISessionRepository.js
// Contract for reading/writing the current training session, plus the
// "which group tab is active" UI-adjacent bit of state that rides along
// with it. Today the only implementation is LocalSessionRepository (the
// `swimzone-session` and `swimzone-active-group` localStorage keys).
//
// Deliberately SYNCHRONOUS, unlike IAthleteRepository/IAuthRepository.
// SetBuilder.jsx reads the session inside a useState lazy initializer and
// directly in the component body on every render (loadSavedSession()) —
// both must return a value immediately, they can't await a promise. Making
// this async would mean rewriting SetBuilder's hydration to load after
// mount (a real behaviour change: a flash of the empty default session),
// which is out of scope for a same-behaviour repository move. A future
// remote-backed implementation can still exist behind this interface, it
// would just need to resolve synchronously from a cache that was warmed
// earlier — the interface doesn't have to change for that.

export class ISessionRepository {
  /** @returns {Object|null} the stored session, or null if none saved yet */
  get() {
    throw new Error('ISessionRepository.get not implemented');
  }
  /** @param {Object} _session */
  save(_session) {
    throw new Error('ISessionRepository.save not implemented');
  }
  /** @returns {string|null} the active group id, or null if none saved */
  getActiveGroup() {
    throw new Error('ISessionRepository.getActiveGroup not implemented');
  }
  /** @param {string|null} _groupId  falsy clears the stored value */
  setActiveGroup(_groupId) {
    throw new Error('ISessionRepository.setActiveGroup not implemented');
  }
}
