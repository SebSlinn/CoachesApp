// src/athlete/maxHr.js
// Which max heart rate to use for an athlete — the basis of every HR zone band
// (zones/types.js hrBand = beats below max). PURE: zero imports, no storage.
//
// Order (first that exists wins):
//   1. 'profile' — a max HR saved on the athlete's profile (typed in by the coach,
//                  or set from a Max HR test result)
//   2. 'test'    — the athlete's latest Max HR test (analyser 'maxhr', summary.peakHr)
//   3. 'age'     — 220 − age, from their date of birth. An ESTIMATE.
//   4. 'none'    — nothing known. Everything still works; HR checks and HR targets
//                  are simply skipped (evaluateZoneMatch skips hrBand without maxHr).
//
// A value outside MAX_HR_LIMITS is ignored (a typo or a sensor glitch), and the
// next source down is used.

export const MAX_HR_LIMITS = { min: 120, max: 240 };
const AGE_LIMITS = { min: 5, max: 100 };

const okHr = (v) => Number.isFinite(v) && v >= MAX_HR_LIMITS.min && v <= MAX_HR_LIMITS.max;

/** Parse 'YYYY-MM-DD' (or a Date) → Date at UTC midnight, or null. */
function toDate(pValue) {
  if (!pValue) return null;
  if (pValue instanceof Date) return isNaN(pValue) ? null : pValue;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(pValue));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d) ? null : d;
}

/** Whole years between a date of birth and asOf (default today). null if unknown/implausible. */
export function ageInYears(pDateOfBirth, pAsOf = new Date()) {
  const mDob = toDate(pDateOfBirth);
  const mNow = toDate(pAsOf) || new Date();
  if (!mDob) return null;
  let mAge = mNow.getUTCFullYear() - mDob.getUTCFullYear();
  const mBefore = mNow.getUTCMonth() < mDob.getUTCMonth()
    || (mNow.getUTCMonth() === mDob.getUTCMonth() && mNow.getUTCDate() < mDob.getUTCDate());
  if (mBefore) mAge -= 1;
  return mAge >= AGE_LIMITS.min && mAge <= AGE_LIMITS.max ? mAge : null;
}

/** 220 − age, or null for an unknown/implausible age. */
export function ageBasedMaxHr(pAge) {
  return Number.isFinite(pAge) && pAge >= AGE_LIMITS.min && pAge <= AGE_LIMITS.max ? 220 - pAge : null;
}

function fmtDate(pIso) {
  const d = toDate(pIso);
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
}

/**
 * Pick the max HR to use.
 * @param {Object} p
 * @param {number} [p.savedMaxHr]     max HR on the athlete profile
 * @param {string} [p.savedSource]    'typed' | 'test' — how the saved value was set
 * @param {string} [p.savedOn]        date it was saved/measured (YYYY-MM-DD)
 * @param {number} [p.testPeakHr]     latest Max HR test peak
 * @param {string} [p.testOn]         that test's date
 * @param {string} [p.dateOfBirth]    YYYY-MM-DD
 * @param {Date|string} [p.asOf]      for the age calculation (default today)
 * @returns {{ maxHr:number|null, source:'profile'|'test'|'age'|'none', estimated:boolean,
 *             age:number|null, detail:string }}
 */
export function resolveMaxHr(p = {}) {
  const mSaved = Number(p.savedMaxHr);
  const mTest  = Number(p.testPeakHr);
  const mAge   = ageInYears(p.dateOfBirth, p.asOf);

  if (okHr(mSaved)) {
    const mHow = p.savedSource === 'test' ? 'from a Max HR test' : 'entered by the coach';
    const mWhen = p.savedOn ? ', ' + fmtDate(p.savedOn) : '';
    return { maxHr: Math.round(mSaved), source: 'profile', estimated: false, age: mAge,
             detail: `${Math.round(mSaved)} bpm — saved on profile (${mHow}${mWhen})` };
  }
  if (okHr(mTest)) {
    return { maxHr: Math.round(mTest), source: 'test', estimated: false, age: mAge,
             detail: `${Math.round(mTest)} bpm — latest Max HR test${p.testOn ? ' (' + fmtDate(p.testOn) + ')' : ''}` };
  }
  const mByAge = ageBasedMaxHr(mAge);
  if (okHr(mByAge)) {
    return { maxHr: mByAge, source: 'age', estimated: true, age: mAge,
             detail: `≈${mByAge} bpm — estimate (220 − age ${mAge}). Run the Max HR test for a real figure.` };
  }
  return { maxHr: null, source: 'none', estimated: false, age: mAge,
           detail: 'No max HR — heart-rate zones are off. Add a date of birth or run the Max HR test.' };
}

/** Is a typed value usable as a max HR? (for form validation) */
export function isValidMaxHr(pValue) { return okHr(Number(pValue)); }
