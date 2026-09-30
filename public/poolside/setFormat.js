// setFormat.js — the shared "swimzone.set/1" set format.
//
// One copy defines the set contract for THREE readers:
//   • Set Builder (src/)      — writes sets, resolves rules → numbers for display
//   • Poolside App (static)   — reads a set, resolves against the picked athlete
//   • Athlete Records         — stores a generic snapshot inside a set-result
//
// RULES (see SET-FORMAT-CONTEXT.md):
//   1. Zero imports. Pure JS. Must run in the bundled app AND the static
//      public/poolside page unchanged. Do not add imports.
//   2. A saved set never bakes in a PER-ATHLETE target. `absolute` is a literal
//      time for everyone; PB±/zone/bestAverage are rules resolved at read time.
//   3. New target/interval kinds are new `base`/`type` values, never overloads.
//   4. Bump SET_FMT ("swimzone.set/1" → "/2") only on a breaking change.

export const SET_FMT = 'swimzone.set/1';

// ---------------------------------------------------------------------------
// Time helpers (local copies — kept zero-import on purpose; mirror
// zones/helpers.js parseTime/fmtTime so behaviour matches the rest of the app).
// ---------------------------------------------------------------------------

/** "1:26.5" | "86.5" | 86.5 → seconds (number), or NaN. */
export function parseSetTime(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s === '') return NaN;
  if (s.includes(':')) {
    const parts = s.split(':');
    if (parts.length !== 2) return NaN;
    const mm = Number(parts[0]);
    const ss = Number(parts[1]);
    if (!Number.isFinite(mm) || !Number.isFinite(ss)) return NaN;
    return mm * 60 + ss;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** seconds → "m:ss.d" (drops trailing .0). */
export function fmtSetTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const ss = s.toFixed(1).padStart(4, '0'); // "04.0"
  const out = `${m}:${ss}`;
  return out.endsWith('.0') ? out.slice(0, -2) : out;
}

// ---------------------------------------------------------------------------
// Defaults — the zero case reproduces today's behaviour (typed IN + fixed ON).
// ---------------------------------------------------------------------------

export function defaultTargetRule() {
  return { base: 'absolute', inTime: '' };
}

export function defaultInterval() {
  return { type: 'fixed', onTime: '' };
}

// ---------------------------------------------------------------------------
// Legacy shim — upgrade a line/set that still carries bare targetTime/onTime
// strings (the pre-swimzone.set/1 shape) to targetRule/interval. Idempotent:
// a line already in the new shape is returned untouched. Nothing already saved
// breaks on read.
// ---------------------------------------------------------------------------

export function upgradeLine(line) {
  if (!line || typeof line !== 'object') return line;
  const out = { ...line };

  if (!out.targetRule) {
    // legacy `targetTime` (absolute) → absolute rule; missing → empty absolute
    out.targetRule = out.targetTime
      ? { base: 'absolute', inTime: String(out.targetTime) }
      : defaultTargetRule();
  }
  if (!out.interval) {
    out.interval = { type: 'fixed', onTime: out.onTime ? String(out.onTime) : '' };
  }
  // Drop the dead absolutes so the two shapes never disagree. (targetTime/onTime
  // are dead aliases once targetRule/interval exist — see CLAUDE-CONTEXT.md.)
  delete out.targetTime;
  delete out.onTime;
  return out;
}

/** Upgrade every line in a set (or a session's blocks). Safe on new-shape sets. */
export function upgradeSet(set) {
  if (!set || typeof set !== 'object') return set;
  const out = { ...set, fmt: set.fmt || SET_FMT };
  if (Array.isArray(out.blocks)) {
    out.blocks = out.blocks.map((b) => ({
      ...b,
      lines: Array.isArray(b.lines) ? b.lines.map(upgradeLine) : b.lines,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resolution — turn a rule into a concrete IN band for ONE athlete, at read
// time. The stored set is never mutated. `athlete` is the app's athlete object;
// only the fields named below are read, so any shape carrying them works.
//
//   athlete.pbByEvent[`${stroke}${distM}`] → PB seconds for the rep distance
//   athlete.css  (or athlete.cssValue)     → CSS seconds per 100 (for zones)
//
// Returns { fromSec, toSec, display, resolved:boolean, reason? }.
//   • absolute      → exact time (from==to)
//   • PB band       → PB+plusFrom … PB+plusTo (per rep distance)
//   • zone          → left to the Classifier (this returns resolved:false with
//                     the zone label, so callers show the label, not a number)
//   • bestAverage   → no prescribed pace (resolved:false, display 'best avg')
// ---------------------------------------------------------------------------

function pbFor(athlete, stroke, distM) {
  if (!athlete) return NaN;
  const key = `${stroke}${distM}`;
  const map = athlete.pbByEvent || athlete.pbs || null;
  if (map && map[key] != null) return parseSetTime(map[key]);
  return NaN;
}

export function resolveTarget(targetRule, athlete, stroke, distM) {
  const rule = targetRule || defaultTargetRule();

  if (rule.base === 'absolute') {
    const sec = parseSetTime(rule.inTime);
    if (!Number.isFinite(sec)) {
      return { resolved: false, fromSec: NaN, toSec: NaN, display: rule.inTime || '—' };
    }
    return { resolved: true, fromSec: sec, toSec: sec, display: fmtSetTime(sec) };
  }

  if (rule.base === 'PB') {
    const pb = pbFor(athlete, stroke, distM);
    const from = Number(rule.plusFrom) || 0;
    const to = Number(rule.plusTo) || 0;
    if (!Number.isFinite(pb)) {
      // No athlete / no PB → show the rule itself, unresolved.
      const band = from === to ? `PB+${from}` : `PB+(${from}–${to})`;
      return { resolved: false, fromSec: NaN, toSec: NaN, display: band,
               reason: 'no PB for this event' };
    }
    const lo = pb + Math.min(from, to);
    const hi = pb + Math.max(from, to);
    return {
      resolved: true, fromSec: lo, toSec: hi,
      display: lo === hi ? fmtSetTime(lo) : `${fmtSetTime(lo)}–${fmtSetTime(hi)}`,
    };
  }

  if (rule.base === 'bestAverage') {
    // No prescribed pace — the point is the spread, judged after the swim.
    return { resolved: false, fromSec: NaN, toSec: NaN, display: 'best avg' };
  }

  // Zone bases (A1..HVO, AT, CS, …): pace comes from the Classifier/CSS, not here.
  return { resolved: false, fromSec: NaN, toSec: NaN, display: rule.base };
}

/**
 * restSec for a line, matching the Classifier's model:
 *   • interval 'rest'  → taken directly (interval.restSec)
 *   • interval 'fixed' → max(0, onTime − resolvedTargetSec); needs a resolved
 *                        target, else NaN (unknowable without the athlete).
 */
export function resolveRestSec(interval, resolvedTargetSec) {
  const iv = interval || defaultInterval();
  if (iv.type === 'rest') {
    const r = Number(iv.restSec);
    return Number.isFinite(r) ? r : NaN;
  }
  // fixed
  const on = parseSetTime(iv.onTime);
  if (!Number.isFinite(on) || !Number.isFinite(resolvedTargetSec)) return NaN;
  return Math.max(0, on - resolvedTargetSec);
}

// ---------------------------------------------------------------------------
// Validation — cheap structural check before save/import. Returns an error
// string, or null when the set is well-formed. Not a schema validator; catches
// the mistakes that would break a reader.
// ---------------------------------------------------------------------------

const STROKES = ['FS', 'BK', 'BR', 'Fly', 'IM', 'Kick'];
const LINE_TYPES = ['swim', 'rest', 'note'];
const TARGET_BASES = ['absolute', 'PB', 'bestAverage',
  'A1', 'A2', 'A3', 'AT', 'LT', 'LP', 'HVO', 'CS'];
const INTERVAL_TYPES = ['fixed', 'rest'];

export function validateSetFormat(set) {
  if (!set || typeof set !== 'object') return 'set is not an object';
  if (set.fmt && set.fmt !== SET_FMT) return `unsupported fmt "${set.fmt}"`;
  if (!Array.isArray(set.blocks)) return 'set.blocks must be an array';

  for (let b = 0; b < set.blocks.length; b++) {
    const block = set.blocks[b];
    if (!block || !Array.isArray(block.lines)) return `block ${b}: lines must be an array`;
    for (let i = 0; i < block.lines.length; i++) {
      const ln = block.lines[i];
      const where = `block ${b} line ${i}`;
      if (!ln || typeof ln !== 'object') return `${where}: not an object`;
      if (ln.type && !LINE_TYPES.includes(ln.type)) return `${where}: bad type "${ln.type}"`;
      if ((ln.type || 'swim') !== 'swim') continue; // rest/note lines need nothing more

      if (ln.stroke && !STROKES.includes(ln.stroke)) return `${where}: bad stroke "${ln.stroke}"`;

      const tr = ln.targetRule;
      if (tr) {
        if (!TARGET_BASES.includes(tr.base)) return `${where}: bad targetRule.base "${tr.base}"`;
        if (tr.base === 'absolute' && tr.inTime && !Number.isFinite(parseSetTime(tr.inTime)))
          return `${where}: absolute inTime "${tr.inTime}" is not a time`;
        if (tr.base === 'PB') {
          if (tr.plusFrom != null && !Number.isFinite(Number(tr.plusFrom)))
            return `${where}: PB plusFrom must be a number`;
          if (tr.plusTo != null && !Number.isFinite(Number(tr.plusTo)))
            return `${where}: PB plusTo must be a number`;
        }
      }

      const iv = ln.interval;
      if (iv) {
        if (!INTERVAL_TYPES.includes(iv.type)) return `${where}: bad interval.type "${iv.type}"`;
        if (iv.type === 'fixed' && iv.onTime && !Number.isFinite(parseSetTime(iv.onTime)))
          return `${where}: fixed onTime "${iv.onTime}" is not a time`;
        if (iv.type === 'rest' && iv.restSec != null && !Number.isFinite(Number(iv.restSec)))
          return `${where}: rest restSec must be a number`;
      }
    }
  }
  return null;
}
