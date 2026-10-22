// src/zones/zoneCriteria.js
// Model-agnostic zone matching criteria.
//
// IMPORTS: only ./types.js (the criteria data). The evaluator itself is pure.
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
//   racePace: { offsetLow, offsetHigh }
//     200 race-pace band: ½ × 200 time + offsetLow to + offsetHigh s/100m. The 200 time is
//     athleteContext.goal200Sec when set, else pace200Sec. Without either → speed fallback.
//
//   eventPace: { sprint|allround|endurance: { event, lo, hi } }
//     Race pace for the athlete's event, picked by athleteContext.athleteType. Event pace
//     per 100 = event PB / event × 100 (for 200: goal200Sec, else pace200Sec, else the
//     200 PB in times). Passes when repPace100 is within [pace × lo, pace × hi] (null = open).
//     Needs athleteType, pInputs.stroke (FS default) and athleteContext.times[`${event}_${stroke}`].sec.
//     Without them → speed fallback.
//
//   restWorkByAthleteType: { sprint|allround|endurance: [min, max] }
//     Replaces restWork for that athlete type when athleteContext.athleteType is known.
//   onRestRatiosByAthleteType: { type: [r, ...] }   (suggestTimes only)
//
//   onRestRatios: [r, ...]
//     Rest:work ratios suggestTimes() offers as send-offs (not evaluated).
//
//   onSec: [min, max]
//     Send-off (start-to-start) seconds = rep time + rest. null = unbounded.
//   onOptions: [sec, ...]
//     Fixed send-offs suggestTimes() offers for this type (not evaluated).
//
//   volumeM: [min, max]
//     Total metres (distM × qty). Used when volumeByAthleteType has no band for the athlete.
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
//   hrBand: { fromBbm, toBbm }
//     Heart rate as beats below the athlete's max HR (bbm = maxHr − hr).
//     Passes when fromBbm ≤ bbm ≤ toBbm (null = open). Needs BOTH
//     athleteContext.maxHr AND a measured HR on the inputs (pInputs.hr, else
//     hrPeak, else hrAvg — a swum set from Tests/Records). Missing either →
//     SKIPPED, never failed. A planned set has no HR, so prescribing is unaffected.
//
//   after: [codes]
//     The type only applies straight after one of these types. Needs
//     pInputs.prevType; without it the evaluator returns null ("no opinion")
//     for the whole type. No type uses it yet — kept for sequence-defined methods.
//
// All present conditions must pass for isMatch = true.
// If ≥1 passes and ≥1 fails → isPartial = true.
// If a zone has no conditions → returns null (no opinion).
// Conditions that cannot be evaluated (missing athleteContext) are skipped —
// they contribute neither to pass nor fail counts.

import { criteriaTable } from './types.js';

// ── Sweetenham model ────────────────────────────────────────────────────────
// The criteria now live with each training type in types.js (one entry per code).
// This table is derived from it, each type's hrBand folded in as a condition.

const ZONE_CRITERIA_SWEETENHAM = criteriaTable();

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
 *                                  targetTime. Optional: hr | hrPeak | hrAvg (bpm,
 *                                  swum sets) and prevType (type of the line before).
 * @param {Object} [pAthleteCtx]    optional { css, pace200Sec, athleteType, maxHr } for athlete-
 *                                  specific criteria. Pass null/undefined to
 *                                  use ratio-band fallbacks.
 * @returns {{isMatch, isPartial, criteria}|null}
 */
export function evaluateZoneMatch(pZoneId, pSingleResult, pInputs, pAthleteCtx) {
  const mCrit = ACTIVE_CRITERIA[pZoneId];
  if (!mCrit || !pSingleResult) return null;

  // after: needs the previous line's type; without it, no opinion.
  if (mCrit.after) {
    const mPrev = pInputs?.prevType;
    if (!mPrev) return null;
  }

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

  // ── racePace ───────────────────────────────────────────────────────────────
  // ½ × 200 goal (else 200 PB) per 100m ± offsets — the second 100 of the 200.
  let mRacePaceEvaluated = false;
  const mRace200 = Number(pAthleteCtx?.goal200Sec) || Number(pAthleteCtx?.pace200Sec) || null;
  if (mCrit.racePace && mRace200) {
    mRacePaceEvaluated = true;
    const mIsGoal = !!Number(pAthleteCtx?.goal200Sec);
    const mBase   = mRace200 / 2;
    const mPaceLo = mBase + mCrit.racePace.offsetLow;
    const mPaceHi = mBase + mCrit.racePace.offsetHigh;
    const mOk     = pSingleResult.repPace100 >= mPaceLo && pSingleResult.repPace100 <= mPaceHi;
    mResults.push({
      key: 'racePace', label: 'Pace',
      met: mOk,
      detail: `${fmtPace(pSingleResult.repPace100)}/100m (need ${fmtPace(mPaceLo)}–${fmtPace(mPaceHi)}/100m ≈ ½ × 200 ${mIsGoal ? 'goal' : 'PB'})`,
    });
  }

  // ── eventPace ──────────────────────────────────────────────────────────────
  // Race pace for the athlete's event (per athlete type).
  let mEventPaceEvaluated = false;
  const mEp = mCrit.eventPace ? eventPaceFor(mCrit.eventPace, pAthleteCtx, pInputs?.stroke) : null;
  if (mEp) {
    mEventPaceEvaluated = true;
    const mLo = mEp.lo === null ? null : mEp.pace100 * mEp.lo;
    const mHi = mEp.hi === null ? null : mEp.pace100 * mEp.hi;
    const mP  = pSingleResult.repPace100;
    const mOk = (mLo === null || mP >= mLo - 0.05) && (mHi === null || mP <= mHi + 0.05);
    mResults.push({
      key: 'eventPace', label: 'Race pace',
      met: mOk,
      detail: `${fmtPace(mP)}/100m` + describeRange(mLo, mHi, v => fmtPace(v) + '/100m') +
        ` — ${mEp.event}m pace ${fmtPace(mEp.pace100)}/100m`,
    });
  }

  // ── speed (ratio band fallback) ────────────────────────────────────────────
  // Skip if an athlete-specific pace condition was already evaluated for this zone.
  const mHasAbsolutePace = mCssPaceEvaluated || mAtPaceEvaluated || mRacePaceEvaluated || mEventPaceEvaluated;
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
  const mRwBand = mCrit.restWorkByAthleteType?.[pAthleteCtx?.athleteType] || mCrit.restWork;
  if (mRwBand && !mRestSecEvaluated) {
    const [mLo, mHi] = mRwBand;
    const mOk = (mLo === null || mRw >= mLo) && (mHi === null || mRw <= mHi);
    mResults.push({
      key: 'restWork', label: 'Rest:Work',
      met: mOk,
      detail: `${mRw.toFixed(2)}:1` +
        describeRange(mLo, mHi, v => v.toFixed(2) + ':1'),
    });
  }

  // ── onSec (send-off, start-to-start) ──────────────────────────────────────
  if (mCrit.onSec) {
    const [mLo, mHi] = mCrit.onSec;
    const mOn = mWd + mRestSec;
    const mOk = (mLo === null || mOn >= mLo - 0.5) && (mHi === null || mOn <= mHi + 0.5);
    mResults.push({
      key: 'onSec', label: 'Send-off',
      met: mOk,
      detail: `on ${fmtPace(mOn)}` + describeRange(mLo, mHi, fmtPace),
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
  let mVolMEvaluated = false;
  if (mCrit.volumeByAthleteType && pAthleteCtx?.athleteType) {
    const mBand = mCrit.volumeByAthleteType[pAthleteCtx.athleteType];
    if (mBand) {
      mVolMEvaluated = true;
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

  // ── volumeM (metres, any athlete) ──────────────────────────────────────────
  if (mCrit.volumeM && !mVolMEvaluated) {
    const mVolM = mDist * mQty;
    const [mLo, mHi] = mCrit.volumeM;
    const mOk = (mLo === null || mVolM >= mLo) && (mHi === null || mVolM <= mHi);
    mResults.push({
      key: 'volumeM', label: 'Volume',
      met: mOk,
      detail: `${mVolM}m` + describeRange(mLo, mHi, v => v + 'm'),
    });
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

  // ── after ──────────────────────────────────────────────────────────────────
  if (mCrit.after) {
    const mPrev = pInputs.prevType;
    mResults.push({
      key: 'after', label: 'Follows',
      met: mCrit.after.includes(mPrev),
      detail: `after ${mPrev} (need after ${mCrit.after.join('/')})`,
    });
  }

  // ── hrBand ─────────────────────────────────────────────────────────────────
  // Beats below max. Skipped (not failed) without max HR or a measured HR.
  const mMaxHr = Number(pAthleteCtx?.maxHr) || null;
  const mHr    = Number(pInputs?.hr ?? pInputs?.hrPeak ?? pInputs?.hrAvg) || null;
  if (mCrit.hrBand && mMaxHr && mHr) {
    const { fromBbm: mLo = null, toBbm: mHi = null } = mCrit.hrBand;
    const mBbm = mMaxHr - mHr;
    const mOk  = (mLo === null || mBbm >= mLo) && (mHi === null || mBbm <= mHi);
    mResults.push({
      key: 'hrBand', label: 'Heart rate',
      met: mOk,
      detail: `${Math.round(mHr)} bpm = ${Math.round(mBbm)} below max ${Math.round(mMaxHr)}` +
        describeRange(mLo, mHi, v => v + ' bbm'),
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

/**
 * The race-pace band for this athlete from an eventPace table.
 * @returns {{event:number, pace100:number, lo:number|null, hi:number|null}|null}
 */
function eventPaceFor(pTable, pCtx, pStroke) {
  const mBand = pTable?.[pCtx?.athleteType];
  if (!mBand) return null;
  const mStroke = pStroke || 'FS';
  let mSec = Number(pCtx?.times?.[`${mBand.event}_${mStroke}`]?.sec) || null;
  if (mBand.event === 200) {
    mSec = Number(pCtx?.goal200Sec) || Number(pCtx?.pace200Sec) || mSec;
  }
  if (!mSec) return null;
  return { event: mBand.event, pace100: mSec / mBand.event * 100, lo: mBand.lo ?? null, hi: mBand.hi ?? null };
}

/** 64.8 → "1:04.8", 32.4 → "32.4", 240 → "4:00". */
function fmtPace(pSec) {
  const mRound = Math.round(pSec * 10) / 10;
  const mM  = Math.floor(mRound / 60);
  const mS  = mRound - mM * 60;
  const mTxt = Number.isInteger(mS) ? String(mS) : mS.toFixed(1);
  if (mM === 0) return mTxt;
  return `${mM}:${mTxt.padStart(Number.isInteger(mS) ? 2 : 4, '0')}`;
}

function describeRange(pLo, pHi, pFmt) {
  if (pLo === null && pHi === null) return '';
  if (pLo === null) return ` (need <${pFmt(pHi)})`;
  if (pHi === null) return ` (need ≥${pFmt(pLo)})`;
  return ` (need ${pFmt(pLo)}–${pFmt(pHi)})`;
}

export { ACTIVE_CRITERIA, ZONE_CRITERIA_SWEETENHAM, eventPaceFor };
