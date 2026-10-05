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

/** A run of identical bpm longer than this, with no fresh beat data, is flagged as "held". */
export const HR_HELD_SEC = 8;

/**
 * How trustworthy the live stream has been over the last window.
 * Answers: how often is the display fresh, and is the sensor repeating itself?
 *
 * @param samples  [{ t, bpm, rr? }]
 * @param now      epoch ms (default Date.now())
 * @param windowMs default 60 s
 * @returns {
 *   freshPct      0–100: share of 1-second slots in the window that received a reading
 *   readings      readings in the window
 *   longestGapSec longest stretch with no reading (includes the gap up to `now`)
 *   currentAgeSec seconds since the last reading (null if none)
 *   rrPct         0–100: share of readings carrying beat-to-beat (RR) data — real beats
 *   heldSec       longest run of the same bpm with no changing RR data
 *   held          true if heldSec ≥ HR_HELD_SEC (sensor probably repeating an old estimate)
 *   verdict       'good' | 'patchy' | 'poor' | 'none'
 * }
 */
export function freshness(pSamples, now = Date.now(), windowMs = 60000) {
  const mAll = (pSamples || []).filter((s) => s.t <= now && s.bpm > 0);
  const mLast = mAll.at(-1) || null;
  const currentAgeSec = mLast ? Math.round((now - mLast.t) / 100) / 10 : null;
  // The window starts at the first reading if that's more recent — time before the
  // sensor was connected isn't a gap.
  const mFrom = mAll.length ? Math.max(now - windowMs, mAll[0].t - 1) : now - windowMs;
  const mIn = mAll.filter((s) => s.t > mFrom);
  if (!mIn.length) {
    return { freshPct: 0, readings: 0, longestGapSec: windowMs / 1000, currentAgeSec,
      rrPct: 0, heldSec: 0, held: false, verdict: 'none', windowSec: windowMs / 1000 };
  }

  const mSlots = new Set(mIn.map((s) => Math.floor((s.t - mFrom) / 1000)));
  const mSlotCount = Math.max(1, Math.ceil((now - mFrom) / 1000));
  const freshPct = Math.round((Math.min(mSlots.size, mSlotCount) / mSlotCount) * 100);

  let mGap = (mIn[0].t - mFrom) / 1000;
  for (let i = 1; i < mIn.length; i++) mGap = Math.max(mGap, (mIn[i].t - mIn[i - 1].t) / 1000);
  mGap = Math.max(mGap, (now - mIn.at(-1).t) / 1000);

  const rrPct = Math.round((mIn.filter((s) => s.rr?.length).length / mIn.length) * 100);

  // Held: same bpm, and either no RR data or RR identical to the previous packet.
  let mHeld = 0, mRunStart = mIn[0].t;
  const same = (a, b) => a.bpm === b.bpm &&
    (!b.rr?.length || (a.rr?.length && a.rr.join() === b.rr.join()));
  for (let i = 1; i < mIn.length; i++) {
    if (same(mIn[i - 1], mIn[i])) mHeld = Math.max(mHeld, (mIn[i].t - mRunStart) / 1000);
    else mRunStart = mIn[i].t;
  }
  const heldSec = Math.round(mHeld * 10) / 10;
  const held = heldSec >= HR_HELD_SEC;

  const verdict = held || freshPct < 30 ? 'poor' : freshPct < 70 || mGap > 10 ? 'patchy' : 'good';
  return { freshPct, readings: mIn.length, longestGapSec: Math.round(mGap * 10) / 10,
    currentAgeSec, rrPct, heldSec, held, verdict, windowSec: Math.round((now - mFrom) / 1000) };
}

// ── Recording side: the stream as stored, and per-rep / per-run roll-ups ─────

/** Per-rep metric keys the sensor fills (besides `hr`, which a coach may also type). */
export const HR_METRIC_KEYS = ['hrAvg', 'hrPeak', 'hrEnd', 'hrRec10', 'hrRec30', 'hrRec60', 'hrDrop30', 'hrCoverage'];

/**
 * Compact a stream for a file / the database: { source, sensor, samples:[[t,bpm],…] }.
 * Keeps only samples within [from, to] when given.
 */
export function packStream(pSamples, { source = 'ble-poolside', sensor = '', from = -Infinity, to = Infinity } = {}) {
  const samples = (pSamples || [])
    .filter((s) => s && s.bpm > 0 && s.t >= from && s.t <= to)
    .map((s) => [Math.round(s.t), s.bpm]);
  return { source, sensor, samples };
}

/** Inverse of packStream → [{t,bpm}] (accepts either packed pairs or {t,bpm} objects). */
export function unpackStream(pStream) {
  const mRaw = Array.isArray(pStream) ? pStream : pStream && pStream.samples;
  if (!Array.isArray(mRaw)) return [];
  return mRaw.map((x) => (Array.isArray(x) ? { t: Number(x[0]), bpm: Number(x[1]) } : { t: Number(x.t), bpm: Number(x.bpm) }))
    .filter((s) => Number.isFinite(s.t) && s.bpm > 0)
    .sort((a, b) => a.t - b.t);
}

/**
 * Fill each rep's metrics from the stream. Reps need startedAt + timeSec.
 * A coach-typed `hr` is kept (typed wins); the sensor's figure is used otherwise.
 * Returns new rep objects; reps with no HR data are returned unchanged.
 */
export function applyHrToReps(pReps, pSamples) {
  if (!pSamples || !pSamples.length) return pReps;
  const mOrder = pReps.map((r, i) => ({ i, t: Date.parse(r.startedAt) })).sort((a, b) => a.t - b.t);
  const mNext = new Map();
  mOrder.forEach((o, k) => mNext.set(o.i, mOrder[k + 1] ? mOrder[k + 1].t : undefined));
  return pReps.map((r, i) => {
    const m = repHrMetrics(pSamples, { startedAt: r.startedAt, timeSec: Number(r.timeSec), nextStartedAt: mNext.get(i) });
    if (!m.hrSamples && m.hrRec30 == null) return r;
    const mMetrics = { ...(r.metrics || {}) };
    for (const k of HR_METRIC_KEYS) if (m[k] != null) mMetrics[k] = m[k];
    if (mMetrics.hr == null && m.hr != null) mMetrics.hr = m.hr;
    return { ...r, metrics: mMetrics };
  });
}

/**
 * One line per run for lists: peak, typical end-of-rep HR, mean 30-s drop,
 * and how much of the swimming had readings. null when no rep has HR.
 */
export function hrRollup(pReps) {
  const mWith = (pReps || []).filter((r) => r.metrics && (r.metrics.hrPeak != null || r.metrics.hr != null));
  if (!mWith.length) return null;
  const vals = (k) => mWith.map((r) => Number(r.metrics[k])).filter(Number.isFinite);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const peaks = vals('hrPeak').concat(vals('hr'));
  const cover = vals('hrCoverage');
  const drop = vals('hrDrop30');
  const mEnd = mean(vals('hr'));
  return {
    reps: mWith.length,
    peak: peaks.length ? Math.max(...peaks) : null,
    meanEnd: mEnd == null ? null : Math.round(mEnd),
    meanDrop30: drop.length ? Math.round(mean(drop)) : null,
    coverage: cover.length ? Math.round(mean(cover) * 100) / 100 : null,
    fromSensor: cover.length > 0,
  };
}
