// src/records/eventView.js
// Pure helpers behind the Records drill-down pages (event page + single swim).
// No React, no Supabase — given the rows getResultHistory returns, work out
// courses, PBs as they stood on each date, improvements and lap splits.
// Tested by src/records/eventView.test.mjs.

export const STROKE_LABEL = { FS: 'Freestyle', BK: 'Backstroke', BR: 'Breaststroke', Fly: 'Butterfly', IM: 'Individual Medley', Kick: 'Kick' };
export const STROKE_SHORT = { FS: 'Free', BK: 'Back', BR: 'Breast', Fly: 'Fly', IM: 'IM', Kick: 'Kick' };

// Course from the stored pool type. SC and LC times are NOT comparable, so
// everything course-aware (PBs, "was it a PB?", improvement) is per course.
export function courseOf(pPoolType) {
  if (!pPoolType) return 'unknown';
  if (pPoolType === '50LC' || pPoolType === 'LC') return 'LC';
  if (pPoolType === '25Y') return 'SCY';
  return 'SC';
}
export const COURSE_LABEL = { LC: 'Long course', SC: 'Short course', SCY: 'Short course (yards)', unknown: 'Pool not recorded' };

// URL-safe event key: "100-FS". Kept separate from the internal `${stroke}${dist}`
// grouping so a stroke code containing digits could never be ambiguous.
export const eventSlug = (pStroke, pDistM) => `${pDistM}-${pStroke}`;
export function parseEventSlug(pSlug) {
  const m = /^(\d+)-([A-Za-z]+)$/.exec(String(pSlug || ''));
  return m ? { distM: Number(m[1]), stroke: m[2] } : null;
}
export const eventTitle = (pStroke, pDistM) => `${pDistM}m ${STROKE_LABEL[pStroke] || pStroke}`;

const byDateThenTime = (a, b) => (a.swumOn < b.swumOn ? -1 : a.swumOn > b.swumOn ? 1 : Number(a.timeSec) - Number(b.timeSec));

// Annotate one event's swims (any order in) oldest → newest, per course:
//   prevBest  — the course best BEFORE this swim (null for the first swim)
//   isPB      — this swim beat (or set) the course best at the time
//   gainSec   — prevBest − time (positive = faster than the old PB)
//   isCurrentPB — it is the course best today
// Only maximal swims set PBs; submaximal/unknown are carried but never PBs.
export function annotateEvent(pRows) {
  const mRows = (pRows || []).slice().sort(byDateThenTime);
  const mBest = {};          // course → best time so far
  const mOut = mRows.map((r) => {
    const c = courseOf(r.poolType);
    const t = Number(r.timeSec);
    const counts = r.effort == null || r.effort === 'maximal';
    const prev = mBest[c] ?? null;
    const isPB = counts && t > 0 && (prev == null || t < prev);
    if (isPB) mBest[c] = t;
    return { ...r, course: c, prevBest: prev, isPB, gainSec: isPB && prev != null ? +(prev - t).toFixed(2) : null };
  });
  for (const r of mOut) r.isCurrentPB = r.isPB && Number(r.timeSec) === mBest[r.course];
  // two swims can tie the PB; only the earliest holds it
  const seen = new Set();
  for (const r of mOut) { if (r.isCurrentPB) { if (seen.has(r.course)) r.isCurrentPB = false; else seen.add(r.course); } }
  return mOut;
}

// Headline numbers for an event, per course present.
export function eventSummary(pAnnotated) {
  const out = {};
  for (const r of pAnnotated) {
    const s = (out[r.course] = out[r.course] || { course: r.course, count: 0, pb: null, first: null, latest: null });
    s.count++;
    if (!s.first) s.first = r;
    s.latest = r;
    if (r.isCurrentPB) s.pb = r;
  }
  for (const s of Object.values(out)) {
    // improvement first → PB (positive = faster), and how long the PB has stood
    s.totalGainSec = s.pb && s.first && s.first !== s.pb ? +(Number(s.first.timeSec) - Number(s.pb.timeSec)).toFixed(2) : null;
  }
  return out;
}

// Order courses for display: LC, SC, SCY, unknown — only those present.
export const courseOrder = (pSummary) => ['LC', 'SC', 'SCY', 'unknown'].filter((c) => pSummary[c]);

// Lap splits from stored splits. Poolside stores CUMULATIVE times
// ([{dist:50, sec:31.2}, {dist:100, sec:65.0}]); some imports store plain
// numbers. Returns [{ dist, cumSec, lapSec, lapDist, extra }] with extra holding
// any per-length readings (sc, sr, hrFirst, hrLast …).
export function lapSplits(pSplits, pDistM) {
  if (!Array.isArray(pSplits) || pSplits.length === 0) return [];
  const mNorm = pSplits.map((s, i) => {
    if (typeof s === 'number') return { dist: null, sec: s, idx: i };
    const { dist, sec, ...extra } = s || {};
    return { dist: dist != null ? Number(dist) : null, sec: Number(sec), extra, idx: i };
  }).filter((s) => s.sec > 0);
  if (!mNorm.length) return [];
  // If distances are missing, spread evenly across the race distance.
  const n = mNorm.length;
  for (const s of mNorm) if (s.dist == null && pDistM) s.dist = Math.round((pDistM / n) * (s.idx + 1));
  // Cumulative when times increase AND the last is roughly lapCount × first lap
  // (lap times of an even swim also "increase" slightly — 31.2, 33.8 — but end
  // nowhere near 2 × 31.2). Otherwise they're already lap times.
  const increasing = mNorm.every((s, i) => i === 0 || s.sec > mNorm[i - 1].sec)
    && (n === 1 || mNorm[n - 1].sec >= mNorm[0].sec * n * 0.75);
  let mCum = 0;
  return mNorm.map((s, i) => {
    const cum = increasing ? s.sec : (mCum += s.sec);
    const prevCum = i === 0 ? 0 : (increasing ? mNorm[i - 1].sec : cum - s.sec);
    const prevDist = i === 0 ? 0 : (mNorm[i - 1].dist || 0);
    return { dist: s.dist, cumSec: +cum.toFixed(2), lapSec: +(cum - prevCum).toFixed(2), lapDist: s.dist != null ? s.dist - prevDist : null, extra: s.extra || {} };
  });
}

// Readable label for a swim's type.
export function kindLabel(r) {
  if (r.kind === 'meet') return r.provenance?.sanctioned === false ? 'Gala (unlicensed)' : 'Competition';
  if (r.kind === 'time_trial') return 'Time trial';
  if (r.kind === 'training') return 'Training';
  return r.kind || '';
}

// Known per-swim metric keys → labels (metrics are cleaned to these upstream).
export const METRIC_LABEL = {
  hr: 'Heart rate', hrAvg: 'Avg HR', hrPeak: 'Peak HR', hrEnd: 'HR at finish',
  hrRec10: 'HR +10 s', hrRec30: 'HR +30 s', hrRec60: 'HR +60 s', hrDrop30: 'HR drop in 30 s',
  sc: 'Stroke count', sr: 'Stroke rate', rpe: 'RPE', lactate: 'Lactate',
};
export const METRIC_UNIT = { hr: 'bpm', hrAvg: 'bpm', hrPeak: 'bpm', hrEnd: 'bpm', hrRec10: 'bpm', hrRec30: 'bpm', hrRec60: 'bpm', hrDrop30: 'bpm', sr: '/min', lactate: 'mmol/L' };
