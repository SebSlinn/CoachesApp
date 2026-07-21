// src/zones/validatePace.js
// Validation hierarchy for training set pace and achievability.
// Zero imports from app code — pure JS, self-contained, extractable.
//
// HIERARCHY (applied in order, highest severity wins for warningLevel,
// but ALL fired checks are returned so UI can show full picture):
//
//   Level 1 — Physical absolute floor
//     Pace below push-off + swimming speed physics → IMPOSSIBLE (high confidence)
//
//   Level 2 — Speed chart validation (50m and 100m reps)
//     Rep pace faster than athlete's predicted split at that distance,
//     derived from known PB via speedChart coefficients → IMPOSSIBLE (high confidence)
//     Requires: athleteContext.times[distKey] or athleteContext.pace50Sec
//
//   Level 3 — CSS-relative validation
//     Effective continuous time (total work + rest) faster than CSS-derived
//     floor for total distance, adjusted for athlete type and distance scale.
//     → VERY_UNLIKELY (high confidence when CSS measured, medium if predicted)
//     Requires: athleteContext.css (from derivedProfile)
//
//   Level 4 — Rest sufficiency
//     At AT-intensity or faster with negligible rest:work ratio, lactate
//     accumulates faster than clearance. → WARNING (medium confidence)
//
//   Level 5 — Consistency (handled separately by energy.js/consistencyCheck)
//     Per-rep degradation modelling. Only meaningful if levels 1-4 pass.
//
// Each check that fires adds an entry to the `checks` array.
// `warningLevel` is the most severe level across all fired checks.
// `warningMsg` is the primary human-readable message.

import { STROKE_MULT } from './constants.js';
import { fmtTime }     from './helpers.js';
import { getSpeedProfile, toLCTime } from './speedChart.js';

// ── CSS distance scale factors ─────────────────────────────────────────────
// How much faster than CSS-pace an athlete can sustain for shorter total efforts.
// Scale: 1.0 = exact CSS pace. < 1.0 = faster than CSS.
// Above ~1500m total, effort exceeds CSS pace (volume fatigue).
// Values by [athleteType][totalDistanceBand].

const CSS_SCALE = {
  // [totalDist ≤ D]: scaleFactor  (lower = faster than CSS)
  sprint:    [[400, 0.92], [800, 0.96], [1500, 1.00], [Infinity, 1.04]],
  allround:  [[400, 0.94], [800, 0.98], [1500, 1.00], [Infinity, 1.03]],
  endurance: [[400, 0.96], [800, 0.98], [1500, 1.00], [Infinity, 1.02]],
};

function getCssScaleFactor(pTotalDistM, pAthleteType) {
  const mBands = CSS_SCALE[pAthleteType] || CSS_SCALE.allround;
  for (const [mDist, mFactor] of mBands) {
    if (pTotalDistM <= mDist) return mFactor;
  }
  return 1.0;
}

// ── Main validator ─────────────────────────────────────────────────────────

/**
 * Validate a training set against a hierarchy of pace checks.
 *
 * @param {Object} pSet
 *   distM          {number}  Rep distance in metres
 *   targetTimeSec  {number}  Target time per rep in seconds
 *   restSec        {number}  Rest per rep in seconds
 *   qty            {number}  Number of reps
 *   pace200Sec     {number}  Athlete's 200m FS PB in seconds
 *   stroke         {string}  'FS' 'BK' 'BR' 'Fly' 'IM'
 *
 * @param {Object|null} pAthleteCtx  Optional athlete context:
 *   css            {number}  CSS pace in seconds/100m (from derivedProfile)
 *   athleteType    {string}  'sprint' | 'allround' | 'endurance'
 *   times          {Object}  Raw times map from athlete setup
 *   gender         {string}  'M' | 'F' (default 'F' if absent)
 *   pool           {string}  Pool type of known times ('50LC' '25SC' '25Y')
 *
 * @returns {Object}
 *   warningLevel  {string|null}  'impossible' | 'very_unlikely' | 'warning' | null
 *   warningMsg    {string|null}  Primary message for UI display
 *   checks        {Array}        All fired checks [{level, source, msg, confidence}]
 *   hvoTimeSec    {number}       HVO cap time (for display)
 *   absoluteMinSec {number}      Physical floor (for display)
 */
export function validatePace({ distM, targetTimeSec, restSec = 0, qty = 1,
                                pace200Sec, stroke }) {
  // Overload: if called with old 2-arg signature, use no athlete context
  return validatePaceWithContext(
    { distM, targetTimeSec, restSec, qty, pace200Sec, stroke },
    null
  );
}

export function validatePaceWithContext(pSet, pAthleteCtx) {
  const { distM, targetTimeSec, restSec = 0, qty = 1, pace200Sec, stroke } = pSet;
  if (!distM || !targetTimeSec || !pace200Sec) return null;

  const mMult         = STROKE_MULT[stroke] || 1.0;
  const mPace200adj   = pace200Sec * mMult;
  const mChecks       = [];
  let   mWorstLevel   = null;

  const mLevels = { impossible: 3, very_unlikely: 2, warning: 1 };
  function mFire(pLevel, pSource, pMsg, pConfidence = 'high') {
    mChecks.push({ level: pLevel, source: pSource, msg: pMsg, confidence: pConfidence });
    if (!mWorstLevel || mLevels[pLevel] > mLevels[mWorstLevel]) mWorstLevel = pLevel;
  }

  // ── Level 1: Physical absolute floor ──────────────────────────────────────
  const mPushOffSec    = 5 / 2.5;                          // 2s to cover first 5m
  const mSwimMinSec    = Math.max(0, distM - 5) / 2.0;     // remaining at 2m/s max
  const mAbsoluteMin   = mPushOffSec + mSwimMinSec;

  if (targetTimeSec < mAbsoluteMin) {
    mFire('impossible', 'physical_floor',
      `⚠ IMPOSSIBLE: ${distM}m in ${targetTimeSec.toFixed(1)}s is below the physical floor (${mAbsoluteMin.toFixed(1)}s off push). Zone classification is hypothetical only.`
    );
  }

  // HVO cap (15% leeway — racing dive efforts, not typical training reps)
  const mHvoPacePer100 = (mPace200adj / 2) - 10;
  const mHvoTimeSec    = (mHvoPacePer100 / 100) * distM;
  const mHvoWithLeeway = mHvoTimeSec * 0.85;
  if (targetTimeSec < mHvoWithLeeway && targetTimeSec >= mAbsoluteMin) {
    mFire('impossible', 'hvo_cap',
      `⚠ EXCEEDS HVO CAP: Target is faster than this athlete's maximum HVO training speed (~${fmtTime(mHvoTimeSec)} for ${distM}m). Check entry.`
    );
  }

  // ── Level 2: Speed chart validation (50m and 100m reps only) ──────────────
  if ((distM === 50 || distM === 100) && pAthleteCtx) {
    const mGender   = pAthleteCtx.gender || 'F';
    const mPool     = pAthleteCtx.pool   || '50LC';

    // Find best known time for this distance/stroke, convert to LC
    const mTimeKey  = `${distM}_${stroke}`;
    const mKnownRaw = pAthleteCtx.times?.[mTimeKey]?.sec;
    const mKnown    = mKnownRaw ? toLCTime(mKnownRaw, mPool) : null;

    // Derive from 50m if looking at 50m reps and we have the time
    if (mKnown) {
      const mProfile = getSpeedProfile(mKnown, distM, stroke, mGender);
      if (mProfile) {
        // The chart gives predicted RACE split at each marker.
        // For a training rep starting from push-off (not dive), we compare
        // targetTimeSec against the full chart finish time.
        // Rule: race speed should be achievable in training up to ~60% of race distance.
        const mChartMax = mKnown; // PB is the ceiling for reps of that distance
        if (targetTimeSec < mChartMax * 0.97) {
          // Target is faster than 97% of their PB — likely impossible in training
          mFire('impossible', 'speed_chart',
            `⚠ IMPOSSIBLE: ${distM}m target ${fmtTime(targetTimeSec)} is faster than ${stroke} PB (${fmtTime(mKnown)} LC). ` +
            `Max speed profile: 25m split ~${mProfile.splits[2]?.toFixed(2)}s, max speed ~${mProfile.maxSpeedMs}m/s.`,
            'high'
          );
        } else if (targetTimeSec < mChartMax) {
          mFire('very_unlikely', 'speed_chart',
            `⚠ VERY HARD: ${distM}m target ${fmtTime(targetTimeSec)} is faster than ${stroke} PB (${fmtTime(mKnown)} LC). Possible only with dive start.`,
            'high'
          );
        }
      }
    }
  }

  // ── Level 3: CSS-relative validation ──────────────────────────────────────
  if (pAthleteCtx?.css) {
    const mCss          = pAthleteCtx.css;         // sec/100m
    const mAthleteType  = pAthleteCtx.athleteType || 'allround';
    const mTotalDist    = distM * qty;             // metres
    const mTotalWork    = targetTimeSec * qty;     // seconds
    const mTotalRest    = restSec * Math.max(0, qty - 1);
    const mEffective    = mTotalWork + mTotalRest; // effective continuous time
    const mCssTotalTime = (mCss / 100) * mTotalDist;
    const mScale        = getCssScaleFactor(mTotalDist, mAthleteType);
    const mCssFloor     = mCssTotalTime * mScale;

    if (mEffective < mCssFloor * 0.98) {
      const mFmtEff   = fmtTime(mEffective);
      const mFmtFloor = fmtTime(mCssFloor);
      const mFmtCss   = `${Math.floor(mCss/60)}:${(mCss%60).toFixed(2).padStart(5,'0')}`;
      mFire('very_unlikely', 'css_relative',
        `⚠ LIKELY NOT ACHIEVABLE: Effective ${mTotalDist}m time ${mFmtEff} (incl. ${mTotalRest.toFixed(0)}s rest) ` +
        `is faster than CSS-derived floor ${mFmtFloor} for a ${mAthleteType} swimmer ` +
        `(CSS: ${mFmtCss}/100m, scale: ${(mScale*100).toFixed(0)}% for ${mTotalDist}m).`,
        'high'
      );
    } else if (mEffective < mCssFloor) {
      const mFmtCss = `${Math.floor(mCss/60)}:${(mCss%60).toFixed(2).padStart(5,'0')}`;
      mFire('warning', 'css_relative',
        `⚠ VERY CHALLENGING: Effective effort approaching CSS floor for ${mTotalDist}m ` +
        `(CSS: ${mFmtCss}/100m). This set will be very hard to sustain.`,
        'medium'
      );
    }
  }

  // ── Level 4: Rest sufficiency ───────────────────────────────────────────────
  // At AT pace or faster (speedRatio < 1.10) with very low rest:work ratio,
  // lactate accumulates faster than clearance.
  if (!mWorstLevel || mLevels[mWorstLevel] < mLevels.very_unlikely) {
    const mBase100     = (mPace200adj) / 2;
    const mRepPace100  = (targetTimeSec / distM) * 100;
    const mSpeedRatio  = mRepPace100 / mBase100;
    const mRestWork    = restSec / targetTimeSec;

    if (mSpeedRatio < 1.10 && mRestWork < 0.10 && qty > 4) {
      mFire('warning', 'rest_sufficiency',
        `⚠ INSUFFICIENT REST: At this pace (${(mSpeedRatio*100).toFixed(0)}% of 200PB) ` +
        `only ${restSec.toFixed(0)}s rest (${(mRestWork*100).toFixed(0)}% of rep time) ` +
        `will not allow meaningful lactate clearance over ${qty} reps.`,
        'medium'
      );
    }
  }

  return {
    warningLevel:    mWorstLevel,
    warningMsg:      mChecks[0]?.msg || null,   // primary (worst) message
    checks:          mChecks,                    // all fired checks
    hvoTimeSec:      mHvoTimeSec,
    absoluteMinSec:  mAbsoluteMin,
  };
}
