// src/services/sessionService.js
// All session data operations: validate, parse/import, export.
// validate/import/export are pure — no React, no DOM. loadSession/
// saveSession/getActiveGroup/setActiveGroup are the exception: they go
// through ISessionRepository (see repositories/RepositoryFactory.js)
// instead of pages touching localStorage directly, which is what used to
// happen in SetBuilder.jsx and Classifier.jsx. These four stay synchronous
// — see ISessionRepository's header comment for why.

import { getSessionRepository } from '../repositories/RepositoryFactory.js';

// ─── Load / Save ──────────────────────────────────────────────────────────────

/** @returns {Object|null} the stored session, or null if none saved yet */
export function loadSession() {
  return getSessionRepository().get();
}

/** @param {Object} pSession */
export function saveSession(pSession) {
  return getSessionRepository().save(pSession);
}

/** @returns {string|null} */
export function getActiveGroup() {
  return getSessionRepository().getActiveGroup();
}

/** @param {string|null} pGroupId  falsy clears the stored value */
export function setActiveGroup(pGroupId) {
  return getSessionRepository().setActiveGroup(pGroupId);
}

// ─── Validate ────────────────────────────────────────────────────────────────

/**
 * Validate a session object has the expected shape.
 * Returns the session unchanged if valid, or null if not.
 * The old normalizeSession migration shim (target→targetTime, turnaround→onTime)
 * has been removed — all saved data now uses canonical field names.
 *
 * @param {Object} pSession
 * @returns {Object|null}
 */
export function validateSession(pSession) {
  if (!pSession || !Array.isArray(pSession.groups)) return null;
  return pSession;
}

// ─── Import ───────────────────────────────────────────────────────────────────

/**
 * Parse a raw JSON string into a session object.
 * Accepts either a bare session object or a `{ session: … }` wrapper.
 * Returns the session on success, or throws an Error with a readable message.
 *
 * @param {string} pJsonText
 * @returns {Object} session
 * @throws {Error}
 */
export function importSessionJson(pJsonText) {
  let mObj;
  try {
    mObj = JSON.parse(pJsonText);
  } catch (e) {
    throw new Error('Invalid JSON: ' + e.message);
  }

  const mSession = mObj?.session ?? mObj;
  if (!validateSession(mSession)) {
    throw new Error('No valid SwimZone session object found (missing groups array)');
  }

  return mSession;
}

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Serialise a session to a portable JSON string.
 *
 * @param {Object} pSession
 * @param {number} [pIndent=2]  JSON indent spaces
 * @returns {string} JSON string
 */
export function exportSessionJson(pSession, pIndent = 2) {
  return JSON.stringify(pSession, null, pIndent);
}
