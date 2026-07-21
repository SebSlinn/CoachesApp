// classifierService.js — Classification service layer.
//
// TODAY:  imports directly from the logic tier (zones/).
// FUTURE: replace each function body with a fetch('/api/classify/…') call.
//         Callers never change — only this file changes.
//
// Naming: p prefix on all parameters (cross-function / passed in).

import { classifySet    } from '../zones/classify.js';
import { suggestTimes   } from '../zones/suggest.js';
import { validatePace   } from '../zones/validatePace.js';
import { parseTime      } from '../zones/helpers.js';

// ─── classifySingleSet ────────────────────────────────────────────────────────
// Classifies one training set against the Sweetenham energy zone model.
//
// pInputs shape:
//   { distM, qty, targetTime, onTime, restSec, pace200, stroke, phvStatus,
//     restType, lactateClearMult, cssValue }
//
// Returns the result object from classifySet(), or null if inputs are incomplete.
//
function classifySingleSet(pInputs) {
  const mDistM    = parseFloat(pInputs.distM);
  const mQty      = parseInt(pInputs.qty);
  const mPace200  = parseTime(pInputs.pace200);
  const mTargetSec = parseTime(pInputs.targetTime);

  if (!mDistM || !mQty || !mPace200 || !mTargetSec) return null;

  // Rest seconds: explicit restSec OR derived from onTime - targetTime
  let mRestSec;
  if (pInputs.onTime) {
    const mOnSec = parseTime(pInputs.onTime);
    mRestSec = mOnSec > mTargetSec ? mOnSec - mTargetSec : 0;
  } else {
    mRestSec = parseFloat(pInputs.restSec) || 0;
  }

  return classifySet({
    distM            : mDistM,
    qty              : mQty,
    targetTimeSec    : mTargetSec,
    restSec          : mRestSec,
    pace200Sec       : mPace200,
    stroke           : pInputs.stroke   || 'FS',
    phvStatus        : pInputs.phvStatus || 'post',
    lactateClearMult : parseFloat(pInputs.lactateClearMult) || 1.0,
    cssValue         : pInputs.cssValue  || null,
  });
}

// ─── suggestSetTimes ─────────────────────────────────────────────────────────
// Reverse-classifies: given a zone and distance, returns suggested IN/ON times.
//
// pZone     : e.g. 'AT', 'A3', 'LP'
// pDistM    : number or string, metres
// pStroke   : 'FS' | 'BK' | 'BR' | 'Fly' | 'IM' | 'Kick'
// pPace200  : string e.g. '2:12' (200m PB for that stroke)
// pCssValue : seconds per 100m CSS pace, or null
//
// Returns object with inLowStr, inHighStr, onLowStr, onHighStr, inMidStr, onMidStr.
//
function suggestSetTimes(pZone, pDistM, pStroke, pPace200, pCssValue) {
  const mPace200Sec = parseTime(pPace200);
  if (!mPace200Sec || !pDistM || !pZone) return null;
  return suggestTimes(pZone, parseFloat(pDistM), pStroke, mPace200Sec, pCssValue);
}

// ─── validateSetPace ─────────────────────────────────────────────────────────
// Checks whether a target time is physically plausible for this athlete.
// Returns { warningLevel, warningMsg, hvoTimeSec, absoluteMinSec } or null.
//
function validateSetPace(pDistM, pTargetTime, pPace200, pStroke) {
  const mTargetSec  = parseTime(pTargetTime);
  const mPace200Sec = parseTime(pPace200);
  if (!mTargetSec || !mPace200Sec || !pDistM) return null;
  return validatePace({
    distM        : parseFloat(pDistM),
    targetTimeSec: mTargetSec,
    pace200Sec   : mPace200Sec,
    stroke       : pStroke || 'FS',
  });
}

export { classifySingleSet, suggestSetTimes, validateSetPace };
