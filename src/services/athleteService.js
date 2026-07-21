// src/services/athleteService.js
// All athlete data operations: parse, build, save, load, export, import.
// Pure functions — no React, no DOM, no localStorage side-effects (callers handle those).
// Future: replace function bodies with fetch('/api/athlete/…') calls; signatures stay the same.

import {
  STALE_MONTHS, VALID_DISTS, STROKE_NAMES,
  parseDateToAge, splitTimeToken, parseTimeToSec, deriveAthleteType,
} from '../athlete/parse.js';

// ─── Parse ────────────────────────────────────────────────────────────────────

/**
 * Parse raw text pasted from SwimmingResults.org into a times map + log.
 * Returns { times, log, name, seNumber, club }.
 * The caller is responsible for updating state and persisting to localStorage.
 *
 * @param {string} pRawText  Raw paste from SwimmingResults.org
 * @returns {{ times: Object, log: string[], name: string, seNumber: string, club: string }}
 */
export function parseSwimmingResultsText(pRawText) {
  const mLog   = [];
  const mTimes = {};
  let mName = '', mSeNumber = '', mClub = '';

  // Normalise non-breaking spaces and other Unicode whitespace
  let mText = '';
  for (let ci = 0; ci < pRawText.length; ci++) {
    const code = pRawText.charCodeAt(ci);
    mText += (code === 160 || (code >= 8192 && code <= 8203)) ? ' ' : pRawText[ci];
  }

  // Extract athlete header: "Name - (SENumber) - Club"
  const mDashParen = mText.indexOf(' - (');
  if (mDashParen > -1) {
    const mLineStart = mText.lastIndexOf('\n', mDashParen) + 1;
    const mLineEnd   = mText.indexOf('\n', mDashParen);
    const mHeader    = mText.slice(mLineStart, mLineEnd > -1 ? mLineEnd : mText.length).trim();
    const mP1 = mHeader.indexOf(' - (');
    const mP2 = mHeader.indexOf(') - ', mP1);
    if (mP1 > -1 && mP2 > -1) {
      mName     = mHeader.slice(0, mP1).trim();
      mSeNumber = mHeader.slice(mP1 + 4, mP2).trim();
      mClub     = mHeader.slice(mP2 + 4).trim();
      mLog.push('Athlete: ' + mName + ' (' + mSeNumber + ')');
    }
  }

  // Find Long Course / Short Course sections
  const mSections = [];
  const mLcIdx = mText.indexOf('Long Course');
  const mScIdx = mText.indexOf('Short Course');
  if (mLcIdx > -1) mSections.push({ label: 'LC', pos: mLcIdx });
  if (mScIdx > -1) mSections.push({ label: 'SC', pos: mScIdx });
  mSections.sort((a, b) => a.pos - b.pos);

  if (mSections.length === 0) {
    return {
      times: mTimes,
      log: ["No 'Long Course' or 'Short Course' section found."],
      name: mName, seNumber: mSeNumber, club: mClub,
    };
  }

  mSections.forEach((mSec, mSi) => {
    const mSecEnd  = mSi + 1 < mSections.length ? mSections[mSi + 1].pos : mText.length;
    const mSecText = mText.slice(mSec.pos, mSecEnd);
    const mPool    = mSec.label;
    mLog.push('Parsing ' + mPool + ' section (' + mSecText.length + ' chars)');

    VALID_DISTS.forEach(mDist => {
      STROKE_NAMES.forEach(mSn => {
        const mMarker = mDist + ' ' + mSn.name;
        const mMi = mSecText.indexOf(mMarker);
        if (mMi < 0) return;

        const mAfter = mSecText.slice(mMi + mMarker.length);
        const mT1    = splitTimeToken(mAfter, 0);
        if (!mT1) return;
        const mT2 = splitTimeToken(mAfter, mT1.end);

        const mActualSec = parseTimeToSec(mT1.token);
        if (!mActualSec || mActualSec < 10) return;

        const mLcEqSec = mPool === 'LC'
          ? mActualSec
          : (mT2 ? parseTimeToSec(mT2.token) : mActualSec);
        if (!mLcEqSec || mLcEqSec < 10) return;

        const mDisplay = mT1.token.indexOf(':') > -1
          ? mT1.token
          : Math.floor(mActualSec / 60) + ':' + (mActualSec % 60).toFixed(2).padStart(5, '0');

        // Scan ahead for a date in dd/mm/yy format
        let mDateStr = '';
        let k = mT2 ? mT2.end : mT1.end;
        let mScanned = 0;
        while (k < mAfter.length && mScanned < 200) {
          if (mAfter[k] >= '0' && mAfter[k] <= '9') {
            const mCand = mAfter.slice(k, k + 8);
            let d2 = 0, m2 = 0, y2 = 0, ci = 0;
            while (ci < mCand.length && mCand[ci] >= '0' && mCand[ci] <= '9') { d2 = d2 * 10 + parseInt(mCand[ci]); ci++; }
            if (mCand[ci] === '/') {
              ci++;
              while (ci < mCand.length && mCand[ci] >= '0' && mCand[ci] <= '9') { m2 = m2 * 10 + parseInt(mCand[ci]); ci++; }
              if (mCand[ci] === '/') {
                ci++;
                while (ci < mCand.length && mCand[ci] >= '0' && mCand[ci] <= '9') { y2 = y2 * 10 + parseInt(mCand[ci]); ci++; }
                if (d2 > 0 && d2 <= 31 && m2 > 0 && m2 <= 12 && y2 > 0) {
                  mDateStr = (d2 < 10 ? '0' : '') + d2 + '/' + (m2 < 10 ? '0' : '') + m2 + '/' + y2;
                  break;
                }
              }
            }
          }
          k++; mScanned++;
        }

        const mMonthsOld = parseDateToAge(mDateStr);
        const mStale     = mMonthsOld !== null && mMonthsOld > STALE_MONTHS;
        const mKey       = mDist + '_' + mSn.code;

        if (!mTimes[mKey] || mLcEqSec < mTimes[mKey].lcEq) {
          mTimes[mKey] = {
            sec: mActualSec, lcEq: mLcEqSec, display: mDisplay,
            pool: mPool, dist: mDist, code: mSn.code, stroke: mSn.name,
            date: mDateStr, monthsOld: mMonthsOld, stale: mStale,
          };
          mLog.push('  ' + mPool + ' ' + mDist + 'm ' + mSn.name + ': ' + mDisplay + (mStale ? ' [STALE]' : ''));
        }
      });
    });
  });

  mLog.push('Parsed ' + Object.keys(mTimes).length + ' times.');
  return { times: mTimes, log: mLog, name: mName, seNumber: mSeNumber, club: mClub };
}

// ─── Build ────────────────────────────────────────────────────────────────────

/**
 * Build a complete athlete object ready for persistence.
 * Derives profile if not already provided.
 *
 * @param {{ name, seNumber, club, times, athleteType, phvStatus, derivedProfile }} pFields
 * @returns {Object} athlete object
 */
export function buildAthleteObject(pFields) {
  const mProfile = pFields.derivedProfile || deriveAthleteType(pFields.times) || null;
  return {
    name:           pFields.name,
    seNumber:       pFields.seNumber,
    club:           pFields.club,
    times:          pFields.times,
    derivedProfile: mProfile,
    athleteType:    pFields.athleteType,
    phvStatus:      pFields.phvStatus,
    pace200:        pFields.times?.['200_FS']?.display || '',
  };
}

// ─── Export / Import ──────────────────────────────────────────────────────────

/**
 * Serialise an athlete to a portable JSON string (SwimZone-Athlete-v1 format).
 *
 * @param {{ name, seNumber, club, times, derivedProfile, athleteType, phvStatus }} pAthlete
 * @returns {string} JSON string
 */
export function exportAthleteJson(pAthlete) {
  return JSON.stringify({
    _format:        'SwimZone-Athlete-v1',
    name:           pAthlete.name,
    seNumber:       pAthlete.seNumber,
    club:           pAthlete.club,
    times:          pAthlete.times,
    derivedProfile: pAthlete.derivedProfile,
    athleteType:    pAthlete.athleteType,
    phvStatus:      pAthlete.phvStatus,
  }, null, 2);
}

/**
 * Parse an athlete JSON string back into an athlete object.
 * Returns the parsed object on success, or throws an Error with a readable message.
 *
 * @param {string} pJsonText
 * @returns {Object} athlete fields
 * @throws {Error}
 */
export function importAthleteJson(pJsonText) {
  let mObj;
  try {
    mObj = JSON.parse(pJsonText);
  } catch (e) {
    throw new Error('Invalid JSON: ' + e.message);
  }
  if (!mObj._format || !mObj._format.startsWith('SwimZone-Athlete')) {
    throw new Error('Not a SwimZone athlete file (missing _format field)');
  }
  return {
    name:           mObj.name           || '',
    seNumber:       mObj.seNumber       || '',
    club:           mObj.club           || '',
    times:          mObj.times          || {},
    derivedProfile: mObj.derivedProfile || null,
    athleteType:    mObj.athleteType    || 'allround',
    phvStatus:      mObj.phvStatus      || 'post',
  };
}
