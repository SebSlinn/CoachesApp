// src/zones/types.js
// THE training-type table (contracts/ZONES.md). One entry per code.
//
// PURE — imports only ./writeups.js. Copied to public/poolside/ by scripts/copy-setformat.mjs.
//
// Layers:
//   ZONE GROUP (1–5)  → colour unit, energy system, PHV notes   (GROUPS below; adaptations live in constants.js)
//   TRAINING TYPE     → criteria, HR band, write-up             (TYPES below)
//   SCHEME            → label + colour per type at display time  (schemes.js)
//
// Rules:
//   - Codes are permanent. Never rename or reuse one; synonyms are scheme labels.
//     HVO = ATP-PC = alactic = sprint → code stays 'HVO'.
//   - Stored data (lines, sets, protocols, results, exports) holds the code only.
//   - Adding a training method = adding one entry here. No screen edits.
//
// Fields:
//   code        permanent id
//   group       zone group 1–5
//   rank        intensity rank for ordering / drill ceilings (types may share a rank)
//   label       default long label (Sweetenham)        short  default short label
//   name        "CODE / Long name" (legacy ZONES[].name, used by the Classifier screen)
//   desc        one-line description                   rpe    RPE text
//   energyModel true = has its own slice in classifySet()'s energy breakdown
//   speedRatio  typical rep-pace / 200PB-pace ratio (drill time suggestions). Lower = faster.
//   hrBand      { fromBbm, toBbm } beats below athlete max HR; fromBbm ≤ toBbm; null bound = open.
//               null = no HR target (HVO/PL: too short for HR to mean anything).
//   criteria    zoneCriteria.js condition object (see the condition list there), or null = no opinion
//   provisional true = criteria/numbers not yet confirmed by the coach
//   benched     true = code reserved but not in use: hidden from pickers, groups and criteria.
//               TYPES[code] still resolves, so any stored line with that code still displays.
//   writeup     long-form text (from writeups.js), with .hr derived from hrBand

import { WRITEUPS } from './writeups.js';

// ── Zone groups ──────────────────────────────────────────────────────────────
// Colour here is only the last-resort fallback. Schemes own display colour.
const GROUPS = [
  { zone: 1, label: 'Zone 1 — Aerobic',   short: 'Aerobic',   color: '#30B0C7' },
  { zone: 2, label: 'Zone 2 — Threshold', short: 'Threshold', color: '#FFCC00' },
  { zone: 3, label: 'Zone 3 — HPE',       short: 'HPE',       color: '#FF9500' },
  { zone: 4, label: 'Zone 4 — Lactate',   short: 'Lactate',   color: '#FF5500' },
  { zone: 5, label: 'Zone 5 — Speed',     short: 'Speed',     color: '#FF2D55' },
];

// Shared rest profile for AT and A3 (Sweetenham).
const AT_REST = { default: [10, 20], byDist: [[50, [5, 15]], [400, [10, 20]]] };

const TYPE_LIST = [
  {
    code: 'A1', group: 1, rank: 1, label: 'Easy aerobic', short: 'A1',
    name: 'A1 / Easy Aerobic', rpe: '7-10', energyModel: true, speedRatio: 1.52,
    desc: 'Recovery and technique. Aerobic base. Suitable all ages.',
    hrBand: { fromBbm: 50, toBbm: null },
    criteria: { speed: [1.38, null] },
  },
  {
    code: 'A2', group: 1, rank: 2, label: 'Aerobic maintenance', short: 'A2',
    name: 'A2 / Moderate Aerobic', rpe: '11-13', energyModel: true, speedRatio: 1.30,
    desc: 'Moderate aerobic. Cardiovascular development. Drill-compatible.',
    hrBand: { fromBbm: 40, toBbm: 50 },
    criteria: { speed: [1.22, 1.38] },
  },
  {
    code: 'A3', group: 1, rank: 3, label: 'Hard aerobic', short: 'A3',
    name: 'A3 / Hard Aerobic', rpe: '14-15', energyModel: true, speedRatio: 1.16,
    desc: 'Upper aerobic. Challenging but aerobically sustainable. Good for fitness base.',
    hrBand: { fromBbm: 30, toBbm: 40 },
    // Overlaps AT at the fast end (both share the +10 s boundary) — intentional.
    criteria: { atPace: { offsetLow: 10, offsetHigh: 15 }, speed: [1.10, 1.22], restSecByDist: AT_REST },
  },
  {
    code: 'AT', group: 2, rank: 4, label: 'Anaerobic threshold', short: 'AT',
    name: 'AT / Anaerobic Threshold', rpe: '15-17', energyModel: true, speedRatio: 1.06,
    desc: 'Lactate/aerobic crossover. Key race-pace zone. Lactate produced ≈ lactate cleared.',
    hrBand: { fromBbm: 20, toBbm: 30 },
    // Pace ½×200PB + 7–10 s/100; ratio band fallback without an athlete.
    criteria: {
      atPace: { offsetLow: 7, offsetHigh: 10 }, speed: [1.025, 1.10], restSecByDist: AT_REST,
      volumeByAthleteType: { sprint: [1500, 3000], allround: [3000, 4500], endurance: [4500, null] },
    },
  },
  {
    code: 'CS', group: 3, rank: 5, label: 'Critical speed', short: 'CS',
    name: 'CS / Critical Speed', rpe: '16-18', energyModel: false, speedRatio: 1.06,
    desc: 'Sustained repeats at critical swim speed. 22–38 min of work at ~1.2–2.5:1 work:rest.',
    hrBand: { fromBbm: 5, toBbm: 20 },
    // CSS ±5% (ratio fallback), rest:work 0.4–0.83, 22–38 min. An overlay in classifySet()
    // (csDetection) — it coexists with an AT/A3 energy result.
    criteria: { cssPace: 0.05, speed: [0.95, 1.05], restWork: [0.4, 0.83], volume: [22 * 60, 38 * 60] },
  },
  {
    code: 'MVO', group: 3, rank: 5, label: 'MVO₂ / aerobic overload', short: 'MVO₂',
    name: 'MVO / MVO₂ Overload', rpe: '17-19', energyModel: false, speedRatio: 1.03,
    desc: 'Repeats at VO₂max speed with short rest so HR stays high. The hard end of Zone 3.',
    hrBand: { fromBbm: 10, toBbm: 20 },
    // ~200–400 race pace, work:rest ~1:0.5–1:1, 1–6 min reps, 12–30 min of work.
    criteria: { speed: [1.0, 1.06], restWork: [0.5, 1.0], workDur: [60, 360], volume: [12 * 60, 30 * 60] },
    provisional: true,
  },
  {
    // Sweetenham's own training method; he places it in Zone 3 with CS and MVO.
    // BENCHED (2026-10-14): the code is reserved, but LR is hidden from pickers, zone
    // groups and the criteria table until Al has worked out what it is.
    benched: true,
    code: 'LR', group: 3, rank: 5, label: 'Lactate removal', short: 'LR',
    name: 'LR / Lactate Removal', rpe: '', energyModel: false, speedRatio: 1.06,
    desc: 'Sweetenham lactate-removal sets (Zone 3). Criteria to be confirmed.',
    hrBand: null,
    criteria: {},
    provisional: true,
  },
  // Order: LP below LT (Sweetenham & Atkinson — LP early season and less intense, LT more
  // intense). The British Swimming / Swim England chart lists them the other way round;
  // Al chose this order on 2026-10-14. PL sits above LT.
  {
    // LP RULES UNDER REVIEW (Al, 2026-10-14) — do not change until he has finished reading.
    // The 1.0–1.2 rest:work rule came from an earlier chat with no source. Sweetenham and
    // Bowman use LONG rest (e.g. 50s on 2:30–3:00; Bowman: lactate peaks ~4:00 after) over
    // 50–100m reps. Al prefers whole-number ratios (or send-offs) when it is redone.
    code: 'LP', group: 4, rank: 6, label: 'Lactate production', short: 'LP',
    name: 'LP / Lactate Production', rpe: '17-19', energyModel: true, speedRatio: 1.00,
    desc: 'Improves the rate of anaerobic glycolysis. Hard efforts building lactate. Early season focus.',
    hrBand: { fromBbm: 0, toBbm: 10 },
    criteria: { speed: [0.97, 1.025], restWork: [1.0, 1.2], distMax: 100 },
  },
  {
    code: 'LT', group: 4, rank: 7, label: 'Lactate tolerance', short: 'LT',
    name: 'LT / Lactate Tolerance', rpe: '18-20', energyModel: true, speedRatio: 0.96,
    desc: 'High-speed glycolytic work with significant lactate accumulation. Post-PHV athletes.',
    hrBand: { fromBbm: 0, toBbm: 10 },
    criteria: { speed: [0.85, 0.97] },
  },
  {
    code: 'PL', group: 4, rank: 8, label: 'Peak lactate', short: 'PL',
    name: 'PL / Peak Lactate', rpe: '20', energyModel: false, speedRatio: 0.92,
    desc: 'Near-maximal 50–100m efforts with long recovery to drive lactate to its peak. Use sparingly.',
    hrBand: null,
    // Above LT: all-out, 50–100m reps, very long rest (≥5× work).
    criteria: { speed: [null, 0.95], restWork: [5, null], distMin: 50, distMax: 100 },
    provisional: true,
  },
  {
    code: 'HVO', group: 5, rank: 9, label: 'Sprint / ATP-PC', short: 'HVO',
    name: 'HVO / ATP-CP', rpe: 'Max', energyModel: true, speedRatio: 0.88,
    desc: 'Alactic sprints. Pure phosphocreatine — exhausted in 10-15s. Needs 6:1+ rest to replenish.',
    hrBand: null,
    criteria: { speed: [null, 0.85], restWork: [5, null], workDur: [null, 15] },
  },
];

// ── Derived helpers ──────────────────────────────────────────────────────────

/** "50+ bbm", "40–50 bbm", "N/A". */
function formatHrBand(pBand) {
  if (!pBand) return 'N/A';
  const { fromBbm: mFrom, toBbm: mTo } = pBand;
  if (mTo === null || mTo === undefined) return `>${mFrom} bbm`;
  return `${mFrom}–${mTo} bbm`;
}

/**
 * Target heart rate (bpm) for a type, given an athlete's max HR.
 * @returns {{lo:number|null, hi:number|null}|null}  null when no band or no max HR.
 *   lo/hi are bpm; an open band gives lo:null (e.g. A1 = "below max−50").
 */
function hrTargetRange(pCode, pMaxHr) {
  const mType = TYPES[pCode];
  const mMax  = Number(pMaxHr);
  if (!mType?.hrBand || !mMax) return null;
  const { fromBbm: mFrom, toBbm: mTo } = mType.hrBand;
  return {
    lo: mTo === null || mTo === undefined ? null : mMax - mTo,
    hi: mMax - mFrom,
  };
}

const TYPES = Object.freeze(Object.fromEntries(TYPE_LIST.map(t => [t.code, Object.freeze({
  ...t,
  provisional: !!t.provisional,
  writeup: WRITEUPS[t.code] ? { ...WRITEUPS[t.code], hr: formatHrBand(t.hrBand) } : null,
})])));

/** Every code including benched ones (reserved), ordered low → high intensity. */
const ALL_TYPE_CODES = TYPE_LIST.map(t => t.code);

/** Codes in use (benched ones left out), ordered low → high intensity. */
const ACTIVE_LIST = TYPE_LIST.filter(t => !t.benched);
const TYPE_CODES = ACTIVE_LIST.map(t => t.code);

/** Codes a coach can pick for a set line (the order is the UI order). */
const PRESCRIBABLE_CODES = TYPE_CODES;

/** Codes with their own slice in classifySet()'s energy breakdown (the original seven). */
const ENERGY_MODEL_CODES = TYPE_LIST.filter(t => t.energyModel).map(t => t.code);

const GROUPS_BY_ZONE = Object.freeze(Object.fromEntries(GROUPS.map(g => [g.zone, g])));

/** Codes in a zone group, ordered low → high. */
function typesInGroup(pZone) {
  return ACTIVE_LIST.filter(t => t.group === Number(pZone)).map(t => t.code);
}

function isTypeCode(pCode) { return Object.prototype.hasOwnProperty.call(TYPES, pCode); }

/** Criteria table { code: criteria } for zoneCriteria.js (types with criteria only). */
function criteriaTable() {
  return Object.fromEntries(ACTIVE_LIST.filter(t => t.criteria).map(t => [
    t.code, t.hrBand ? { ...t.criteria, hrBand: t.hrBand } : t.criteria,
  ]));
}

export {
  GROUPS, GROUPS_BY_ZONE, TYPES, TYPE_CODES, ALL_TYPE_CODES, PRESCRIBABLE_CODES, ENERGY_MODEL_CODES,
  typesInGroup, isTypeCode, criteriaTable, formatHrBand, hrTargetRange,
};
