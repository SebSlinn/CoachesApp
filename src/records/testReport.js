// src/records/testReport.js
// One model for every view of test-set results. The Test results screen, the
// CSV download and the formatted Excel workbook all read what these functions
// return, so the three can never disagree.
//
//   buildRunView(protocol, effort)  → one run, comprehensive (header, analyser
//                                      summary with labels/units, rep table,
//                                      per-length splits)
//   compareRuns(runViews)           → side by side: summary rows × runs, and
//                                      rep rows × runs with the fastest marked
//   toCsv(meta, runViews)           → tidy CSV, one row per rep per run
//
// Pure: no React, no Supabase, no Excel library. Tested by testReport.test.mjs.
import { analyse, expandReps, paramValueLabel } from '../session/protocolFormat.js';
import { parseSetTime } from '../session/setFormat.js';
import { lapSplits } from './eventView.js';

const STROKE = { FS: 'Free', BK: 'Back', BR: 'Breast', Fly: 'Fly', IM: 'IM', Kick: 'Kick' };
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

// ── Summary fields per analyser ───────────────────────────────────────────────
// kind: time  → a swim time in seconds (shown 1:05.43)
//       delta → signed seconds (+0.42 = slower)
//       sec   → plain seconds (rest, spread)
//       num   → plain number (unit in `unit`)
//       text / bool
// `better`: 'low' | 'high' — which way is an improvement, for highlighting.
const F = (key, label, kind, extra = {}) => ({ key, label, kind, ...extra });
export const SUMMARY_FIELDS = {
  ladder: [
    F('held', 'Held the level', 'bool'),
    F('per100Sec', 'Average pace per 100', 'time', { better: 'low' }),
    F('meanSec', 'Average rep', 'time', { better: 'low' }),
    F('fastestSec', 'Fastest rep', 'time', { better: 'low' }),
    F('slowestSec', 'Slowest rep', 'time', { better: 'low' }),
    F('first5MeanSec', 'First 5 average', 'time', { better: 'low' }),
    F('last5MeanSec', 'Last 5 average', 'time', { better: 'low' }),
    F('fadeSec', 'Fade, last 5 vs first 5', 'delta', { better: 'low' }),
    F('driftSecPerRep', 'Slowing per rep', 'delta', { better: 'low' }),
    F('meanRestSec', 'Average rest', 'sec', { better: 'high' }),
    F('minRestSec', 'Shortest rest', 'sec', { better: 'high' }),
    F('repsInsideSendOff', 'Reps inside the send-off', 'num'),
    F('first5Sc', 'Strokes, first 5', 'num', { unit: 'per length', better: 'low' }),
    F('last5Sc', 'Strokes, last 5', 'num', { unit: 'per length', better: 'low' }),
    F('scFade', 'Stroke count change', 'num', { better: 'low', signed: true }),
    F('meanHr', 'Average heart rate', 'num', { unit: 'bpm' }),
  ],
  series: [
    F('n', 'Reps timed', 'num'),
    F('meanSec', 'Average rep', 'time', { better: 'low' }),
    F('fastestSec', 'Fastest rep', 'time', { better: 'low' }),
    F('slowestSec', 'Slowest rep', 'time', { better: 'low' }),
    F('spreadSec', 'Spread, slowest − fastest', 'sec', { better: 'low' }),
    F('sdSec', 'Consistency (std dev)', 'sec', { better: 'low' }),
    F('driftSecPerRep', 'Slowing per rep', 'delta', { better: 'low' }),
    F('firstHalfMeanSec', 'First half average', 'time', { better: 'low' }),
    F('secondHalfMeanSec', 'Second half average', 'time', { better: 'low' }),
    F('meanHr', 'Average heart rate', 'num', { unit: 'bpm' }),
    F('meanRpe', 'Average RPE', 'num'),
    F('meanSc', 'Average stroke count', 'num', { better: 'low' }),
  ],
  step: [
    F('pace100At4mmolSec', 'Pace per 100 at 4 mmol', 'time', { better: 'low' }),
    F('speedAt4mmol', 'Speed at 4 mmol', 'num', { unit: 'm/s', better: 'high' }),
    F('hrPerSpeed', 'HR rise per m/s', 'num', { unit: 'bpm' }),
    F('peakHr', 'Peak heart rate', 'num', { unit: 'bpm' }),
    F('lastStepSec', 'Last step', 'time', { better: 'low' }),
  ],
  css: [
    F('cssPer100Sec', 'CSS pace per 100', 'time', { better: 'low' }),
    F('cssMs', 'CSS speed', 'num', { unit: 'm/s', better: 'high' }),
    F('t400Sec', '400 time', 'time', { better: 'low' }),
    F('t200Sec', '200 time', 'time', { better: 'low' }),
  ],
  'double-distance': [
    F('timeSec', 'Time', 'time', { better: 'low' }),
    F('targetSec', 'Target', 'time'),
    F('vsTargetSec', 'Against target', 'delta', { better: 'low' }),
    F('firstHalfSec', 'First half', 'time', { better: 'low' }),
    F('secondHalfSec', 'Second half', 'time', { better: 'low' }),
    F('fadeSec', 'Fade, second half vs first', 'delta', { better: 'low' }),
    F('hr', 'Heart rate', 'num', { unit: 'bpm' }),
  ],
  blocks: [
    F('dropOffSec', 'Drop-off, last block vs first', 'delta', { better: 'low' }),
    F('dropOffSc', 'Stroke count change', 'num', { better: 'low', signed: true }),
  ],
  swolf: [
    F('bestSwolf', 'Best SWOLF', 'num', { better: 'low' }),
    F('meanSwolf', 'Average SWOLF', 'num', { better: 'low' }),
    F('meanSc', 'Average stroke count', 'num', { better: 'low' }),
    F('meanSec', 'Average rep', 'time', { better: 'low' }),
  ],
  maxhr: [
    F('peakHr', 'Peak heart rate', 'num', { unit: 'bpm' }),
    F('peakRepNo', 'On rep', 'num'),
  ],
};

// Summary → [{ key, label, kind, unit, better, value }] in field order. Blocks
// tests also list each block's average.
export function summaryRows(pSummary, pAnalyser) {
  const s = pSummary || {};
  if (s.error) return [{ key: 'error', label: 'Result', kind: 'text', value: s.error }];
  const fields = SUMMARY_FIELDS[s.analyser || pAnalyser] || SUMMARY_FIELDS.series;
  const vals = { ...s };
  const out = fields.map((f) => ({ ...f, value: vals[f.key] ?? null })).filter((r) => r.value != null);
  if (Array.isArray(s.blocks)) {
    s.blocks.forEach((b, i) => out.push({ key: `block${i + 1}`, label: `Block ${i + 1} average (${b.n}×${b.distM} ${STROKE[b.stroke] || b.stroke})`, kind: 'time', better: 'low', value: b.meanSec }));
  }
  return out;
}

// ── One run, comprehensive ────────────────────────────────────────────────────
// pEffort: a set effort from getSetResultsByProtocol (set, conditions, summary,
// reps[]). Targets come from conditions.targets (frozen at save); send-offs from
// the params-applied set snapshot, so rest = send-off − time on fixed intervals.
export function buildRunView(pProtocol, pEffort) {
  const set = pEffort.set || {};
  const cond = pEffort.conditions || {};
  const params = cond.params || {};
  const plan = new Map(expandReps(set, pProtocol).map((p) => [p.repNo, p]));
  const targets = new Map((cond.targets || []).map((x) => [Number(x.repNo), x.targetTime]));
  const reps = (pEffort.reps || []).slice().sort((a, b) => a.repNo - b.repNo).map((r) => {
    const p = plan.get(Number(r.repNo));
    const m = r.metrics || {};
    const time = num(r.timeSec);
    const target = parseSetTime(r.targetTime ?? targets.get(Number(r.repNo)));
    const iv = p?.interval || null;
    const sendOff = iv && iv.type === 'fixed' ? parseSetTime(iv.onTime) : NaN;
    const distM = num(r.distM) ?? p?.distM ?? null;
    const lengths = lapSplits(r.splits, distM).map((l) => ({
      dist: l.dist, lapSec: l.lapSec, cumSec: l.cumSec,
      sc: num(l.extra.sc), sr: num(l.extra.sr), hrFirst: num(l.extra.hrFirst), hrLast: num(l.extra.hrLast),
    }));
    return {
      repNo: Number(r.repNo),
      swim: `${distM ?? '?'} ${STROKE[r.stroke || p?.stroke] || r.stroke || ''}`.trim(),
      distM, stroke: r.stroke || p?.stroke || null,
      block: p ? p.blockIdx + 1 : null,
      extra: !p,                                           // swum beyond the prescribed set
      intensity: p?.intensity || null,
      interval: iv ? (iv.type === 'fixed' ? `on ${iv.onTime}` : (num(iv.restSec) != null ? `${iv.restSec} s rest` : '')) : '',
      sendOffSec: Number.isFinite(sendOff) ? sendOff : null,
      targetSec: Number.isFinite(target) ? target : null,
      timeSec: time,
      vsTargetSec: time != null && Number.isFinite(target) ? r2(time - target) : null,
      restSec: time != null && Number.isFinite(sendOff) ? r2(sendOff - time) : null,
      pace100Sec: time != null && distM ? r2((time / distM) * 100) : null,
      pbAtSwimSec: num(r.pbAtSwim),
      sc: num(m.sc), sr: num(m.sr),
      hrStart: num(m.hrStart), hrMin: num(m.hrMin), hrAvg: num(m.hrAvg), hrPeak: num(m.hrPeak),
      hrEnd: num(m.hrEnd), hrRec30: num(m.hrRec30), hrCoverage: num(m.hrCoverage),
      hr: num(m.hr), lactate: num(m.lactate), rpe: num(m.rpe),
      note: r.note || '',
      lengths,
    };
  });

  // Use the stored summary only if THIS test's analyser wrote it; otherwise (none
  // saved, an error, or a run moved over from another test) recalculate from the reps.
  const stored = pEffort.summary;
  const summary = stored && !stored.error && Object.keys(stored).length > 2 && (!pProtocol?.analyser || stored.analyser === pProtocol.analyser)
    ? stored
    : analyse(pProtocol?.analyser, (pEffort.reps || []).map((r) => ({ ...r, ...(plan.get(Number(r.repNo)) ? { blockIdx: plan.get(Number(r.repNo)).blockIdx, lineIdx: plan.get(Number(r.repNo)).lineIdx, blockRepeat: plan.get(Number(r.repNo)).blockRepeat } : {}) })), { set, params });

  const paramText = Object.entries(params).map(([k, v]) => {
    const def = pProtocol?.params?.[k];
    return def?.kind === 'level' ? paramValueLabel(def, v) : `${def?.label || k}: ${paramValueLabel(def, v)}`;
  }).join(', ');

  const levelDef = Object.values(pProtocol?.params || {}).find((d) => d && d.kind === 'level');
  return {
    id: pEffort.id,
    swumOn: pEffort.swumOn,
    level: params.level || null,
    levelLabel: params.level ? (levelDef ? String(paramValueLabel(levelDef, params.level)).split(' — ')[0] : params.level) : null,
    paramText,
    poolType: cond.poolType || set.poolType || null,
    location: cond.location || '',
    sessionRpe: num(cond.rpe),
    prescribed: plan.size,
    planSwims: Object.fromEntries([...plan].map(([n, p]) => [n, `${p.distM} ${STROKE[p.stroke] || p.stroke}`])),
    swum: reps.filter((r) => r.timeSec != null).length,
    hasHrStream: !!(cond.hrStream && cond.hrStream.samples && cond.hrStream.samples.length),
    summary,
    summaryRows: summaryRows(summary, pProtocol?.analyser),
    reps,
    // which optional columns this run actually has, so empty ones are hidden
    has: ['sc', 'sr', 'hrStart', 'hrMin', 'hrAvg', 'hrPeak', 'hrEnd', 'hrRec30', 'hrCoverage', 'hr', 'lactate', 'rpe', 'targetSec', 'vsTargetSec', 'restSec', 'note']
      .filter((k) => reps.some((r) => r[k] != null && r[k] !== '')),
  };
}

// Short label for a run, unique within a list: "12 Sep 2026 · L2" (+ " #2" for
// a second run on the same day).
export function runLabels(pRuns) {
  const seen = {};
  return pRuns.map((r) => {
    const d = fmtDay(r.swumOn);
    const base = d + (r.level ? ` · ${r.levelLabel || r.level}` : '');
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] > 1 ? `${base} #${seen[base]}` : base;
  });
}

export function fmtDay(iso) {
  const t = Date.parse(iso);
  return isNaN(t) ? String(iso || '') : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ── Side by side ──────────────────────────────────────────────────────────────
// Runs oldest → newest as columns.
//   summary: [{ label, kind, unit, better, values[], best[], change }]  (change = newest − oldest)
//   reps:    [{ repNo, swim, times[], best[] }]  — fastest marked only when ≥ 2 runs have the rep
//   levelsDiffer: true when runs were at different levels (pace isn't like-for-like)
export function compareRuns(pRunViews) {
  const runs = pRunViews.slice().sort((a, b) => (a.swumOn < b.swumOn ? -1 : a.swumOn > b.swumOn ? 1 : 0));
  const order = [];
  const byKey = new Map();
  runs.forEach((rv, i) => {
    for (const row of rv.summaryRows) {
      if (!byKey.has(row.key)) { byKey.set(row.key, { ...row, values: runs.map(() => null) }); order.push(row.key); }
      byKey.get(row.key).values[i] = row.value;
    }
  });
  const summary = order.map((k) => {
    const row = byKey.get(k);
    const nums = row.values.map((v) => (typeof v === 'number' ? v : null));
    let best = [];
    const have = nums.filter((v) => v != null);
    if (row.better && have.length > 1) {
      const pick = row.better === 'low' ? Math.min(...have) : Math.max(...have);
      if (have.some((v) => v !== pick)) best = nums.map((v, i) => (v === pick ? i : -1)).filter((i) => i >= 0);   // all equal → nothing to mark
    }
    const first = nums.find((v) => v != null), last = [...nums].reverse().find((v) => v != null);
    const change = ['time', 'delta', 'sec', 'num'].includes(row.kind) && nums.filter((v) => v != null).length > 1 ? r2(last - first) : null;
    return { ...row, values: row.values, best, change };
  });

  // To the longest PRESCRIBED set, so a rep that wasn't timed still has a row.
  const maxRep = Math.max(0, ...runs.flatMap((rv) => [rv.prescribed || 0, ...rv.reps.map((r) => r.repNo)]));
  const reps = [];
  for (let n = 1; n <= maxRep; n++) {
    const cells = runs.map((rv) => rv.reps.find((r) => r.repNo === n) || null);
    const times = cells.map((c) => (c ? c.timeSec : null));
    const have = times.filter((t) => t != null);
    const best = have.length > 1 ? times.map((t, i) => (t === Math.min(...have) ? i : -1)).filter((i) => i >= 0) : [];
    const any = cells.find(Boolean);
    const planned = runs.map((rv) => rv.planSwims && rv.planSwims[n]).find(Boolean) || '';
    reps.push({ repNo: n, swim: any ? any.swim : planned, extra: !!any && cells.every((c) => !c || c.extra), times, best });
  }
  const levels = new Set(runs.map((r) => r.level).filter(Boolean));
  return { runs, labels: runLabels(runs), summary, reps, levelsDiffer: levels.size > 1 };
}

// ── CSV ───────────────────────────────────────────────────────────────────────
// Tidy: one row per rep per run, every field its own column, times in plain
// seconds (and a readable copy) so it drops straight into Excel, Sheets,
// Numbers, R or a pivot table. UTF-8 with BOM so Excel reads the dashes.
export const CSV_COLUMNS = [
  ['athlete', (m) => m.athleteName], ['test', (m) => m.testName], ['test_key', (m) => m.testKey], ['test_version', (m) => m.testVersion],
  ['run_date', (m, rv) => rv.swumOn], ['level', (m, rv) => rv.levelLabel || rv.level || ''], ['settings', (m, rv) => rv.paramText],
  ['pool', (m, rv) => rv.poolType || ''], ['location', (m, rv) => rv.location],
  ['rep', (m, rv, r) => r.repNo], ['block', (m, rv, r) => r.block ?? ''], ['extra_rep', (m, rv, r) => (r.extra ? 'yes' : '')],
  ['distance_m', (m, rv, r) => r.distM], ['stroke', (m, rv, r) => r.stroke || ''], ['interval', (m, rv, r) => r.interval],
  ['target_sec', (m, rv, r) => r.targetSec], ['time_sec', (m, rv, r) => r.timeSec], ['time', (m, rv, r) => fmtTime(r.timeSec)],
  ['vs_target_sec', (m, rv, r) => r.vsTargetSec], ['rest_after_sec', (m, rv, r) => r.restSec], ['pace_per_100_sec', (m, rv, r) => r.pace100Sec],
  ['stroke_count', (m, rv, r) => r.sc], ['stroke_rate', (m, rv, r) => r.sr],
  ['hr_start', (m, rv, r) => r.hrStart], ['hr_min', (m, rv, r) => r.hrMin], ['hr_avg', (m, rv, r) => r.hrAvg], ['hr_peak', (m, rv, r) => r.hrPeak],
  ['hr_end', (m, rv, r) => r.hrEnd], ['hr_plus_30s', (m, rv, r) => r.hrRec30], ['hr_coverage', (m, rv, r) => r.hrCoverage],
  ['hr_typed', (m, rv, r) => r.hr], ['lactate', (m, rv, r) => r.lactate], ['rpe', (m, rv, r) => r.rpe],
  ['splits', (m, rv, r) => r.lengths.map((l) => `${l.dist}m ${fmtTime(l.lapSec)}`).join(' | ')], ['note', (m, rv, r) => r.note],
];

export function toCsv(pMeta, pRunViews) {
  const q = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLUMNS.map(([h]) => h).join(',')];
  const runs = pRunViews.slice().sort((a, b) => (a.swumOn < b.swumOn ? -1 : 1));
  for (const rv of runs) for (const r of rv.reps) lines.push(CSV_COLUMNS.map(([, f]) => q(f(pMeta, rv, r))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// Swim time as swimmers write it: 31.20, 1:05.43.
export function fmtTime(pSec) {
  const v = num(pSec);
  if (v == null || v <= 0) return '';
  const h = Math.round(v * 100) / 100;
  if (h < 60) return h.toFixed(2);
  const m = Math.floor(h / 60);
  return m + ':' + (h - m * 60).toFixed(2).padStart(5, '0');
}
export const fmtDelta = (s) => (s == null ? '' : (s > 0 ? '+' : s < 0 ? '−' : '±') + Math.abs(s).toFixed(2));

// File name: 2026-10-07_Esme-Slinn_ladder-100s.xlsx
export function exportFileName(pMeta, pExt) {
  const slug = (s) => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  const today = new Date().toISOString().slice(0, 10);
  return `${today}_${slug(pMeta.athleteName) || 'athlete'}_${slug(pMeta.testKey) || 'test'}.${pExt}`;
}
