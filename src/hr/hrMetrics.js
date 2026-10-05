// src/hr/hrMetrics.js
// Pure: turn a raw HR stream into per-rep numbers. Zero imports — runs in the
// browser (Poolside) and in node (tests). Copied to public/poolside/.
//
// Rule: raw samples are the truth; these numbers are derived and recomputable.
// Samples: [{ t: epochMs, bpm }] stamped on arrival (same clock as Poolside taps).

const RECOVERY_OFFSETS_S = [10, 30, 60];

function inWindow(pSamples, pFrom, pTo) {
  return pSamples.filter((s) => s.t >= pFrom && s.t <= pTo && s.bpm > 0);
}

/**
 * Share of the window (0–1) within gapMs/2 of a sample. Default 5 s: a swimmer
 * surfacing every few strokes counts as fully covered; a 20 s underwater gap doesn't.
 */
export function coverage(pSamples, pFrom, pTo, gapMs = 5000) {
  const mSpan = pTo - pFrom;
  if (mSpan <= 0) return 0;
  const mIn = inWindow(pSamples, pFrom - gapMs, pTo + gapMs).map((s) => s.t).sort((a, b) => a - b);
  if (!mIn.length) return 0;
  let mCovered = 0;
  let mEnd = pFrom;
  for (const t of mIn) {
    const a = Math.max(pFrom, t - gapMs / 2, mEnd);
    const b = Math.min(pTo, t + gapMs / 2);
    if (b > a) { mCovered += b - a; mEnd = b; }
  }
  return Math.min(1, mCovered / mSpan);
}

/** Nearest sample to time t within ±tolMs, or null. */
export function hrAt(pSamples, t, tolMs = 3000) {
  let mBest = null;
  for (const s of pSamples) {
    const d = Math.abs(s.t - t);
    if (d <= tolMs && (!mBest || d < Math.abs(mBest.t - t))) mBest = s;
  }
  return mBest ? mBest.bpm : null;
}

/**
 * Per-rep HR metrics.
 * @param samples   [{t, bpm}]
 * @param startedAt rep start (ISO string or epoch ms)
 * @param timeSec   rep duration
 * @param nextStartedAt optional — recovery readings stop at the next rep's start
 * @returns { hr, hrAvg, hrPeak, hrEnd, hrRec10, hrRec30, hrRec60, hrDrop30, hrCoverage, hrSamples }
 *   hr = best single figure for the readings sheet: the end-of-rep value if known, else peak.
 *   Values are null when there was no data.
 */
export function repHrMetrics(pSamples, { startedAt, timeSec, nextStartedAt } = {}) {
  const mStart = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
  if (!pSamples?.length || !Number.isFinite(mStart) || !(timeSec > 0)) return emptyMetrics();
  const mFinish = mStart + timeSec * 1000;
  const mNext = nextStartedAt == null ? Infinity
    : (typeof nextStartedAt === 'number' ? nextStartedAt : Date.parse(nextStartedAt));

  // Swimmers surface at the wall: allow the finish reading up to 5 s after the touch.
  const mWork = inWindow(pSamples, mStart, mFinish + 5000);
  const mBpms = mWork.map((s) => s.bpm);
  const hrAvg = mBpms.length ? Math.round(mBpms.reduce((a, b) => a + b, 0) / mBpms.length) : null;
  const hrPeak = mBpms.length ? Math.max(...mBpms) : null;
  const hrEnd = hrAt(pSamples, mFinish, 5000);

  const mOut = {
    hrAvg, hrPeak, hrEnd,
    hrCoverage: Math.round(coverage(pSamples, mStart, mFinish) * 100) / 100,
    hrSamples: mWork.length,
  };
  for (const off of RECOVERY_OFFSETS_S) {
    const at = mFinish + off * 1000;
    mOut[`hrRec${off}`] = at < mNext ? hrAt(pSamples, at, 4000) : null;
  }
  mOut.hrDrop30 = hrEnd != null && mOut.hrRec30 != null ? hrEnd - mOut.hrRec30 : null;
  mOut.hr = hrEnd ?? hrPeak;
  return mOut;
}

function emptyMetrics() {
  return { hr: null, hrAvg: null, hrPeak: null, hrEnd: null, hrRec10: null, hrRec30: null,
    hrRec60: null, hrDrop30: null, hrCoverage: 0, hrSamples: 0 };
}

/** Trim a stream to a session window and compact it for storage/export. */
export function sliceStream(pSamples, pFrom, pTo) {
  return inWindow(pSamples, pFrom, pTo).map((s) => ({ t: s.t, bpm: s.bpm }));
}

/** Coverage below this means the rep's HR shouldn't be trusted for trends. */
export const HR_MIN_COVERAGE = 0.4;
