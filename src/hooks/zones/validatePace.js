import { STROKE_MULT } from './constants.js';
import { fmtTime } from './helpers.js';

// validatePace — checks whether a target time is physically plausible.
// Parameters: p prefix (passed-in object fields)
function validatePace({ distM: pDistM, targetTimeSec: pTargetTimeSec, pace200Sec: pPace200Sec, stroke: pStroke }) {
  if (!pDistM || !pTargetTimeSec || !pPace200Sec) return null;

  const mMult         = STROKE_MULT[pStroke] || 1.0;
  const mPace200adj   = pPace200Sec * mMult;
  const mHvoPer100    = (mPace200adj / 2) - 10;             // fastest HVO training pace /100m
  const mHvoTime      = (mHvoPer100 / 100) * pDistM;        // HVO time for this distance
  const mPushOff      = 5 / 2.5;                            // 5m push-off at 2.5 m/s
  const mSwimMin      = Math.max(0, pDistM - 5) / 2.0;      // theoretical max swim speed
  const mAbsMin       = mPushOff + mSwimMin;
  const mHvoLeeway    = mHvoTime * 0.85;

  let mWarningLevel = null, mWarningMsg = null;
  if (pTargetTimeSec < mAbsMin) {
    mWarningLevel = 'impossible';
    mWarningMsg   = `⚠ IMPOSSIBLE PACE: ${pDistM}m in ${pTargetTimeSec.toFixed(1)}s is below the physical floor (${mAbsMin.toFixed(1)}s off a push-off). Zone classification shown is hypothetical only.`;
  } else if (pTargetTimeSec < mHvoLeeway) {
    mWarningLevel = 'caution';
    mWarningMsg   = `⚠ EXCEEDS HVO CAP: Target pace is faster than the maximum HVO training speed for this athlete (~${fmtTime(mHvoTime)} for ${pDistM}m). Check entry — or this is a racing dive effort, not a training rep.`;
  }
  return { warningLevel: mWarningLevel, warningMsg: mWarningMsg, hvoTimeSec: mHvoTime, absoluteMinSec: mAbsMin };
}

export { validatePace };
