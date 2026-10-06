// protocolFormat.js — the Test Set Library, in code.
//
// A protocol is a named, versioned swimzone.set/1 plus what each rep measures,
// the per-run knobs a coach may set (params), and which analyser summarises a
// run. This module turns   protocol + chosen params + athlete   into a flat,
// per-rep PRESCRIPTION (what Poolside walks through), and turns the swum reps
// back into a SUMMARY (what the trend charts plot).
//
// RULES (see TEST-PROTOCOLS-CONTEXT.md):
//   1. Only import is the sibling ./setFormat.js — both files are copied into
//      public/poolside/ by scripts/copy-setformat.mjs, so the static Poolside
//      page imports this unchanged. Keep the '.js' extension on the import.
//   2. Pure functions, no I/O. Services fetch; this computes.
//   3. The stored set stays generic: params are group-level (same for the whole
//      lane) and per-athlete targets are only ever resolved into the
//      prescription / frozen onto reps, never written back into the set.
//   4. Summaries are derived and recomputable from the reps. Bump an analyser's
//      `v` when its output changes meaning.

import { SET_FMT, parseSetTime, fmtSetTime, resolveTarget, resolveRestSec, validateSetFormat } from './setFormat.js';

export const PROTOCOL_MEASURES = ['time', 'splits', 'sc', 'sr', 'hr', 'rpe', 'lactate'];
/** Measures stored in performance_results.metrics (time/splits have their own columns). */
export const METRIC_KEYS = ['sc', 'sr', 'hr', 'rpe', 'lactate'];
/**
 * Per-rep figures a live heart-rate sensor adds (derived from the stream — see
 * src/hr/hrMetrics.js HR_METRIC_KEYS; kept in step by hand to stay import-free).
 * `hr` stays the single "HR for this rep" figure: typed by the coach, else the
 * sensor's end-of-rep reading.
 */
export const HR_SENSOR_KEYS = ['hrStart', 'hrAvg', 'hrMin', 'hrPeak', 'hrEnd', 'hrRec10', 'hrRec30', 'hrRec60', 'hrDrop30', 'hrCoverage'];
const STORED_METRIC_KEYS = METRIC_KEYS.concat(HR_SENSOR_KEYS);
export const PARAM_KINDS = ['onTime', 'restSec', 'level'];
// A 'level' param picks one rung of a ladder, which sets BOTH how many reps a
// line has and its send-off (or rest), e.g.
//   { kind:'level', label:'Level', default:'L1', options:[
//       { value:'L1', label:'Level 1 — 20×100 on 1:30', qty:20, onTime:'1:30' }, … ] }
// Lines opt in exactly like the other params: interval.param = "level".
const KEY_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

const round = (n, dp = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null);
const nums = (xs) => xs.filter((x) => Number.isFinite(x));
const mean = (xs) => { const v = nums(xs); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const sd = (xs) => {
  const v = nums(xs); if (v.length < 2) return NaN;
  const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};
/** Least-squares slope of ys against xs (paired, finite only). */
function slope(xs, ys) {
  const pts = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pts.length < 2) return NaN;
  const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
  let num = 0, den = 0;
  for (const [x, y] of pts) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return den === 0 ? NaN : num / den;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Keep only known metric keys with finite numeric values. Strings like "42" are coerced. */
export function cleanMetrics(metrics) {
  const out = {};
  if (!metrics || typeof metrics !== 'object') return out;
  for (const k of STORED_METRIC_KEYS) {
    const v = metrics[k];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** What to record on this line: the line's own `measures`, else the protocol default. */
export function lineMeasures(protocol, line) {
  if (line && Array.isArray(line.measures)) return line.measures.slice();
  return protocol && Array.isArray(protocol.measures) ? protocol.measures.slice() : ['time'];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validParamValue(kind, v, def) {
  if (kind === 'onTime') return Number.isFinite(parseSetTime(v)) && parseSetTime(v) > 0;
  if (kind === 'restSec') return Number.isFinite(Number(v)) && Number(v) >= 0;
  if (kind === 'level') return !!(def && Array.isArray(def.options) && def.options.some((o) => o && o.value === v));
  return false;
}

/** The option object a level param's value refers to (or null). */
export function levelOption(def, value) {
  return (def && def.kind === 'level' && Array.isArray(def.options) && def.options.find((o) => o && o.value === value)) || null;
}

/** Human label for one param value: "1 min", "30 s", "1:30", "Level 2 — 25×100 on 1:25". */
export function paramValueLabel(def, v) {
  if (!def) return String(v);
  if (def.kind === 'level') { const o = levelOption(def, v); return o ? (o.label || o.value) : String(v); }
  if (def.kind === 'restSec') { const n = Number(v); return n >= 60 && n % 60 === 0 ? `${n / 60} min` : `${n} s`; }
  return String(v);
}

function validLevelOption(o) {
  if (!o || typeof o !== 'object' || !String(o.value || '').trim()) return 'every level needs a value';
  if (!(Number.isInteger(Number(o.qty)) && Number(o.qty) >= 1)) return `level "${o.value}": qty must be a whole number of reps`;
  const hasOn = o.onTime != null && o.onTime !== '';
  const hasRest = o.restSec != null && o.restSec !== '';
  if (!hasOn && !hasRest) return `level "${o.value}": needs an onTime or a restSec`;
  if (hasOn && !validParamValue('onTime', o.onTime)) return `level "${o.value}": onTime "${o.onTime}" is not a time`;
  if (hasRest && !validParamValue('restSec', o.restSec)) return `level "${o.value}": restSec must be 0 or more`;
  return null;
}

/** Structural check before save. Returns an error string, or null when well-formed. */
export function validateProtocol(p) {
  if (!p || typeof p !== 'object') return 'protocol is not an object';
  if (!KEY_RE.test(p.key || '')) return 'key must be lower-case letters, digits and dashes (e.g. "step-7x200")';
  if (!String(p.name || '').trim()) return 'name is required';
  if (p.version != null && !(Number.isInteger(Number(p.version)) && Number(p.version) >= 1)) return 'version must be 1 or more';
  if (!p.set || p.set.fmt !== SET_FMT) return `set must be a ${SET_FMT}`;
  const setErr = validateSetFormat(p.set);
  if (setErr) return `set: ${setErr}`;

  const measures = p.measures || ['time'];
  if (!Array.isArray(measures) || measures.some((m) => !PROTOCOL_MEASURES.includes(m)))
    return `measures must be from: ${PROTOCOL_MEASURES.join(', ')}`;

  const params = p.params || {};
  if (typeof params !== 'object' || Array.isArray(params)) return 'params must be an object';
  for (const [name, def] of Object.entries(params)) {
    if (!def || !PARAM_KINDS.includes(def.kind)) return `param "${name}": kind must be onTime, restSec or level`;
    if (def.kind === 'level') {
      if (!Array.isArray(def.options) || !def.options.length) return `param "${name}": a level param needs its levels as options`;
      for (const o of def.options) { const e = validLevelOption(o); if (e) return `param "${name}": ${e}`; }
      if (new Set(def.options.map((o) => o.value)).size !== def.options.length) return `param "${name}": level values must be unique`;
    }
    if (!validParamValue(def.kind, def.default, def)) return `param "${name}": default "${def.default}" is not a valid ${def.kind}`;
    if (def.kind !== 'level' && def.options && (!Array.isArray(def.options) || def.options.some((o) => !validParamValue(def.kind, o))))
      return `param "${name}": every option must be a valid ${def.kind}`;
  }

  if (p.analyser && !ANALYSERS[p.analyser]) return `unknown analyser "${p.analyser}"`;

  for (const [b, block] of p.set.blocks.entries()) {
    for (const [i, ln] of (block.lines || []).entries()) {
      const where = `block ${b} line ${i}`;
      if (ln.measures && (!Array.isArray(ln.measures) || ln.measures.some((m) => !PROTOCOL_MEASURES.includes(m))))
        return `${where}: measures must be from: ${PROTOCOL_MEASURES.join(', ')}`;
      const pn = ln.interval && ln.interval.param;
      if (pn) {
        if (!params[pn]) return `${where}: interval.param "${pn}" is not a protocol param`;
        const want = ln.interval.type === 'fixed' ? 'onTime' : 'restSec';
        if (params[pn].kind === 'level') {
          if (params[pn].options.some((o) => o[want] == null || o[want] === ''))
            return `${where}: every level of "${pn}" needs a ${want} for this line's interval`;
        } else if (params[pn].kind !== want) return `${where}: param "${pn}" is ${params[pn].kind} but the line's interval needs ${want}`;
      }
      if (ln.constraints && typeof ln.constraints !== 'object') return `${where}: constraints must be an object`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Params → a resolved (still generic) set
// ---------------------------------------------------------------------------

/**
 * Apply per-run params to a set. `chosen` is { name: value }; anything missing
 * or invalid falls back to the param's default. Returns { set, params } where
 * params is what was actually used (store it in conditions.params).
 */
export function resolveParams(set, paramDefs = {}, chosen = {}) {
  const used = {};
  for (const [name, def] of Object.entries(paramDefs || {})) {
    const c = chosen ? chosen[name] : undefined;
    used[name] = c !== undefined && validParamValue(def.kind, c, def)
      ? (def.kind === 'restSec' ? Number(c) : String(c))
      : (def.kind === 'restSec' ? Number(def.default) : String(def.default));
  }
  const out = JSON.parse(JSON.stringify(set));
  for (const block of out.blocks || []) {
    for (const ln of block.lines || []) {
      const pn = ln.interval && ln.interval.param;
      if (!pn || !(pn in used)) continue;
      const def = paramDefs[pn];
      if (def.kind === 'level') {
        const o = levelOption(def, used[pn]);
        ln.qty = Number(o.qty);
        if (o.onTime != null && o.onTime !== '') ln.interval.onTime = String(o.onTime);
        if (o.restSec != null && o.restSec !== '') ln.interval.restSec = Number(o.restSec);
      } else if (def.kind === 'onTime') ln.interval.onTime = used[pn];
      else ln.interval.restSec = used[pn];
    }
  }
  return { set: out, params: used };
}

// ---------------------------------------------------------------------------
// Expansion + prescription
// ---------------------------------------------------------------------------

/** Every rep in swim order: blocks × repeats × swim lines × qty. */
export function expandReps(set, protocol = null) {
  const reps = [];
  let repNo = 0;
  for (const [blockIdx, block] of (set.blocks || []).entries()) {
    const repeats = Math.max(1, Number(block.repeats) || 1);
    for (let r = 0; r < repeats; r++) {
      for (const [lineIdx, ln] of (block.lines || []).entries()) {
        if ((ln.type || 'swim') !== 'swim') continue;
        const qty = Math.max(1, Number(ln.qty) || 1);
        for (let q = 0; q < qty; q++) {
          repNo++;
          reps.push({
            repNo, blockIdx, blockRepeat: r + 1, lineIdx, repInLine: q + 1,
            stroke: ln.stroke, distM: Number(ln.distM),
            targetRule: ln.targetRule || null, interval: ln.interval || null,
            intensity: ln.intensity || null, note: ln.note || '',
            measures: lineMeasures(protocol, ln),
            constraints: ln.constraints || null,
          });
        }
      }
    }
  }
  return reps;
}

function athleteRepPlan(reps, athlete) {
  return reps.map((rep) => {
    const target = resolveTarget(rep.targetRule, athlete, rep.stroke, rep.distM);
    const mid = target.resolved ? (target.fromSec + target.toSec) / 2 : NaN;
    const pbMap = athlete && (athlete.pbByEvent || athlete.pbs);
    const pb = pbMap ? parseSetTime(pbMap[`${rep.stroke}${rep.distM}`]) : NaN;
    return {
      ...rep,
      target: { display: target.display, resolved: target.resolved,
                fromSec: round(target.fromSec), toSec: round(target.toSec) },
      targetTime: target.resolved ? fmtSetTime(mid) : null,     // frozen onto the swum rep
      restSec: round(resolveRestSec(rep.interval, mid)),
      pbAtSwim: Number.isFinite(pb) ? pb : null,
    };
  });
}

/**
 * protocol + chosen params + one athlete → the plan Poolside times against.
 * `athlete` needs { id, name, pbByEvent } (pbByEvent as getAthleteBests returns).
 */
export function prescribe(protocol, { chosen = {}, athlete = null } = {}) {
  return prescribeGroup(protocol, { chosen, athletes: athlete ? [athlete] : [] });
}

/**
 * Same test for a lane of swimmers: shared set + params, per-athlete targets.
 * Returns { fmt, protocolId, key, version, name, analyser, params, set, athletes:[{ athleteId, name, reps }] }.
 * With no athletes, `reps` (unresolved) is included so a plan can still be previewed.
 */
export function prescribeGroup(protocol, { chosen = {}, athletes = [] } = {}) {
  const { set, params } = resolveParams(protocol.set, protocol.params, chosen);
  const base = expandReps(set, protocol);
  return {
    fmt: 'swimzone.prescription/1',
    protocolId: protocol.id || null,
    key: protocol.key, version: protocol.version || 1, name: protocol.name,
    analyser: protocol.analyser || 'series',
    params, set,
    reps: athletes.length ? undefined : athleteRepPlan(base, null),
    athletes: athletes.map((a) => ({
      athleteId: a.id || a.athleteId || null, name: a.name || '',
      reps: athleteRepPlan(base, a),
    })),
  };
}

/** Which prescribed limits did a swum rep break? → [{ metric, limit, value }] (empty = none). */
export function checkConstraints(constraints, metrics) {
  const out = [];
  if (!constraints) return out;
  const m = cleanMetrics(metrics);
  const pairs = [['sc', 'scMin', 'scMax'], ['hr', 'hrMin', 'hrMax'], ['sr', 'srMin', 'srMax']];
  for (const [k, lo, hi] of pairs) {
    if (!(k in m)) continue;
    if (constraints[lo] != null && m[k] < Number(constraints[lo])) out.push({ metric: k, limit: lo, value: m[k] });
    if (constraints[hi] != null && m[k] > Number(constraints[hi])) out.push({ metric: k, limit: hi, value: m[k] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Analysers — swum reps → headline numbers
//
// Each takes (reps, ctx) where reps are swimzone.setresult/1 reps:
//   { repNo, distM, stroke, timeSec, metrics:{sc,sr,hr,rpe,lactate}, splits?,
//     targetTime?, lineIdx?, blockIdx? }
// and ctx = { set } (the snapshot). Returns a plain object of numbers/arrays.
// ---------------------------------------------------------------------------

const t = (r) => Number(r.timeSec);
const met = (r, k) => { const v = cleanMetrics(r.metrics)[k]; return v === undefined ? NaN : v; };
const timed = (reps) => reps.filter((r) => Number.isFinite(t(r)) && t(r) > 0);

function seriesStats(reps) {
  const ts = timed(reps).map(t);
  if (!ts.length) return { n: 0 };
  const half = Math.floor(ts.length / 2);
  return {
    n: ts.length,
    meanSec: round(mean(ts)),
    fastestSec: round(Math.min(...ts)),
    slowestSec: round(Math.max(...ts)),
    spreadSec: round(Math.max(...ts) - Math.min(...ts)),
    sdSec: round(sd(ts)),
    driftSecPerRep: round(slope(ts.map((_, i) => i + 1), ts)),   // + = slowing down
    firstHalfMeanSec: half ? round(mean(ts.slice(0, half))) : null,
    secondHalfMeanSec: half ? round(mean(ts.slice(ts.length - half))) : null,
  };
}

function meanMetric(reps, k) { return round(mean(reps.map((r) => met(r, k)))); }

/**
 * Cumulative seconds at `distM` from a rep's splits. Accepts either cumulative
 * splits ([{dist:100,sec:62},{dist:200,sec:126}…]) or lap splits
 * ([{dist:50,sec:31},{dist:50,sec:32}…]) — whichever shape the numbers fit.
 */
function splitAt(rep, distM) {
  const pts = (Array.isArray(rep.splits) ? rep.splits : [])
    .map((x) => ({ d: Number(x.dist ?? x.distM), sec: Number(x.sec ?? x.timeSec) }))
    .filter((x) => Number.isFinite(x.d) && Number.isFinite(x.sec));
  if (!pts.length) return NaN;
  const rising = (k) => pts.every((p, i) => i === 0 || p[k] > pts[i - 1][k]);
  const cumD = rising('d');
  const cumS = rising('sec') && Math.abs(pts[pts.length - 1].sec - t(rep)) < 0.5;
  let dAcc = 0, sAcc = 0;
  for (const p of pts) {
    dAcc = cumD ? p.d : dAcc + p.d;
    sAcc = cumS ? p.sec : sAcc + p.sec;
    if (dAcc === distM) return sAcc;
  }
  return NaN;
}

// Ladder "held the level": every prescribed rep swum, and every one finished at
// least this many seconds inside the send-off (time to turn round and go).
// A coaching judgement — change here if the coach wants a different margin.
export const LADDER_MIN_REST_SEC = 5;

export const ANALYSERS = {
  // A rep-count + send-off ladder (e.g. 20×100 @1:30 → 25 @1:25 → 30 @1:20).
  // Everything here is comparable ACROSS levels: per-100 pace, slowing per rep,
  // first-5 vs last-5 (a fixed window, not halves, so 20 and 30 reps compare),
  // stroke-count change and rest gained. Within a level everything compares.
  ladder: {
    v: 1,
    label: 'Ladder — level held, pace, fade',
    run(reps, ctx = {}) {
      const ts = timed(reps).slice().sort((a, b) => a.repNo - b.repNo);
      const set = ctx.set || null;
      const prescribed = set ? expandReps(set).length : null;
      const swimLine = set && (set.blocks || []).flatMap((b) => b.lines || []).find((l) => (l.type || 'swim') === 'swim');
      const iv = swimLine && swimLine.interval;
      const sendOff = iv && iv.type === 'fixed' ? parseSetTime(iv.onTime) : NaN;
      const times = ts.map(t);
      const w = Math.min(5, Math.floor(times.length / 2));
      const first = w ? times.slice(0, w) : [], last = w ? times.slice(-w) : [];
      const scs = ts.map((r) => met(r, 'sc'));
      const scFirst = w ? mean(scs.slice(0, w)) : NaN, scLast = w ? mean(scs.slice(-w)) : NaN;
      const s = seriesStats(ts);
      const minRest = Number.isFinite(sendOff) && times.length ? sendOff - Math.max(...times) : NaN;
      const completed = prescribed != null ? ts.length >= prescribed : null;
      return {
        level: (ctx.params && ctx.params.level) || null,
        prescribed, swum: ts.length, completed,
        held: completed === false ? false : (completed === true && Number.isFinite(minRest) ? minRest >= LADDER_MIN_REST_SEC : null),
        sendOffSec: round(sendOff),
        meanSec: s.meanSec ?? null, fastestSec: s.fastestSec ?? null, slowestSec: s.slowestSec ?? null,
        sdSec: s.sdSec ?? null, driftSecPerRep: s.driftSecPerRep ?? null,
        per100Sec: round(mean(ts.map((r) => (t(r) / Number(r.distM)) * 100))),
        first5MeanSec: round(mean(first)), last5MeanSec: round(mean(last)),
        fadeSec: round(mean(last) - mean(first)),                       // + = slower at the end
        meanRestSec: Number.isFinite(sendOff) && times.length ? round(sendOff - mean(times)) : null,
        minRestSec: round(minRest),
        repsInsideSendOff: Number.isFinite(sendOff) ? times.filter((x) => x < sendOff).length : null,
        first5Sc: round(scFirst, 1), last5Sc: round(scLast, 1), scFade: round(scLast - scFirst, 1),
        meanHr: meanMetric(ts, 'hr'),
      };
    },
  },

  // Any repeated series (10×400, and the fallback for anything else).
  series: {
    v: 1,
    label: 'Series — mean, spread, drift',
    run(reps) {
      return { ...seriesStats(reps), meanHr: meanMetric(reps, 'hr'), meanRpe: meanMetric(reps, 'rpe'),
               meanSc: meanMetric(reps, 'sc') };
    },
  },

  // 7×200 step test: speed vs HR / lactate per step.
  step: {
    v: 1,
    label: 'Step test — HR & lactate vs speed',
    run(reps) {
      const steps = timed(reps).map((r) => ({
        repNo: r.repNo, timeSec: round(t(r)), speed: round(Number(r.distM) / t(r), 3),
        hr: Number.isFinite(met(r, 'hr')) ? met(r, 'hr') : null,
        lactate: Number.isFinite(met(r, 'lactate')) ? met(r, 'lactate') : null,
        sr: Number.isFinite(met(r, 'sr')) ? met(r, 'sr') : null,
      }));
      // Speed at 4 mmol: linear interpolation between the readings that bracket it.
      let speedAt4 = null;
      const la = steps.filter((s) => s.lactate != null).sort((a, b) => a.speed - b.speed);
      for (let i = 1; i < la.length; i++) {
        const a = la[i - 1], b = la[i];
        if (a.lactate <= 4 && b.lactate >= 4 && b.lactate !== a.lactate) {
          speedAt4 = round(a.speed + (4 - a.lactate) * (b.speed - a.speed) / (b.lactate - a.lactate), 3);
          break;
        }
      }
      const hrs = nums(steps.map((s) => s.hr));
      return {
        steps,
        hrPerSpeed: round(slope(steps.map((s) => s.speed), steps.map((s) => s.hr)), 1),  // bpm per m/s
        speedAt4mmol: speedAt4,
        pace100At4mmolSec: speedAt4 ? round(100 / speedAt4) : null,
        peakHr: hrs.length ? Math.max(...hrs) : null,
        lastStepSec: steps.length ? steps[steps.length - 1].timeSec : null,
      };
    },
  },

  // CSS 400 + 200: CSS = 200 / (T400 − T200).
  css: {
    v: 1,
    label: 'Critical swim speed',
    run(reps) {
      const r400 = timed(reps).find((r) => Number(r.distM) === 400);
      const r200 = timed(reps).find((r) => Number(r.distM) === 200);
      if (!r400 || !r200) return { error: 'needs one 400 and one 200' };
      const diff = t(r400) - t(r200);
      if (!(diff > 0)) return { error: '400 must be slower than 200' };
      const css = 200 / diff;
      return { t400Sec: round(t(r400)), t200Sec: round(t(r200)),
               cssMs: round(css, 3), cssPer100Sec: round(100 / css) };
    },
  },

  // Double-distance 400: vs its target, and the fade between halves.
  'double-distance': {
    v: 1,
    label: 'Double distance — vs target, fade',
    run(reps) {
      const r = timed(reps).find((x) => Number(x.distM) === 400) || timed(reps)[0];
      if (!r) return { error: 'no timed swim' };
      const target = parseSetTime(r.targetTime);
      const at200 = splitAt(r, 200);
      const first = Number.isFinite(at200) ? at200 : NaN;
      const second = Number.isFinite(at200) ? t(r) - at200 : NaN;
      return {
        timeSec: round(t(r)),
        targetSec: round(target),
        vsTargetSec: round(t(r) - target),            // + = slower than target
        firstHalfSec: round(first), secondHalfSec: round(second),
        fadeSec: round(second - first),               // + = slowed in the second half
        hr: Number.isFinite(met(r, 'hr')) ? met(r, 'hr') : null,
      };
    },
  },

  // Blocks (e.g. 10 AT · 200 recovery · 10 AT): per-line stats and set-1 vs set-2.
  blocks: {
    v: 1,
    label: 'Blocks — per block and drop-off',
    run(reps, ctx = {}) {
      const groups = new Map();
      for (const r of reps) {
        const k = `${r.blockIdx ?? 0}:${r.lineIdx ?? 0}:${r.blockRepeat ?? 1}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      }
      const out = [];
      for (const [k, rs] of groups) {
        const [blockIdx, lineIdx] = k.split(':').map(Number);
        const line = ctx.set?.blocks?.[blockIdx]?.lines?.[lineIdx];
        const ms = line && Array.isArray(line.measures) ? line.measures : null;
        if (ms && !ms.includes('time')) continue;                       // e.g. the recovery 200
        const s = seriesStats(rs);
        if (!s.n) continue;
        out.push({ blockIdx, lineIdx, stroke: rs[0].stroke, distM: Number(rs[0].distM), note: line?.note || '',
                   n: s.n, meanSec: s.meanSec, fastestSec: s.fastestSec, slowestSec: s.slowestSec,
                   meanSc: meanMetric(rs, 'sc') });
      }
      const comparable = out.filter((g) => out[0] && g.distM === out[0].distM && g.stroke === out[0].stroke);
      const first = comparable[0], last = comparable[comparable.length - 1];
      return {
        blocks: out,
        dropOffSec: comparable.length > 1 ? round(last.meanSec - first.meanSec) : null,   // + = slower in the last block
        dropOffSc: comparable.length > 1 && first.meanSc != null && last.meanSc != null ? round(last.meanSc - first.meanSc) : null,
      };
    },
  },

  // 8×50 efficiency: SWOLF = time + strokes, per rep.
  swolf: {
    v: 1,
    label: 'Efficiency — SWOLF',
    run(reps) {
      const per = timed(reps).map((r) => {
        const sc = met(r, 'sc');
        return { repNo: r.repNo, timeSec: round(t(r)), sc: Number.isFinite(sc) ? sc : null,
                 swolf: Number.isFinite(sc) ? round(t(r) + sc, 1) : null };
      });
      const sw = nums(per.map((p) => p.swolf));
      return { reps: per, bestSwolf: sw.length ? Math.min(...sw) : null, meanSwolf: round(mean(sw), 1),
               meanSc: meanMetric(reps, 'sc'), meanSec: round(mean(per.map((p) => p.timeSec))) };
    },
  },

  // Max HR: the peak reading.
  maxhr: {
    v: 2,   // v2: also reads the sensor's in-rep peak (hrPeak), not just the end-of-rep hr
    label: 'Max heart rate',
    run(reps) {
      let peak = null, at = null;
      for (const r of reps) {
        const a = met(r, 'hr'), b = met(r, 'hrPeak');
        const hr = Number.isFinite(b) && !(b < a) ? b : a;
        if (Number.isFinite(hr) && (peak == null || hr > peak)) { peak = hr; at = r.repNo; }
      }
      return { peakHr: peak, peakRepNo: at };
    },
  },
};

/** Run the protocol's analyser over swum reps → { analyser, v, ...numbers }. Never throws. */
export function analyse(analyserId, reps, ctx = {}) {
  const id = ANALYSERS[analyserId] ? analyserId : 'series';
  try {
    return { analyser: id, v: ANALYSERS[id].v, ...ANALYSERS[id].run(reps || [], ctx) };
  } catch (e) {
    return { analyser: id, v: ANALYSERS[id].v, error: String(e && e.message || e) };
  }
}

// ---------------------------------------------------------------------------
// Poolside hand-off — a prescription for ONE swimmer, carried in the Poolside
// link's #hash so it works offline with no server round-trip.
//
//   buildHandoff(prescription, athleteId) → the slim object Poolside needs
//   encodeHandoff(obj) → "z.<base64url of deflate-raw JSON>"  (or "j.<base64url JSON>"
//                         where CompressionStream is missing)
//   decodeHandoff(str) → obj            (Poolside carries its own copy of this)
// ---------------------------------------------------------------------------

export const HANDOFF_FMT = 'swimzone.testrun/1';

/** Slim a prescription to what Poolside times against, for one swimmer. */
export function buildHandoff(prescription, athleteId, { sessionId, location } = {}) {
  const who = (prescription.athletes || []).find((a) => a.athleteId === athleteId) || (prescription.athletes || [])[0] || null;
  const reps = (who ? who.reps : prescription.reps || []).map((r) => ({
    repNo: r.repNo, blockIdx: r.blockIdx, blockRepeat: r.blockRepeat, lineIdx: r.lineIdx,
    stroke: r.stroke, distM: r.distM, intensity: r.intensity || null, note: r.note || '',
    interval: r.interval || null, targetTime: r.targetTime || null,
    targetLabel: r.targetTime || (r.target && r.target.display) || '',
    restSec: Number.isFinite(r.restSec) ? r.restSec : null, pbAtSwim: r.pbAtSwim ?? null,
    measures: r.measures || ['time'], constraints: r.constraints || null,
  }));
  return {
    fmt: HANDOFF_FMT,
    sessionId: sessionId || newSessionId(),
    protocol: { id: prescription.protocolId, key: prescription.key, version: prescription.version,
                name: prescription.name, analyser: prescription.analyser },
    athlete: who ? { id: who.athleteId, name: who.name } : null,
    params: prescription.params || {},
    set: prescription.set,
    location: location || '',
    reps,
  };
}

function newSessionId() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function b64urlFromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bytesFromB64url(str) {
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
async function pipeBytes(bytes, stream) {
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(buf);
}

export async function encodeHandoff(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream !== 'undefined') {
    try { return 'z.' + b64urlFromBytes(await pipeBytes(raw, new CompressionStream('deflate-raw'))); } catch (e) { /* fall back */ }
  }
  return 'j.' + b64urlFromBytes(raw);
}

export async function decodeHandoff(str) {
  const [kind, body] = [String(str).slice(0, 2), String(str).slice(2)];
  let bytes = bytesFromB64url(body);
  if (kind === 'z.') bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'j.') throw new Error('not a SwimZone hand-off');
  return JSON.parse(new TextDecoder().decode(bytes));
}
