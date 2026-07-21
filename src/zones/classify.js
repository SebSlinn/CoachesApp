// Zones/classify.js
import { STROKE_MULT, ZONES } from './constants.js';
import { parseTime, fmtTime } from './helpers.js';
import { validatePaceWithContext } from './validatePace.js';
import { phvZoneCaps, repEnergy, paceImpairment, consistencyCheck } from './energy.js';

function classifySet({ distM, qty, targetTimeSec, restSec, pace200Sec,
                        stroke, phvStatus, lactateClearMult = 1.0,
                        cssValue = null, athleteCtx = null }) {
  if (!distM || !qty || !targetTimeSec || restSec === null || restSec === undefined || isNaN(restSec) || !pace200Sec) return null;

  const mult        = STROKE_MULT[stroke] || 1.0;
  const base100Pace = (pace200Sec * mult) / 2;
  const repPace100  = (targetTimeSec / distM) * 100;
  const speedRatio  = repPace100 / base100Pace;

  const atpcpRestoreRate   = 1 / 180;
  const lactateRestoreRate = (1 / 300) * lactateClearMult;  // rest type × athlete type

  let atpcpStore = 1.0, lactateBuf = 1.0;
  let repResults = [];
  let cumulative = { atpcp: 0, glycolytic: 0, aerobic: 0 };

  for (let r = 0; r < qty; r++) {
    const energy = repEnergy(targetTimeSec, speedRatio, atpcpStore, lactateBuf, phvStatus);
    repResults.push({ rep: r + 1, ...energy, atpcpStore, lactateBuf });
    cumulative.atpcp      += energy.atpcp;
    cumulative.glycolytic += energy.glycolytic;
    cumulative.aerobic    += energy.aerobic;

    const atpcpUsed   = Math.min(atpcpStore, (Math.min(targetTimeSec, 15) / 15) * atpcpStore);
    atpcpStore        = Math.max(0, atpcpStore - atpcpUsed);
    const lactateUsed = energy.glycolytic * 0.25 * (targetTimeSec / 60);
    lactateBuf        = Math.max(0, lactateBuf - lactateUsed);

    atpcpStore = Math.min(1, atpcpStore + restSec * atpcpRestoreRate);
    lactateBuf = Math.min(1, lactateBuf + restSec * lactateRestoreRate);
  }

  const n             = qty;
  const avgAtpcp      = cumulative.atpcp      / n;
  const avgGlycolytic = cumulative.glycolytic / n;
  const avgAerobic    = cumulative.aerobic    / n;

  // ── PHV zone caps ─────────────────────────────────────────────────────────
  const { ltCap, lpCap, atCap } = phvZoneCaps(phvStatus);

  // ── Glycolytic → Sweetenham zone split ───────────────────────────────────
  let glycoLT = 0, glycoLP = 0, glycoAT = 0;
  if (speedRatio < 0.95) {
    // PL / LT territory — above race pace
    glycoLT = avgGlycolytic * 0.70 * ltCap;
    glycoLP = avgGlycolytic * 0.30 * lpCap;
    const spill = avgGlycolytic * (0.70 * (1 - ltCap) + 0.30 * (1 - lpCap));
    glycoAT += spill * atCap;
  } else if (speedRatio < 0.97) {
    // LT territory — fast glycolytic, near race pace
    glycoLT = avgGlycolytic * 0.85 * ltCap;
    glycoLP = avgGlycolytic * 0.15 * lpCap;
    const spill2 = avgGlycolytic * (0.85 * (1 - ltCap) + 0.15 * (1 - lpCap));
    glycoAT += spill2 * atCap;
  } else if (speedRatio < 1.025) {
    // LP zone — race pace territory, requires just over 1:1 rest:work
    // If rest is insufficient (<1:1), classify as AT (lactate accumulates, not LP structure)
    const lpRestOk = restSec >= targetTimeSec * 0.9; // ~1:1 with 10% tolerance
    if (lpRestOk) {
      glycoLP = avgGlycolytic * 0.70 * lpCap;
      glycoAT = avgGlycolytic * 0.30 * atCap;
      const spill = avgGlycolytic * (0.70 * (1 - lpCap));
      glycoAT += spill * atCap;
    } else {
      // Rest too short for LP — reclassify as AT
      glycoAT = avgGlycolytic * 0.80 * atCap;
      glycoLP = avgGlycolytic * 0.20 * lpCap;
      const spill = avgGlycolytic * (0.80 * (1 - atCap) + 0.20 * (1 - lpCap));
      glycoAT += spill * atCap;
    }
  } else if (speedRatio < 1.10) {
    glycoAT = avgGlycolytic * 0.75 * atCap;
    glycoLP = avgGlycolytic * 0.25 * lpCap;
    const spill = avgGlycolytic * (0.25 * (1 - lpCap));
    glycoAT += spill * atCap;
  } else {
    glycoAT = avgGlycolytic * 0.40 * atCap;
    glycoLP = avgGlycolytic * 0.10 * lpCap;
  }

  // ── Aerobic → Sweetenham zone split ──────────────────────────────────────
  // FIX: For intense sets (speedRatio < 1.10) the aerobic system is working at
  // near-maximum — A2/A1 labels are inappropriate. Floor at A3.
  // For moderate-easy sets: normal aerobic zone distribution applies.
  let aeroA3 = 0, aeroA2 = 0, aeroA1 = 0;
  if (speedRatio < 1.10) {
    // Hard effort — aerobic component is ALL upper aerobic (A3). No A2/A1.
    aeroA3 = avgAerobic;
  } else if (speedRatio < 1.22) {
    aeroA3 = avgAerobic * 0.70;
    aeroA2 = avgAerobic * 0.25;
    aeroA1 = avgAerobic * 0.05;
  } else if (speedRatio < 1.38) {
    aeroA2 = avgAerobic * 0.65;
    aeroA3 = avgAerobic * 0.25;
    aeroA1 = avgAerobic * 0.10;
  } else {
    aeroA1 = avgAerobic * 0.65;
    aeroA2 = avgAerobic * 0.35;
  }

  const rawScores = {
    HVO: avgAtpcp, LT: glycoLT, LP: glycoLP, AT: glycoAT,
    A3: aeroA3, A2: aeroA2, A1: aeroA1,
  };

  const total = Object.values(rawScores).reduce((a, b) => a + b, 0);
  const breakdown = ZONES.map(z => ({
    ...z,
    pct: Math.round((rawScores[z.id] / total) * 100),
  })).sort((a, b) => b.pct - a.pct);
  const pctTotal = breakdown.reduce((a, z) => a + z.pct, 0);
  if (pctTotal !== 100) breakdown[0].pct += (100 - pctTotal);

  // ── PHV warning ───────────────────────────────────────────────────────────
  const ltlpTotal = rawScores.LT + rawScores.LP;
  const ltlpPct   = Math.round((ltlpTotal / total) * 100);
  const atPct     = Math.round((rawScores.AT  / total) * 100);
  let phvWarning  = null;
  if (phvStatus === "pre") {
    if (ltlpPct > 5)
      phvWarning = `⚠ Pre-PHV athlete: LT and LP zones are not appropriate — lactate system is underdeveloped. Energy has been redistributed toward AT and aerobic zones.${atPct > 25 ? ` AT contribution is ${atPct}% — keep this type of set below 20% of total weekly volume.` : ""}`;
    else if (atPct > 30)
      phvWarning = `⚠ Pre-PHV athlete: AT contribution is ${atPct}%. AT is accessible pre-PHV but should remain below 20% of total training volume (Sweetenham).`;
  } else if (phvStatus === "developing") {
    // Note: lpCap=0.5 and ltCap=0.3 already halve the raw LP/LT contribution.
    // The warning should only fire if LP/LT is still high AFTER capping —
    // i.e. the set is so glycolytic that even 50% of LP is a large fraction.
    // Threshold raised to 30% (post-cap) to avoid false alarms on appropriate LP sets.
    if (ltlpPct > 30)
      phvWarning = `⚠ Early post-PHV: LT/LP contribution is ${ltlpPct}% even after age-appropriate zone reduction. This is a very high-intensity glycolytic set — use sparingly and monitor recovery carefully.`;
  }

  // ── Consistency warning ───────────────────────────────────────────────────
  const consistencyWarning = consistencyCheck({
    qty, targetTimeSec, restSec, pace200Sec, stroke,
    phvStatus, lactateClearMult, distM,
  });

  // ── CS detection ──────────────────────────────────────────────────────────
  // Checks whether a single set qualifies as Critical Speed training.
  // Requires cssValue (seconds per 100m) — derived from athlete's 200m + 400m PBs.
  let csDetection = null;
  if (cssValue) {
    const mCssLow  = cssValue * 0.95;
    const mCssHigh = cssValue * 1.05;
    const mSpeedOk = repPace100 >= mCssLow && repPace100 <= mCssHigh;

    // Work:rest ratio — CS requires approx 1.2:1 to 2.5:1 (work time : rest time)
    const mWorkRestRatio = restSec > 0 ? targetTimeSec / restSec : Infinity;
    const mRestOk  = mWorkRestRatio >= 1.2 && mWorkRestRatio <= 2.5;

    // Volume — 22–38 min total work time
    const mTotalWorkMin = (targetTimeSec * qty) / 60;
    const mVolumeOk = mTotalWorkMin >= 22 && mTotalWorkMin <= 38;

    const mMatchCount = [mSpeedOk, mRestOk, mVolumeOk].filter(Boolean).length;

    csDetection = {
      isCS:          mMatchCount === 3,
      partial:       mMatchCount === 2,
      speedOk:       mSpeedOk,
      restOk:        mRestOk,
      volumeOk:      mVolumeOk,
      cssPace:       cssValue,
      repPace100:    repPace100,
      totalWorkMin:  mTotalWorkMin.toFixed(1),
      workRest:      mWorkRestRatio === Infinity ? '∞' : mWorkRestRatio.toFixed(2),
    };
  }

  return {
    breakdown, primary: breakdown[0], repResults, speedRatio,
    workDur: targetTimeSec, restWorkRatio: restSec / targetTimeSec,
    base100Pace, repPace100, totalVolume: distM * qty,
    avgAtpcp, avgGlycolytic, avgAerobic,
    paceValidation: validatePaceWithContext(
      { distM, targetTimeSec, restSec, qty, pace200Sec, stroke },
      athleteCtx
    ),
    phvStatus, phvWarning, consistencyWarning,
    csDetection,
    restoreCheck: {
      atpcpRestored: restSec >= targetTimeSec * 6,
      atpcpRestorePct: Math.min(100, Math.round(restSec * atpcpRestoreRate * 100)),
    },
    lastRep: repResults[repResults.length - 1],
  };
}

// ─── Energy graph ─────────────────────────────────────────────────────────────

export { classifySet };
