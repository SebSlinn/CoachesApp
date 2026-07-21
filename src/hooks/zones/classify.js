import { STROKE_MULT, ZONES } from './constants.js';
import { parseTime, fmtTime } from './helpers.js';
import { validatePace } from './validatePace.js';
import { phvZoneCaps, repEnergy, paceImpairment, consistencyCheck } from './energy.js';

// classifySet — classify a single set against the Sweetenham energy zone model.
// Parameters use p prefix (cross-function / passed in as a destructured object):
function classifySet({ distM:      pDistM,
                        qty:        pQty,
                        targetTimeSec: pTargetTimeSec,
                        restSec:    pRestSec,
                        pace200Sec: pPace200Sec,
                        stroke:     pStroke,
                        phvStatus:  pPhvStatus,
                        lactateClearMult: pLactateClearMult = 1.0 }) {

  if (!pDistM || !pQty || !pTargetTimeSec ||
      pRestSec === null || pRestSec === undefined || isNaN(pRestSec) ||
      !pPace200Sec) return null;

  // ── Base pace calcs ────────────────────────────────────────────────────────
  const mMult       = STROKE_MULT[pStroke] || 1.0;
  const mBase100    = (pPace200Sec * mMult) / 2;         // 100m equivalent pace (sec)
  const mRepPace100 = (pTargetTimeSec / pDistM) * 100;   // actual pace per 100m
  const mSpeedRatio = mRepPace100 / mBase100;             // >1 = slower than base

  const mAtpcpRestoreRate   = 1 / 180;
  const mLactateRestoreRate = (1 / 300) * pLactateClearMult;

  // ── Rep-by-rep energy modelling ────────────────────────────────────────────
  let mAtpcpStore = 1.0, mLactateBuf = 1.0;
  let mRepResults = [];
  let mCumulative = { atpcp: 0, glycolytic: 0, aerobic: 0 };

  for (let mR = 0; mR < pQty; mR++) {
    const mEnergy = repEnergy(pTargetTimeSec, mSpeedRatio, mAtpcpStore, mLactateBuf, pPhvStatus);
    mRepResults.push({ rep: mR + 1, ...mEnergy, atpcpStore: mAtpcpStore, lactateBuf: mLactateBuf });
    mCumulative.atpcp      += mEnergy.atpcp;
    mCumulative.glycolytic += mEnergy.glycolytic;
    mCumulative.aerobic    += mEnergy.aerobic;

    const mAtpcpUsed   = Math.min(mAtpcpStore, (Math.min(pTargetTimeSec, 15) / 15) * mAtpcpStore);
    mAtpcpStore        = Math.max(0, mAtpcpStore - mAtpcpUsed);
    const mLactateUsed = mEnergy.glycolytic * 0.25 * (pTargetTimeSec / 60);
    mLactateBuf        = Math.max(0, mLactateBuf - mLactateUsed);

    mAtpcpStore = Math.min(1, mAtpcpStore + pRestSec * mAtpcpRestoreRate);
    mLactateBuf = Math.min(1, mLactateBuf + pRestSec * mLactateRestoreRate);
  }

  const mN           = pQty;
  const mAvgAtpcp    = mCumulative.atpcp      / mN;
  const mAvgGlyco    = mCumulative.glycolytic / mN;
  const mAvgAerobic  = mCumulative.aerobic    / mN;

  // ── PHV zone caps ─────────────────────────────────────────────────────────
  const { ltCap: mLtCap, lpCap: mLpCap, atCap: mAtCap } = phvZoneCaps(pPhvStatus);

  // ── Glycolytic → Sweetenham zone split ───────────────────────────────────
  let mGlycoLT = 0, mGlycoLP = 0, mGlycoAT = 0;
  if (mSpeedRatio < 0.95) {
    mGlycoLT = mAvgGlyco * 0.70 * mLtCap;
    mGlycoLP = mAvgGlyco * 0.30 * mLpCap;
    const mSpill = mAvgGlyco * (0.70 * (1 - mLtCap) + 0.30 * (1 - mLpCap));
    mGlycoAT += mSpill * mAtCap;
  } else if (mSpeedRatio < 0.97) {
    mGlycoLT = mAvgGlyco * 0.85 * mLtCap;
    mGlycoLP = mAvgGlyco * 0.15 * mLpCap;
    const mSpill = mAvgGlyco * (0.85 * (1 - mLtCap) + 0.15 * (1 - mLpCap));
    mGlycoAT += mSpill * mAtCap;
  } else if (mSpeedRatio < 1.025) {
    const mLpRestOk = pRestSec >= pTargetTimeSec * 0.9;
    if (mLpRestOk) {
      mGlycoLP = mAvgGlyco * 0.70 * mLpCap;
      mGlycoAT = mAvgGlyco * 0.30 * mAtCap;
      mGlycoAT += mAvgGlyco * (0.70 * (1 - mLpCap)) * mAtCap;
    } else {
      mGlycoAT = mAvgGlyco * 0.80 * mAtCap;
      mGlycoLP = mAvgGlyco * 0.20 * mLpCap;
      mGlycoAT += mAvgGlyco * (0.80 * (1 - mAtCap) + 0.20 * (1 - mLpCap)) * mAtCap;
    }
  } else if (mSpeedRatio < 1.10) {
    mGlycoAT = mAvgGlyco * 0.75 * mAtCap;
    mGlycoLP = mAvgGlyco * 0.25 * mLpCap;
    mGlycoAT += mAvgGlyco * (0.25 * (1 - mLpCap)) * mAtCap;
  } else {
    mGlycoAT = mAvgGlyco * 0.40 * mAtCap;
    mGlycoLP = mAvgGlyco * 0.10 * mLpCap;
  }

  // ── Aerobic → Sweetenham zone split ──────────────────────────────────────
  let mAeroA3 = 0, mAeroA2 = 0, mAeroA1 = 0;
  if (mSpeedRatio < 1.10) {
    mAeroA3 = mAvgAerobic;                               // hard set — all upper aerobic
  } else if (mSpeedRatio < 1.22) {
    mAeroA3 = mAvgAerobic * 0.70; mAeroA2 = mAvgAerobic * 0.25; mAeroA1 = mAvgAerobic * 0.05;
  } else if (mSpeedRatio < 1.38) {
    mAeroA2 = mAvgAerobic * 0.65; mAeroA3 = mAvgAerobic * 0.25; mAeroA1 = mAvgAerobic * 0.10;
  } else {
    mAeroA1 = mAvgAerobic * 0.65; mAeroA2 = mAvgAerobic * 0.35;
  }

  // ── Zone score totals and percentage breakdown ─────────────────────────────
  const mObjRaw = {
    HVO: mAvgAtpcp, LT: mGlycoLT, LP: mGlycoLP, AT: mGlycoAT,
    A3: mAeroA3, A2: mAeroA2, A1: mAeroA1,
  };
  const mTotal     = Object.values(mObjRaw).reduce((a, b) => a + b, 0);
  const mBreakdown = ZONES.map(z => ({
    ...z,
    pct: Math.round((mObjRaw[z.id] / mTotal) * 100),
  })).sort((a, b) => b.pct - a.pct);
  const mPctTotal = mBreakdown.reduce((a, z) => a + z.pct, 0);
  if (mPctTotal !== 100) mBreakdown[0].pct += (100 - mPctTotal);

  // ── PHV warning ───────────────────────────────────────────────────────────
  const mLtlpTotal = mObjRaw.LT + mObjRaw.LP;
  const mLtlpPct   = Math.round((mLtlpTotal / mTotal) * 100);
  const mAtPct     = Math.round((mObjRaw.AT  / mTotal) * 100);
  let mPhvWarning  = null;
  if (pPhvStatus === 'pre') {
    if (mLtlpPct > 5)
      mPhvWarning = `⚠ Pre-PHV athlete: LT and LP zones are not appropriate — lactate system is underdeveloped. Energy has been redistributed toward AT and aerobic zones.${mAtPct > 25 ? ` AT contribution is ${mAtPct}% — keep this type of set below 20% of total weekly volume.` : ''}`;
    else if (mAtPct > 30)
      mPhvWarning = `⚠ Pre-PHV athlete: AT contribution is ${mAtPct}%. AT is accessible pre-PHV but should remain below 20% of total training volume (Sweetenham).`;
  } else if (pPhvStatus === 'developing') {
    if (mLtlpPct > 30)
      mPhvWarning = `⚠ Early post-PHV: LT/LP contribution is ${mLtlpPct}% even after age-appropriate zone reduction. Very high-intensity glycolytic set — use sparingly and monitor recovery carefully.`;
  }

  // ── Consistency warning ───────────────────────────────────────────────────
  const mObjConsistency = consistencyCheck({
    qty: pQty, targetTimeSec: pTargetTimeSec, restSec: pRestSec,
    pace200Sec: pPace200Sec, stroke: pStroke,
    phvStatus: pPhvStatus, lactateClearMult: pLactateClearMult, distM: pDistM,
  });

  return {
    breakdown     : mBreakdown,
    primary       : mBreakdown[0],
    repResults    : mRepResults,
    speedRatio    : mSpeedRatio,
    workDur       : pTargetTimeSec,
    restWorkRatio : pRestSec / pTargetTimeSec,
    base100Pace   : mBase100,
    repPace100    : mRepPace100,
    totalVolume   : pDistM * pQty,
    avgAtpcp      : mAvgAtpcp,
    avgGlycolytic : mAvgGlyco,
    avgAerobic    : mAvgAerobic,
    paceValidation: validatePace({ distM: pDistM, targetTimeSec: pTargetTimeSec, pace200Sec: pPace200Sec, stroke: pStroke }),
    phvStatus     : pPhvStatus,
    phvWarning    : mPhvWarning,
    consistencyWarning: mObjConsistency,
    restoreCheck  : {
      atpcpRestored   : pRestSec >= pTargetTimeSec * 6,
      atpcpRestorePct : Math.min(100, Math.round(pRestSec * mAtpcpRestoreRate * 100)),
    },
    lastRep: mRepResults[mRepResults.length - 1],
  };
}

export { classifySet };
