// src/zones/suggest.js
// Reverse classifier: given zone + distance + athlete pace → suggested IN/ON times.
//
// SINGLE SOURCE OF TRUTH
// Speed and rest ranges are derived from ACTIVE_CRITERIA in zoneCriteria.js
// wherever athlete-specific criteria exist. This ensures that times suggested
// here will pass the same criteria evaluated in ZoneMatchBanner.
//
// For zones where zoneCriteria uses absolute-pace conditions (AT, A3, CS),
// those are used directly. For zones with only ratio bands (HVO, LT, LP,
// A2, A1), the ratio ranges from zoneCriteria are used.
//
// IMPORT NOTE: zoneCriteria.js has zero imports itself but suggest.js
// imports from it — both are in zones/ so this is an intra-module import.

import { ACTIVE_CRITERIA } from './zoneCriteria.js';

/**
 * Suggest IN and ON time ranges for a given zone, distance, and athlete pace.
 *
 * @param {string}      pZone        Zone id: 'HVO' 'LT' 'LP' 'AT' 'CS' 'A3' 'A2' 'A1'
 * @param {number}      pDistM       Rep distance in metres
 * @param {string}      pStroke      'FS' 'BK' 'BR' 'Fly' 'IM'
 * @param {number}      pPace200Sec  Athlete's 200m FS time in seconds
 * @param {number|null} pCssValue    Athlete's CSS pace in sec/100m (for CS zone)
 * @returns {Object|null}
 *   inLow, inHigh    — IN time range (seconds)
 *   onLow, onHigh    — ON time range (seconds)
 *   inLowStr etc.    — formatted strings
 */
function suggestTimes(pZone, pDistM, pStroke, pPace200Sec, pCssValue) {
  if (!pPace200Sec || !pDistM || !pZone) return null;

  const mSMULT   = { FS: 1.0, BK: 1.045, BR: 1.254, Fly: 1.051, IM: 1.082 };
  const mMult    = mSMULT[pStroke] || 1.0;
  const mBase100 = (pPace200Sec * mMult) / 2;  // sec/100m at 200PB pace
  const mDist    = parseFloat(pDistM);
  const mCrit    = ACTIVE_CRITERIA[pZone];
  if (!mCrit) return null;

  // ── Derive IN time range ──────────────────────────────────────────────────

  let mInLow, mInHigh;

  if (pZone === 'CS' && pCssValue) {
    // CS: use CSS pace ± margin directly
    const mMargin = mCrit.cssPace || 0.05;
    const mCssTime = (pCssValue / 100) * mDist;
    mInLow  = mCssTime * (1 - mMargin);
    mInHigh = mCssTime * (1 + mMargin);

  } else if (mCrit.atPace && pPace200Sec) {
    // AT / A3: absolute pace = ½×200PB + offset seconds per 100m
    const mHalfPace = pPace200Sec / 2;  // sec/100m = ½×200PB
    const mPaceLo   = (mHalfPace + mCrit.atPace.offsetLow)  / 100 * mDist * mMult;
    const mPaceHi   = (mHalfPace + mCrit.atPace.offsetHigh) / 100 * mDist * mMult;
    mInLow  = mPaceLo;
    mInHigh = mPaceHi;

  } else if (mCrit.speed) {
    // HVO, LT, LP, A2, A1: ratio band relative to 200PB pace
    const [mSrLo, mSrHi] = mCrit.speed;
    const mLo = mSrLo !== null ? mSrLo : 0.70;
    const mHi = mSrHi !== null ? mSrHi : 2.00;
    mInLow  = (mLo * mBase100 / 100) * mDist;
    mInHigh = (mHi * mBase100 / 100) * mDist;

  } else {
    return null;
  }

  mInLow  = Math.round(mInLow);
  mInHigh = Math.round(mInHigh);
  if (mInLow >= mInHigh) mInHigh = mInLow + 2;

  // ── Derive ON time range ──────────────────────────────────────────────────
  // Prefer absolute rest seconds (restSecByDist) — matches zoneCriteria exactly.
  // Fall back to restWork ratio if no distance-specific rest defined.

  let mRestLow, mRestHigh;

  if (mCrit.restSecByDist) {
    // Find the band for this distance
    let mBand = mCrit.restSecByDist.default;
    for (const [mDistMax, mBandOpt] of (mCrit.restSecByDist.byDist || [])) {
      if (mDist <= mDistMax) { mBand = mBandOpt; break; }
    }
    mRestLow  = mBand[0] ?? 0;
    mRestHigh = mBand[1] ?? mBand[0] ?? 20;

  } else if (mCrit.restWork) {
    const [mRwLo, mRwHi] = mCrit.restWork;
    // Use mid-IN time as basis for rest calculation
    const mMidIn = (mInLow + mInHigh) / 2;
    mRestLow  = mRwLo !== null ? mMidIn * mRwLo : 0;
    mRestHigh = mRwHi !== null ? mMidIn * mRwHi : mMidIn * 0.5;

  } else {
    // No rest criteria defined (A1, A2 — straight-on)
    mRestLow  = 0;
    mRestHigh = 0;
  }

  // ON = IN + rest, rounded to nearest 5s
  function mR5(pSec) { return Math.round(pSec / 5) * 5; }
  const mOnLow  = mR5(mInLow  + mRestLow);
  let   mOnHigh = mR5(mInHigh + mRestHigh);
  if (mOnLow === mOnHigh) mOnHigh = mOnLow + 5;

  // ── Format ────────────────────────────────────────────────────────────────
  function mFmt(pSec) {
    const mM = Math.floor(pSec / 60);
    const mS = Math.round(pSec % 60);
    return mM > 0 ? mM + ':' + String(mS).padStart(2, '0') : String(mS);
  }

  return {
    inLow:  mInLow,  inHigh:  mInHigh,
    onLow:  mOnLow,  onHigh:  mOnHigh,
    inLowStr:  mFmt(mInLow),
    inHighStr: mFmt(mInHigh),
    onLowStr:  mFmt(mOnLow),
    onHighStr: mFmt(mOnHigh),
    inMidStr:  mFmt(Math.round((mInLow + mInHigh) / 2)),
    onMidStr:  mFmt(mR5((mOnLow + mOnHigh) / 2)),
  };
}

export { suggestTimes };
