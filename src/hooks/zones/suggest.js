// suggest.js — Reverse classifier: zone + distM + pace → suggested IN / ON times.
// pCssValue: athlete CSS pace (s/100m); pass null if unavailable.

function suggestTimes(pZone, pDistM, pStroke, pPace200Sec, pCssValue) {
  if (!pPace200Sec || !pDistM || !pZone) return null;

  const mSMULT   = { FS:1.0, BK:1.045, BR:1.254, Fly:1.051, IM:1.082 };
  const mMult    = mSMULT[pStroke] || 1.0;
  const mBase100 = (pPace200Sec * mMult) / 2;   // seconds per 100m at 200PB pace
  const mDist    = parseFloat(pDistM);

  const mCssSR   = pCssValue ? pCssValue / mBase100 : null;
  const mObjSrRanges = {
    HVO : [0.82,  0.93],
    LT  : [0.93,  0.97],
    LP  : [0.97,  1.025],
    AT  : [1.025, 1.10],
    CS  : mCssSR ? [mCssSR * 0.95, mCssSR * 1.05] : [1.025, 1.10],
    A3  : [1.10,  1.22],
    A2  : [1.22,  1.38],
    A1  : [1.38,  1.65],
  };
  // Rest-to-work ratio ranges by zone
  const mObjRestRatios = {
    HVO : [6.0,  10.0],
    LT  : [3.0,  5.0],
    LP  : [1.0,  1.2],
    AT  : [0.30, 0.55],
    CS  : [0.45, 0.70],
    A3  : [0.0,  0.15],
    A2  : [0.0,  0.08],
    A1  : [0.0,  0.0],
  };

  const mRange     = mObjSrRanges[pZone];
  const mRestRange = mObjRestRatios[pZone];
  if (!mRange) return null;

  // IN time range (nearest second)
  const mInLow  = Math.round((mRange[0] * mBase100 / 100) * mDist);
  const mInHigh = Math.round((mRange[1] * mBase100 / 100) * mDist);
  const mInLow2 = mInLow >= mInHigh ? mInLow : mInLow;   // guard
  const mInHigh2 = mInLow >= mInHigh ? mInLow + 2 : mInHigh;

  function mRoundTo5(mSec) { return Math.round(mSec / 5) * 5; }
  function mFmtSug(mSec) {
    const mMin = Math.floor(mSec / 60);
    const mSc  = Math.round(mSec % 60);
    return mMin > 0 ? mMin + ':' + String(mSc).padStart(2, '0') : String(mSc);
  }

  // ON time range (IN + rest, rounded to 5s)
  const mOnLow  = mRoundTo5(mInLow2  + mInLow2  * mRestRange[0]);
  const mOnHigh = mRoundTo5(mInHigh2 + mInHigh2 * mRestRange[1]);
  const mOnLow2  = mOnLow;
  const mOnHigh2 = mOnLow >= mOnHigh ? mOnLow + 5 : mOnHigh;

  return {
    inLow     : mInLow2,
    inHigh    : mInHigh2,
    onLow     : mOnLow2,
    onHigh    : mOnHigh2,
    inLowStr  : mFmtSug(mInLow2),
    inHighStr : mFmtSug(mInHigh2),
    onLowStr  : mFmtSug(mOnLow2),
    onHighStr : mFmtSug(mOnHigh2),
    inMidStr  : mFmtSug(Math.round((mInLow2 + mInHigh2) / 2)),
    onMidStr  : mFmtSug(mRoundTo5((mOnLow2 + mOnHigh2) / 2)),
  };
}

export { suggestTimes };
