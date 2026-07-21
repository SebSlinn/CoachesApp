// src/lib/storage.js
// Centralised localStorage wrapper for SwimZone.
//
// All six cross-page keys are defined here — never use raw string keys elsewhere.
// get/set handle JSON serialisation and try/catch internally.
// getRaw/setRaw are for the one case (active-group) where a plain string is stored.

export const KEYS = {
  ATHLETE:          'swimzone-athlete',
  SESSION:          'swimzone-session',
  CLASSIFIER_STATE: 'swimzone-classifier-state',
  SELECTED_ELEMENT: 'swimzone-selected-element',
  ACTIVE_GROUP:     'swimzone-active-group',
  EDITING_BLOCK:    'swimzone-editing-block',
};

export const storage = {
  /** Read and JSON-parse a value. Returns null if missing or unparseable. */
  get(pKey) {
    try {
      const mRaw = localStorage.getItem(pKey);
      return mRaw ? JSON.parse(mRaw) : null;
    } catch (e) {
      return null;
    }
  },

  /** JSON-stringify and write a value. Silently no-ops on error. */
  set(pKey, pValue) {
    try {
      localStorage.setItem(pKey, JSON.stringify(pValue));
    } catch (e) {
      console.error('storage.set failed for key', pKey, e);
    }
  },

  /** Remove a key. Silently no-ops on error. */
  remove(pKey) {
    try {
      localStorage.removeItem(pKey);
    } catch (e) { /* ignore */ }
  },

  /** Read a raw string value (no JSON parsing). Returns null if missing. */
  getRaw(pKey) {
    try {
      return localStorage.getItem(pKey);
    } catch (e) {
      return null;
    }
  },

  /** Write a raw string value (no JSON stringify). */
  setRaw(pKey, pValue) {
    try {
      localStorage.setItem(pKey, pValue);
    } catch (e) {
      console.error('storage.setRaw failed for key', pKey, e);
    }
  },
};

// ─── Pool time conversion ─────────────────────────────────────────────────────

/**
 * Standard pool conversion factors for display purposes.
 * Times are stored in the pool they were entered (line.poolType).
 * These factors convert to a different pool display.
 *
 * Factors are applied to the per-100m pace, not the raw time.
 * Source: standard British swimming / Sweetenham coaching convention.
 *
 * SC → LC: ×1.014  (4 turns saved per 100m in SC × ~0.35s per turn)
 * LC → SC: ×0.986
 * Y  → SC: ×1.10   (yards to metres, shorter pool)
 * SC → Y:  ×0.909
 * Y  → LC: ×1.086
 * LC → Y:  ×0.921
 */
const POOL_FACTORS = {
  '25SC': { '50LC': 1.014, '25SC': 1.000, '25Y': 0.909 },
  '50LC': { '25SC': 0.986, '50LC': 1.000, '25Y': 0.897 },
  '25Y':  { '25SC': 1.100, '50LC': 1.115, '25Y': 1.000 },
};

/**
 * Convert a time string from one pool type to another for display.
 * Never mutates stored data — display only.
 *
 * @param {string} pTimeStr     e.g. "1:10" or "70"
 * @param {string} pFromPool    poolType the time was recorded in e.g. "25SC"
 * @param {string} pToPool      poolType to display in e.g. "50LC"
 * @returns {string}            converted time string, or original if conversion not possible
 */
export function convertTimeForDisplay(pTimeStr, pFromPool, pToPool) {
  if (!pTimeStr || !pFromPool || !pToPool || pFromPool === pToPool) return pTimeStr;
  const mFactor = POOL_FACTORS[pFromPool]?.[pToPool];
  if (!mFactor) return pTimeStr;

  // Parse stored time to seconds
  const mStr   = String(pTimeStr).trim();
  const mColon = mStr.indexOf(':');
  let mSec;
  if (mColon > -1) {
    mSec = parseInt(mStr.slice(0, mColon), 10) * 60 + parseFloat(mStr.slice(mColon + 1));
  } else {
    mSec = parseFloat(mStr);
  }
  if (!mSec || isNaN(mSec)) return pTimeStr;

  // Apply factor
  const mConverted = mSec * mFactor;
  const mM = Math.floor(mConverted / 60);
  const mS = mConverted % 60;

  // Format: always show tenths if the original had them, otherwise whole seconds
  const mHasTenths = mStr.includes('.');
  const mSFormatted = mHasTenths
    ? (mS < 10 ? '0' : '') + mS.toFixed(1)
    : (mS < 10 ? '0' : '') + Math.round(mS);

  return mM > 0 ? `${mM}:${mSFormatted}` : String(mHasTenths ? mS.toFixed(1) : Math.round(mS));
}
