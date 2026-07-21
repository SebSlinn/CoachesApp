import { STROKE_MULT } from './constants.js';

// ─── PHV development helpers ──────────────────────────────────────────────────
// pPhvStatus: "pre" | "developing" | "post"
function glycoCapacity(pPhvStatus) {
  if (pPhvStatus === 'pre')        return 0.40;
  if (pPhvStatus === 'developing') return 0.70;
  return 1.0;
}

function phvZoneCaps(pPhvStatus) {
  if (pPhvStatus === 'pre')        return { ltCap: 0.0, lpCap: 0.0, atCap: 0.4 };
  if (pPhvStatus === 'developing') return { ltCap: 0.3, lpCap: 0.5, atCap: 1.0 };
  return { ltCap: 1.0, lpCap: 1.0, atCap: 1.0 };
}

// ─── Per-rep energy system model ─────────────────────────────────────────────
// Parameters: pWorkSec, pSpeedRatio, pAtpcpStore, pLactateBuf, pPhvStatus
function repEnergy(pWorkSec, pSpeedRatio, pAtpcpStore, pLactateBuf, pPhvStatus = 'post') {
  const mAtpcpFrac  = 0.82 * Math.pow(Math.min(1, 15 / pWorkSec), 1.5);
  const mAtpcpRaw   = mAtpcpFrac * pAtpcpStore;

  const mGlycoCap   = glycoCapacity(pPhvStatus);
  const mGlycoOnset = Math.min(1, Math.max(0, (pWorkSec - 13) / 22));
  const mGlycoDur   = pWorkSec < 120 ? 1.0 : Math.max(0.30, 1.0 - (pWorkSec - 120) / 280);
  const mGlycoSpeed = Math.max(0, Math.min(1, (1.32 - pSpeedRatio) / 0.32));
  const mGlycoRaw   = mGlycoOnset * mGlycoDur * mGlycoSpeed * pLactateBuf * mGlycoCap;

  const mAeroDurBase = Math.min(0.38, 0.08 + pWorkSec / 380);
  const mAeroDur     = Math.min(0.20, pWorkSec / 900);
  const mAeroSpeed   = Math.max(0.75, Math.min(1.5, 0.55 + pSpeedRatio * 0.46));
  const mAeroRaw     = (mAeroDurBase + mAeroDur) * mAeroSpeed;

  const mTotal = mAtpcpRaw + mGlycoRaw + mAeroRaw;
  return {
    atpcp      : mAtpcpRaw / mTotal,
    glycolytic : mGlycoRaw / mTotal,
    aerobic    : mAeroRaw  / mTotal,
    raw        : { atpcpRaw: mAtpcpRaw, glycoRaw: mGlycoRaw, aeroRaw: mAeroRaw },
  };
}

// ─── Pace degradation model ──────────────────────────────────────────────────
// Returns achievable time multiplier for a rep (1.0 = no degradation).
// pLactateBuf: 0 = fully saturated, 1 = fully cleared.
// pSpeedRatio: >1 = slower than base100 pace.
function paceImpairment(pLactateBuf, pSpeedRatio) {
  if (pSpeedRatio > 1.05) return 1.0;               // below AT pace — no impairment
  const mResidualLactate = 1.0 - pLactateBuf;
  const mSpeedFactor     = Math.max(0, (1.05 - pSpeedRatio) / 0.05);
  const mMaxImpairment   = 0.03 * mSpeedFactor;     // up to 3% per rep at PB pace
  return 1.0 + mResidualLactate * mMaxImpairment;
}

// ─── Consistency warning ─────────────────────────────────────────────────────
// Returns null if achievable, or a warning object with suggestions.
function consistencyCheck({ qty:             pQty,
                             targetTimeSec:   pTargetTimeSec,
                             restSec:         pRestSec,
                             pace200Sec:      pPace200Sec,
                             stroke:          pStroke,
                             phvStatus:       pPhvStatus,
                             lactateClearMult: pLactateClearMult,
                             distM:           pDistM }) {
  if (!pQty || !pTargetTimeSec ||
      pRestSec === null || pRestSec === undefined || isNaN(pRestSec) ||
      !pPace200Sec) return null;

  const mMult       = STROKE_MULT[pStroke] || 1.0;
  const mBase100    = (pPace200Sec * mMult) / 2;
  const mRepPace100 = (pTargetTimeSec / pDistM) * 100;
  const mSpeedRatio = mRepPace100 / mBase100;

  if (mSpeedRatio > 1.05) return null;   // only warn for AT pace or faster

  const mAtpcpRestore   = 1 / 180;
  const mLactateRestore = (1 / 300) * pLactateClearMult;

  let mAtpcpStore = 1.0, mLactateBuf = 1.0;
  let mFirstProblem = null;
  let mWorstTime = pTargetTimeSec;

  for (let mR = 0; mR < pQty; mR++) {
    const mImpairMult    = paceImpairment(mLactateBuf, mSpeedRatio);
    const mAchievable    = pTargetTimeSec * mImpairMult;
    if (mR > 0 && mImpairMult > 1.015 && !mFirstProblem) {
      mFirstProblem = { rep: mR + 1, estimatedTime: mAchievable, degradationPct: (mImpairMult - 1) * 100 };
    }
    mWorstTime = Math.max(mWorstTime, mAchievable);

    const mAtpcpUsed   = Math.min(mAtpcpStore, (Math.min(pTargetTimeSec, 15) / 15) * mAtpcpStore);
    mAtpcpStore        = Math.max(0, mAtpcpStore - mAtpcpUsed);
    const mEnergy      = repEnergy(pTargetTimeSec, mSpeedRatio, mAtpcpStore, mLactateBuf, pPhvStatus);
    const mLactateUsed = mEnergy.glycolytic * 0.25 * (pTargetTimeSec / 60);
    mLactateBuf        = Math.max(0, mLactateBuf - mLactateUsed);
    mAtpcpStore        = Math.min(1, mAtpcpStore + pRestSec * mAtpcpRestore);
    mLactateBuf        = Math.min(1, mLactateBuf + pRestSec * mLactateRestore);
  }

  if (!mFirstProblem) return null;

  const mSuggestedRest = Math.ceil(pTargetTimeSec * 0.5 * (1 / pLactateClearMult));
  const mSuggestedTime = pTargetTimeSec * 1.025;

  return {
    ...mFirstProblem,
    worstTime        : mWorstTime,
    suggestedRest    : mSuggestedRest,
    suggestedTime    : mSuggestedTime,
    lactateClearMult : pLactateClearMult,
  };
}

export { glycoCapacity, phvZoneCaps, repEnergy, paceImpairment, consistencyCheck };
