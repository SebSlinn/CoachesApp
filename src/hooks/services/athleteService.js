// athleteService.js — Athlete data service layer.
//
// TODAY:  imports from athlete/ logic tier.
// FUTURE: replace function bodies with fetch('/api/athlete/…') calls.
//
// Naming: p prefix on all parameters.

import { parseSwimmingResults, deriveAthleteType } from '../athlete/parse.js';

// ─── parseAthleteResults ─────────────────────────────────────────────────────
// Parses raw SwimmingResults.org paste text into structured PB times.
//
// pRawText  : the raw pasted text from the website
// pDobStr   : date of birth string as entered (used to derive age/PHV status)
//
// Returns { times, parseLog, athleteAge, phvStatus } or null on failure.
// 'times' is a map of { '100_FS': sec, '200_BK': sec, … }
//
function parseAthleteResults(pRawText, pDobStr) {
  if (!pRawText) return null;

  // TODO (Phase 2): move the full handleParse() + parseDateToAge() +
  //                 splitTimeToken() logic from Classifier.jsx into
  //                 athlete/parse.js, then call it from here.
  //
  // For now this is a placeholder that returns null.
  return null;
}

// ─── buildAthleteProfile ────────────────────────────────────────────────────
// Takes a structured times map and derives the athlete's profile:
// sprint/distance bias, weak strokes, recommended training emphasis.
//
// pTimes     : { '100_FS': sec, '200_BK': sec, … }
// pPhvStatus : 'pre' | 'developing' | 'post'
//
// Returns profile object, or null if insufficient data.
//
function buildAthleteProfile(pTimes, pPhvStatus) {
  if (!pTimes || Object.keys(pTimes).length === 0) return null;

  // TODO (Phase 2): move deriveAthleteType() from Classifier.jsx into
  //                 athlete/parse.js, then call it from here.
  return null;
}

// ─── getPace200ByStroke ──────────────────────────────────────────────────────
// Derives a 200m pace map for each stroke from the athlete's PB times.
// Used by the classifier and session builder to calculate speed ratios.
//
// pTimes    : { '100_FS': sec, '200_BK': sec, … }
// pPoolM    : 25 | 50
//
// Returns { FS: sec, BK: sec, BR: sec, Fly: sec, IM: sec }
//
function getPace200ByStroke(pTimes, pPoolM) {
  if (!pTimes) return {};

  const mConvFactor = pPoolM === 50 ? 1.0 : 1.035; // short-course correction
  const mStrokes    = ['FS', 'BK', 'BR', 'Fly', 'IM'];
  const mObjResult  = {};

  mStrokes.forEach(function(mStroke) {
    const m200key = '200_' + mStroke;
    const m100key = '100_' + mStroke;
    if (pTimes[m200key]) {
      mObjResult[mStroke] = pTimes[m200key] * mConvFactor;
    } else if (pTimes[m100key]) {
      // Estimate 200 from 100 using a typical drop-off factor
      const mDropOff = mStroke === 'BR' ? 2.18 : mStroke === 'Fly' ? 2.22 : 2.10;
      mObjResult[mStroke] = pTimes[m100key] * mDropOff * mConvFactor;
    }
  });

  return mObjResult;
}

export { parseAthleteResults, buildAthleteProfile, getPace200ByStroke };
