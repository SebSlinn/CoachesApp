// src/services/sessionService.js
// All session data operations: validate, parse/import, export.
// Pure functions — no React, no DOM, no localStorage side-effects (callers handle those).
// Future: replace function bodies with fetch('/api/session/…') calls; signatures stay the same.

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
