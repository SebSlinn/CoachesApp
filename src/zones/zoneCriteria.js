// src/zones/zoneCriteria.js
// Model-agnostic zone matching criteria.
//
// PURPOSE
// Single source of truth for "what counts as zone X" — independent of UI.
// All banners and badges read from here via evaluateZoneMatch().
//
// MODEL SWAPPING
// Add a sibling export (e.g. ZONE_CRITERIA_OLBRECHT) with the same shape.
// Change ACTIVE_CRITERIA to swap globally — no UI changes needed.
//
// CONDITION TYPES
// Each zone criteria object may include any combination of:
//
//   speed: [min, max]
//     speedRatio = repPace100 / base100Pace (both in sec/100m).
//     LOWER = FASTER. < 1.0 means faster than 200m PB pace.
//     null = unbounded. Falls back to this if no athleteContext available.
//
//   atPace: { offsetLow, offsetHigh }
//     Athlete-specific AT pace band: ½ × 200PB + offsetLow to + offsetHigh
//     seconds per 100m. Requires athleteContext.pace200Sec.
//     If athleteContext absent, falls back to speed band.
//
//   cssPace: marginFraction
//     repPace100 within ±marginFraction of athleteContext.css (sec/100m).
//     Requires athleteContext.css. If absent, condition is skipped (unknown).
//
//   restWork: [min, max]
//     rest:work ratio range (restSec / targetTimeSec). null = unbounded.
//
//   restSecByDist: { default: [min, max], byDist: [[distMax, [min, max]], ...] }
//     Absolute rest seconds, with optional per-distance-range overrides.
//     Evaluated against the actual restSec in singleResult (= onTime - targetTime).
//     Ranges are checked in order; first matching distMax is used.
//
//   workDur: [min, max]
//     Per-rep work duration in seconds. null = unbounded.
//
//   volume: [min, max]
//     Total work time in seconds. Athlete-type volume scaling is applied
//     externally via the volumeScale factor in evaluateZoneMatch options.
//
//   distMax / distMin
//     Single-rep distance constraints in metres.
//
// All present conditions must pass for isMatch = true.
// If ≥1 passes and ≥1 fails → isPartial = true.
// If a zone has no conditions → returns null (no opinion).
// Conditions that cannot be evaluated (missing athleteContext) are skipped —
// they contribute neither to pass nor fail counts.

// ── Sweetenham model ────────────────────────────────────────────────────────

const ZONE_CRITERIA_SWEETENHAM = {

  // HVO — Alactic sprints. Faster than any race pace, very long rest, ≤15s reps.
  HVO: {
    speed:    [null, 0.85],       // >15% faster than 200PB pace
    restWork: [5, null],          // rest ≥ 5× work time
    workDur:  [null, 15],         // ≤15s per rep
  },

  // LT — Lactate Tolerance. High-speed glycolytic work.
  LT: {
    speed: [0.85, 0.97],
  },

  // LP — Lactate Production. Near race pace, ~1:1 rest:work, short reps.
  LP: {
    speed:    [0.97, 1.025],
    restWork: [1.0, 1.2],
    distMax:  100,
  },

  // AT — Anaerobic Threshold (Sweetenham).
  // Pace: ½ × 200PB + 7–10s per 100m.
  // Rest: ~10s for 50m, 10–20s for 100–400m.
  // Volume (metres): Sprinters 1500–3000, Mid 3000–4500, Distance >4500.
  // Falls back to ratio band [1.025, 1.10] when no athlete loaded.
  AT: {
    atPace:  { offsetLow: 7, offsetHigh: 10 },
    speed:   [1.025, 1.10],
    restSecByDist: {
      default: [10, 20],
      byDist:  [
        [50,  [5, 15]],
        [400, [10, 20]],
      ],
    },
    volumeByAthleteType: {
      sprint:    [1500, 3000],
      allround:  [3000, 4500],
      endurance: [4500, null],
    },
  },

  // A3 — Hard Aerobic. Overlaps AT at the fast end (both share +10s boundary).
  // Pace: ½ × 200PB + 10–15s per 100m.
  // Rest: 10–20s (same rest profile as AT — zone is distinguished by pace + context).
  // Distance: typically 50–400m, can be longer.
  // Falls back to ratio band [1.10, 1.22] when no athlete loaded.
  A3: {
    atPace:  { offsetLow: 10, offsetHigh: 15 },
    speed:   [1.10, 1.22],
    restSecByDist: {
      default: [10, 20],
      byDist:  [
        [50,  [5, 15]],
        [400, [10, 20]],
      ],
    },
  },

  // A2 — Moderate Aerobic.
  A2: {
    speed: [1.22, 1.38],
  },

  // A1 — Easy Aerobic / recovery.
  A1: {
    speed: [1.38, null],
  },

  // CS — Critical Speed. A training method in Zone 3 (AT/A3 crossover).
  // Pace: within ±5% of CSS (athlete-specific, from 1500+400 or 800+400 etc.).
  // Structure: work:rest ~1.2–2.5:1 (rest:work 0.4–0.83), 22–38 min volume.
  // Falls back to speed ratio [0.95, 1.05] when no CSS available.
  CS: {
    cssPace:  0.05,             // ±5% of athlete's CSS pace
    speed:    [0.95, 1.05],     // fallback ratio band
    restWork: [0.4, 0.83],      // rest:work 0.4–0.83 (work:rest 1.2–2.5)
    volume:   [22 * 60, 38 * 60],
  },
};

// Active model — change this single line to swap models globally.
const ACTIVE_CRITERIA = ZONE_CRITERIA_SWEETENHAM;

// ── Evaluator ────────────────────────────────────────────────────────────────

/**
 * Evaluate how well a classifySet() result matches a given zone's criteria.
 *
 * @param {string} pZoneId          zone id e.g. 'AT', 'CS', 'HVO'
 * @param {Object} pSingleResult    classifySet() result — needs speedRatio,
 *                                  restWorkRatio, workDur, repPace100,
 *                                  base100Pace
 * @param {Object} pInputs          classifier inputs — needs distM, qty, onTime,
 *                                  targetTime
 * @param {Object} [pAthleteCtx]    optional { css, pace200Sec } for athlete-
 *                                  specific criteria. Pass null/undefined to
 *                                  use ratio-band fallbacks.
 * @returns {{isMatch, isPartial, criteria}|null}
 */
export function evaluateZoneMatch(pZoneId, pSingleResult, pInputs, pAthleteCtx) {
  const mCrit = ACTIVE_CRITERIA[pZoneId];
  if (!mCrit || !pSingleResult) return null;

  const mResults   = [];
  const mSr        = pSingleResult.speedRatio;
  const mRw        = pSingleResult.restWorkRatio;   // rest / work
  const mWd        = pSingleResult.workDur;          // targetTimeSec
  const mDist      = parseFloat(pInputs?.distM) || 0;
  const mQty       = parseFloat(pInputs?.qty)   || 1;
  const mRestSec   = mRw * mWd;                     // derived rest seconds
  const mTotalWork = mWd * mQty;                    // total work seconds

  // ── cssPace ────────────────────────────────────────────────────────────────
  // Only when CSS is available. Replaces the speed fallback for CS.
  let mCssPaceEvaluated = false;
  if (mCrit.cssPace !== undefined && pAthleteCtx?.css) {
    mCssPaceEvaluated = true;
    const mMargin = mCrit.cssPace;
    const mCss    = pAthleteCtx.css;
    const mLo     = mCss * (1 - mMargin);
    const mHi     = mCss * (1 + mMargin);
    const mOk     = pSingleResult.repPace100 >= mLo && pSingleResult.repPace100 <= mHi;
    const mFmtPace = s => {
      const m = Math.floor(s / 60);
      const sec = (s % 60).toFixed(1);
      return m > 0 ? `${m}:${sec.padStart(4, '0')}` : sec;
    };
    mResults.push({
      key: 'cssPace', label: 'CSS pace',
      met: mOk,
      detail: `${mFmtPace(pSingleResult.repPace100)}/100m vs CSS ${mFmtPace(mCss)}/100m (±${(mMargin*100).toFixed(0)}%)`,
    });
  }

  // ── atPace ─────────────────────────────────────────────────────────────────
  // Athlete-specific AT pace band: ½ × 200PB + offsetLow to + offsetHigh.
  let mAtPaceEvaluated = false;
  if (mCrit.atPace && pAthleteCtx?.pace200Sec) {
    mAtPaceEvaluated = true;
    const mBase   = pAthleteCtx.pace200Sec / 2;   // ½ × 200PB in sec/100m
    const mPaceLo = mBase + mCrit.atPace.offsetLow;
    const mPaceHi = mBase + mCrit.atPace.offsetHigh;
    const mOk     = pSingleResult.repPace100 >= mPaceLo && pSingleResult.repPace100 <= mPaceHi;
    const mFmt    = s => {
      const m = Math.floor(s / 60);
      const sec = (s % 60).toFixed(1);
      return m > 0 ? `${m}:${sec.padStart(4, '0')}` : sec;
    };
    mResults.push({
      key: 'atPace', label: 'AT pace',
      met: mOk,
      detail: `${mFmt(pSingleResult.repPace100)}/100m (need ${mFmt(mPaceLo)}–${mFmt(mPaceHi)}/100m = ½×200PB +${mCrit.atPace.offsetLow}–${mCrit.atPace.offsetHigh}s)`,
    });
  }

  // ── speed (ratio band fallback) ────────────────────────────────────────────
  // Skip if an athlete-specific pace condition was already evaluated for this zone.
  const mHasAbsolutePace = mCssPaceEvaluated || mAtPaceEvaluated;
  if (mCrit.speed && !mHasAbsolutePace) {
    const [mLo, mHi] = mCrit.speed;
    const mOk = (mLo === null || mSr >= mLo) && (mHi === null || mSr < mHi);
    mResults.push({
      key: 'speed', label: 'Speed',
      met: mOk,
      detail: `${(mSr * 100).toFixed(0)}% of 200m pace` +
        describeRange(mLo, mHi, v => (v * 100).toFixed(0) + '%'),
    });
  }

  // ── restSecByDist ──────────────────────────────────────────────────────────
  // Absolute rest seconds — distance-specific bounds for AT.
  let mRestSecEvaluated = false;
  if (mCrit.restSecByDist) {
    mRestSecEvaluated = true;
    let mBand = mCrit.restSecByDist.default;
    for (const [mDistMax, mBandOpt] of (mCrit.restSecByDist.byDist || [])) {
      if (mDist <= mDistMax) { mBand = mBandOpt; break; }
    }
    const [mLo, mHi] = mBand;
    const mOk = (mLo === null || mRestSec >= mLo) && (mHi === null || mRestSec <= mHi);
    mResults.push({
      key: 'restSec', label: 'Rest',
      met: mOk,
      detail: `${mRestSec.toFixed(0)}s rest` +
        describeRange(mLo, mHi, v => v.toFixed(0) + 's'),
    });
  }

  // ── restWork (ratio) ───────────────────────────────────────────────────────
  // Skip if restSecByDist already evaluated rest (avoid double-counting).
  if (mCrit.restWork && !mRestSecEvaluated) {
    const [mLo, mHi] = mCrit.restWork;
    const mOk = (mLo === null || mRw >= mLo) && (mHi === null || mRw <= mHi);
    mResults.push({
      key: 'restWork', label: 'Rest:Work',
      met: mOk,
      detail: `${mRw.toFixed(2)}:1` +
        describeRange(mLo, mHi, v => v.toFixed(2) + ':1'),
    });
  }

  // ── workDur ────────────────────────────────────────────────────────────────
  if (mCrit.workDur) {
    const [mLo, mHi] = mCrit.workDur;
    const mOk = (mLo === null || mWd >= mLo) && (mHi === null || mWd <= mHi);
    mResults.push({
      key: 'workDur', label: 'Rep duration',
      met: mOk,
      detail: `${mWd.toFixed(0)}s` +
        describeRange(mLo, mHi, v => v.toFixed(0) + 's'),
    });
  }

  // ── volume ─────────────────────────────────────────────────────────────────
  if (mCrit.volume) {
    const [mLo, mHi] = mCrit.volume;
    const mOk = (mLo === null || mTotalWork >= mLo) && (mHi === null || mTotalWork <= mHi);
    mResults.push({
      key: 'volume', label: 'Volume',
      met: mOk,
      detail: `${(mTotalWork / 60).toFixed(1)} min` +
        describeRange(mLo, mHi, v => (v / 60).toFixed(0) + ' min'),
    });
  }

  // ── volumeByAthleteType (metres) ───────────────────────────────────────────
  // Only evaluated when athleteContext.athleteType is known.
  if (mCrit.volumeByAthleteType && pAthleteCtx?.athleteType) {
    const mBand = mCrit.volumeByAthleteType[pAthleteCtx.athleteType];
    if (mBand) {
      const mVolM = mDist * mQty;  // total metres
      const [mLo, mHi] = mBand;
      const mOk = (mLo === null || mVolM >= mLo) && (mHi === null || mVolM <= mHi);
      mResults.push({
        key: 'volumeM', label: 'Volume',
        met: mOk,
        detail: `${mVolM}m` + describeRange(mLo, mHi, v => v + 'm'),
      });
    }
  }

  // ── distMax / distMin ──────────────────────────────────────────────────────
  if (mCrit.distMax !== undefined || mCrit.distMin !== undefined) {
    const mLo = mCrit.distMin ?? null;
    const mHi = mCrit.distMax ?? null;
    const mOk = (mLo === null || mDist >= mLo) && (mHi === null || mDist <= mHi);
    mResults.push({
      key: 'dist', label: 'Distance',
      met: mOk,
      detail: `${mDist}m` + describeRange(mLo, mHi, v => v + 'm'),
    });
  }

  if (mResults.length === 0) return null;

  const mMetCount = mResults.filter(r => r.met).length;
  return {
    isMatch:   mMetCount === mResults.length,
    isPartial: mMetCount > 0 && mMetCount < mResults.length,
    criteria:  mResults,
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function describeRange(pLo, pHi, pFmt) {
  if (pLo === null && pHi === null) return '';
  if (pLo === null) return ` (need <${pFmt(pHi)})`;
  if (pHi === null) return ` (need ≥${pFmt(pLo)})`;
  return ` (need ${pFmt(pLo)}–${pFmt(pHi)})`;
}

export { ACTIVE_CRITERIA, ZONE_CRITERIA_SWEETENHAM };
