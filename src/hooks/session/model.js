import { STROKE_MULT, ZONES } from '../zones/constants.js';
import { phvZoneCaps, repEnergy } from '../zones/energy.js';

// flattenBlock — walks a session block tree and returns a flat array of rep objects.
// Parameters (p prefix = cross-function / passed-in):
//   pBlock      : the block object being expanded
//   pPace200Map : map of stroke → 200m PB seconds
//   pPhvStatus  : "pre" | "mid" | "post" PHV string
function flattenBlock(pBlock, pPace200Map, pPhvStatus) {
  var mSeq  = [];
  var mReps = parseInt(pBlock.repeats) || 1;
  var mSMULT = { FS:1.0, BK:1.045, BR:1.254, Fly:1.051, IM:1.082 };

  for (var mi = 0; mi < mReps; mi++) {
    (pBlock.children || []).forEach(function(mChild) {
      if (mChild.children !== undefined) {
        // Nested block — recurse and append
        flattenBlock(mChild, pPace200Map, pPhvStatus).forEach(function(mRep) { mSeq.push(mRep); });
      } else if (mChild.type === 'swim' && mChild.distM && mChild.targetTime) {
        var mStroke   = mChild.stroke || 'FS';
        var mPace200  = pPace200Map[mStroke] || pPace200Map['FS'] || 120;
        var mBase100  = (mPace200 * (mSMULT[mStroke] || 1.0)) / 2;
        var mDist     = parseFloat(mChild.distM) || 100;
        var mTStr     = String(mChild.targetTime);
        var mTc       = mTStr.indexOf(':');
        var mWorkSec  = mTc > -1
          ? parseInt(mTStr.slice(0, mTc)) * 60 + parseFloat(mTStr.slice(mTc + 1))
          : parseFloat(mTStr) || 60;
        var mOStr     = mChild.onTime ? String(mChild.onTime) : mTStr;
        var mOc       = mOStr.indexOf(':');
        var mOnSec    = mOc > -1
          ? parseInt(mOStr.slice(0, mOc)) * 60 + parseFloat(mOStr.slice(mOc + 1))
          : parseFloat(mOStr) || mWorkSec;
        var mLineQty  = parseInt(mChild.qty) || 1;
        for (var mQi = 0; mQi < mLineQty; mQi++) {
          mSeq.push({
            workSec    : mWorkSec,
            speedRatio : (mWorkSec / mDist * 100) / mBase100,
            restSec    : Math.max(0, mOnSec - mWorkSec),
            stroke     : mStroke,
            dist       : mDist,      // internal rep calc field — metres per rep
          });
        }
      }
    });
  }
  return mSeq;
}

// classifySequence — runs energy-system modelling over a flattened rep sequence.
// Parameters: pSeq, pPhvStatus, pLactateClearMult, pCssValue
function classifySequence(pSeq, pPhvStatus, pLactateClearMult, pCssValue) {
  if (!pSeq || pSeq.length === 0) return null;

  var mARate  = 1 / 180;
  var mLRate  = (1 / 300) * (pLactateClearMult || 1);
  var mAStore = 1.0, mLBuf = 1.0;
  var mReps   = [];
  var mCumA   = 0, mCumG = 0, mCumAe = 0;

  pSeq.forEach(function(mRep) {
    var mE = repEnergy(mRep.workSec, mRep.speedRatio, mAStore, mLBuf, pPhvStatus);
    mReps.push({
      rep: mReps.length + 1,
      atpcp: mE.atpcp, glycolytic: mE.glycolytic, aerobic: mE.aerobic,
      atpcpStore: mAStore, lactateBuf: mLBuf,
    });
    mCumA  += mE.atpcp;
    mCumG  += mE.glycolytic;
    mCumAe += mE.aerobic;
    var mUsed = Math.min(mAStore, (Math.min(mRep.workSec, 15) / 15) * mAStore);
    mAStore = Math.max(0, mAStore - mUsed);
    mLBuf   = Math.max(0, mLBuf - mE.glycolytic * 0.25 * (mRep.workSec / 60));
    mAStore = Math.min(1, mAStore + mRep.restSec * mARate);
    mLBuf   = Math.min(1, mLBuf  + mRep.restSec * mLRate);
  });

  var mN    = pSeq.length;
  var mAvgA = mCumA / mN, mAvgG = mCumG / mN, mAvgAe = mCumAe / mN;
  var mCaps = phvZoneCaps(pPhvStatus);
  var mLtC  = mCaps.ltCap, mLpC = mCaps.lpCap, mAtC = mCaps.atCap;

  // Median speed ratio
  var mSR = pSeq.map(function(s) { return s.speedRatio; })
              .sort(function(a, b) { return a - b; })[Math.floor(mN / 2)];

  // Glycolytic zone split
  var mGLT = 0, mGLP = 0, mGAT = 0;
  if      (mSR < 0.95)  { mGLT = mAvgG*0.70*mLtC; mGLP = mAvgG*0.30*mLpC; mGAT += mAvgG*(0.70*(1-mLtC)+0.30*(1-mLpC))*mAtC; }
  else if (mSR < 0.97)  { mGLT = mAvgG*0.85*mLtC; mGLP = mAvgG*0.15*mLpC; mGAT += mAvgG*(0.85*(1-mLtC)+0.15*(1-mLpC))*mAtC; }
  else if (mSR < 1.025) { mGLP = mAvgG*0.70*mLpC; mGAT = mAvgG*0.30*mAtC + mAvgG*0.70*(1-mLpC)*mAtC; }
  else if (mSR < 1.10)  { mGAT = mAvgG*0.75*mAtC + mAvgG*0.25*(1-mLpC)*mAtC; mGLP = mAvgG*0.25*mLpC; }
  else                   { mGAT = mAvgG*0.40*mAtC; mGLP = mAvgG*0.10*mLpC; }

  // Aerobic zone split
  var mAA3 = 0, mAA2 = 0, mAA1 = 0;
  if      (mSR < 1.10)  mAA3 = mAvgAe;
  else if (mSR < 1.22)  { mAA3 = mAvgAe*0.70; mAA2 = mAvgAe*0.25; mAA1 = mAvgAe*0.05; }
  else if (mSR < 1.38)  { mAA2 = mAvgAe*0.65; mAA3 = mAvgAe*0.25; mAA1 = mAvgAe*0.10; }
  else                   { mAA1 = mAvgAe*0.65; mAA2 = mAvgAe*0.35; }

  var mRaw = { HVO: mAvgA, LT: mGLT, LP: mGLP, AT: mGAT, A3: mAA3, A2: mAA2, A1: mAA1 };
  var mTot = mRaw.HVO + mRaw.LT + mRaw.LP + mRaw.AT + mRaw.A3 + mRaw.A2 + mRaw.A1;
  var mBd  = ZONES.map(function(z) {
    var mZ = {}; for (var k in z) mZ[k] = z[k];
    mZ.pct = Math.round((mRaw[z.id] / mTot) * 100);
    return mZ;
  }).sort(function(a, b) { return b.pct - a.pct; });
  var mPt = mBd.reduce(function(s, z) { return s + z.pct; }, 0);
  if (mPt !== 100) mBd[0].pct += (100 - mPt);

  var mTotalWorkSec      = pSeq.reduce(function(s, r) { return s + r.workSec; }, 0);
  var mTotalRestSec      = pSeq.reduce(function(s, r) { return s + r.restSec; }, 0);
  var mAvgRestWorkRatio  = mTotalRestSec / (mTotalWorkSec || 1);
  var mTotalVol          = pSeq.reduce(function(s, r) { return s + r.dist; }, 0);

  // ── CS (Critical Swim Speed) detection ────────────────────────────────────
  var mSeqCsDetection = null;
  if (pCssValue) {
    var mCss2   = pCssValue;
    var mCsLow2 = mCss2 * 0.95, mCsHigh2 = mCss2 * 1.05;
    var mWorkReps2  = pSeq.filter(function(r) { return r.speedRatio <= 1.15; });
    var mRecovReps2 = pSeq.filter(function(r) { return r.speedRatio > 1.30; });
    if (mWorkReps2.length > 0) {
      var mAvgWorkPace2   = mWorkReps2.reduce(function(s, r) { return s + r.workSec / r.dist * 100; }, 0) / mWorkReps2.length;
      var mSpeedOk2       = mAvgWorkPace2 >= mCsLow2 && mAvgWorkPace2 <= mCsHigh2;
      var mCsWorkSec      = mWorkReps2.reduce(function(s, r) { return s + r.workSec; }, 0);
      var mTotalWorkMin2  = mCsWorkSec / 60;
      var mVolumeOk2      = mTotalWorkMin2 >= 22 && mTotalWorkMin2 <= 38;
      var mRecovOnSec     = mRecovReps2.reduce(function(s, r) { return s + r.workSec + r.restSec; }, 0);
      var mInlineRest     = mWorkReps2.reduce(function(s, r) { return s + r.restSec; }, 0);
      var mTotalRestSec2  = mRecovOnSec + mInlineRest;
      var mWorkRestRatio2 = mCsWorkSec / (mTotalRestSec2 || 1);
      var mRestOk2        = mWorkRestRatio2 >= 1.2 && mWorkRestRatio2 <= 2.5;
      var mMatchCount2    = [mSpeedOk2, mVolumeOk2, mRestOk2].filter(Boolean).length;
      mSeqCsDetection = {
        isCS: mMatchCount2 === 3, partial: mMatchCount2 === 2,
        speedOk: mSpeedOk2, volumeOk: mVolumeOk2, restOk: mRestOk2,
        cssPace: mCss2, repPace100: mAvgWorkPace2,
        totalWorkMin: mTotalWorkMin2.toFixed(1),
        workRest: mWorkRestRatio2.toFixed(2),
        distOk: true,
      };
    }
  }

  // ── PL (Peak Lactate) detection ───────────────────────────────────────────
  var mSeqPlSuggestion = null;
  if (mSR < 0.95) {
    mSeqPlSuggestion = {
      speedOk : true,
      note    : 'Pace above race pace across this bracket. PL requires 10–15 min active A1 recovery between reps. If swimdown reps are included in this bracket, the full structure qualifies as PL.',
    };
  }

  return {
    breakdown        : mBd,
    primary          : mBd[0],
    repResults       : mReps,
    avgAtpcp         : mAvgA,
    avgGlycolytic    : mAvgG,
    avgAerobic       : mAvgAe,
    totalVolume      : mTotalVol,
    workDur          : mTotalWorkSec / mN,
    speedRatio       : mSR,
    restWorkRatio    : mAvgRestWorkRatio,
    phvStatus        : pPhvStatus,
    phvWarning       : null,
    consistencyWarning: null,
    restoreCheck     : { atpcpRestored: false, atpcpRestorePct: 0 },
    lastRep          : mReps[mReps.length - 1],
    isSequence       : true,
    sequenceLength   : mN,
    paceValidation   : null,
    csDetection      : mSeqCsDetection,
    plSuggestion     : mSeqPlSuggestion,
  };
}

export { flattenBlock, classifySequence };
