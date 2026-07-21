// sessionService.js — Session / set-builder service layer.
//
// TODAY:  imports from session/ and lib/sessions/ logic tier.
// FUTURE: replace function bodies with fetch('/api/session/…') calls.
//
// Naming: p prefix on all parameters.

import { flattenBlock, classifySequence } from '../session/model.js';
import { parseTime, fmtTime             } from '../zones/helpers.js';

// ─── classifySessionBlock ────────────────────────────────────────────────────
// Flattens a session block tree and classifies the full sequence.
//
// pBlock        : the root block or group object
// pPace200Map   : { FS: sec, BK: sec, … } — 200m PB seconds by stroke
// pPhvStatus    : 'pre' | 'developing' | 'post'
// pCssValue     : seconds per 100m CSS pace, or null
//
// Returns classifySequence result object, or null if no swimmable reps found.
//
function classifySessionBlock(pBlock, pPace200Map, pPhvStatus, pCssValue) {
  if (!pBlock || !pPace200Map) return null;
  const mReps = flattenBlock(pBlock, pPace200Map, pPhvStatus);
  if (!mReps || mReps.length === 0) return null;
  return classifySequence(mReps, pPhvStatus, 1.0, pCssValue);
}

// ─── calcBlockTimes ─────────────────────────────────────────────────────────
// Returns { workSec, onSec, restSec } for a single swim line.
// Used by the set builder to display timing totals.
//
// pLine shape: { targetTime, onTime, qty, distM }
//
function calcBlockTimes(pLine) {
  const mWorkSec = parseTime(pLine.targetTime) || 0;
  const mOnStr   = pLine.onTime || pLine.targetTime || '0';
  const mOnSec   = parseTime(mOnStr) || mWorkSec;
  const mQty     = parseInt(pLine.qty) || 1;
  return {
    workSec : mWorkSec,
    onSec   : mOnSec,
    restSec : Math.max(0, mOnSec - mWorkSec),
    qty     : mQty,
    totalWorkSec : mWorkSec * mQty,
    totalOnSec   : mOnSec   * mQty,
  };
}

// ─── formatSessionAsHtml ─────────────────────────────────────────────────────
// Generates a styled HTML string for printing / clipboard export.
// pSession shape: { title, groups: [{ label, blocks: [block, …] }] }
// pPoolM: 25 or 50
//
// TODO (Phase 2): move the full generateSetHtml() body from Classifier.jsx here.
//                 For now this is a placeholder that returns null.
//
function formatSessionAsHtml(pSession, pPoolM) {
  // Placeholder — implementation moves here in Phase 2
  return null;
}

// ─── formatSessionAsJson ─────────────────────────────────────────────────────
// Serialises the session to a JSON string for save/export.
//
// TODO (Phase 2): move generateJson() body from Classifier.jsx here.
//
function formatSessionAsJson(pSession, pAthleteProfile) {
  return null;
}

// ─── importSessionFromJson ───────────────────────────────────────────────────
// Parses a saved JSON string back into a session object.
//
// TODO (Phase 2): move importJson() body from Classifier.jsx here.
//
function importSessionFromJson(pJsonText) {
  return null;
}

// ─── formatSessionAsCsv ──────────────────────────────────────────────────────
// TODO (Phase 2): move generateCsv() body from Classifier.jsx here.
//
function formatSessionAsCsv(pSession) {
  return null;
}

export {
  classifySessionBlock,
  calcBlockTimes,
  formatSessionAsHtml,
  formatSessionAsJson,
  importSessionFromJson,
  formatSessionAsCsv,
};
