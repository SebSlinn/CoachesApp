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
    // Al, 2026-10-22 (Sweetenham & Atkinson ch. 13 race-pace LP sets + his own numbers):
    //  - race pace for the athlete's event, set per athlete type:
    //      sprint    100 pace — 25 in ~¼ × 100 PB, 50 in the second 50 of the 100 (50–52.5% of 100 PB)
    //      allround  200 pace — the second 100 of the 200 (½ × 200 goal/PB per 100)
    //      endurance 400 pace — from the swimmer's 400 PB (Al, 2026-10-22)
    //  - reps 25–100m (sprinters 25/50, 200 swimmers 50/100; Sweetenham 50–100)
    //  - rest per rep, by athlete type (rest inside the piece; active-recovery swims between
    //    pieces are separate main rest and need the set-format change to be seen):
    //      sprint/allround  1–5× the swim — about 1:2 (Al); Sweetenham's 10×50 on 2:30–3:00 ≈ 1:4
    //      endurance        0.75–2× (Al, 2026-10-22, from the book's 400m sets scaled to the
    //                       swimmer: a 4:28 400 swimmer's 100 on 2:00 is 67:53, 50 on 60 is 33:27)
    //    Send-offs are offered as ratios of the swimmer's own rep time, so they scale to level.
    //  - volume = race-pace metres only (recovery swims don't count): sprinters 500–~1000m (Al),
    //    endurance 500–1200m (book's 400m sets), all-round 500–1200m provisional.
    // LP is below LT and PL in intensity: the Training Zones chart's LA (8–15 vs 12–20 mmol)
    // and RPE (17–19 vs 19–20) agree with Sweetenham, whatever order the chart's rows are in.
    code: 'LP', group: 4, rank: 6, label: 'Lactate production', short: 'LP',
    name: 'LP / Lactate Production', rpe: '17-19', energyModel: true, speedRatio: 1.00,
    desc: 'Improves the rate of anaerobic glycolysis. Race-pace 25–100m reps with rest 1–5× the swim. Early season focus.',
    hrBand: { fromBbm: 0, toBbm: 10 },
    criteria: {
      eventPace: {
        sprint:    { event: 100, lo: 1.00, hi: 1.05 },
        allround:  { event: 200, lo: 1.00, hi: 1.03 },
        endurance: { event: 400, lo: 1.00, hi: 1.03 },
      },
      speed: [0.97, 1.03],
      restWork: [1, 5], onRestRatios: [1, 2, 3, 4, 5],
      restWorkByAthleteType:    { endurance: [0.75, 2] },
      onRestRatiosByAthleteType: { endurance: [0.75, 1, 1.25, 1.5, 2] },
      distMin: 25, distMax: 100,
      volumeM: [300, 2000],
      volumeByAthleteType: { sprint: [500, 1000], allround: [500, 1200], endurance: [500, 1200] },
    },
    provisional: true,
  },
  {
    code: 'LT', group: 4, rank: 7, label: 'Lactate tolerance', short: 'LT',
    name: 'LT / Lactate Tolerance', rpe: '18-20', energyModel: true, speedRatio: 0.96,
    desc: 'High-speed glycolytic work with significant lactate accumulation. Post-PHV athletes.',
    hrBand: { fromBbm: 0, toBbm: 10 },
    // Al, 2026-10-16:
    //  - reps 50–200m
    //  - pace = ½ × 200 goal time (else ½ × 200 PB) per 100 — the 2nd 100 of the 200 — ±2 s/100
    //  - send-off 3:00–5:00 start-to-start: the next rep starts as lactate from the last one
    //    peaks (Bowman: ~4:00 from the start of the previous swim). Offered 3:00/3:30/4:00/4:30/5:00.
    //  - 600–2000m: shorter for sprinters, longer for middle-distance swimmers.
    // speed is the ratio fallback when there is no 200 time in the context.
    criteria: {
      racePace: { offsetLow: -2, offsetHigh: 2 }, speed: [0.97, 1.03],
      onSec: [180, 300], onOptions: [180, 210, 240, 270, 300],
      distMin: 50, distMax: 200,
      volumeM: [600, 2000],
      volumeByAthleteType: { sprint: [600, 1000], allround: [800, 1500], endurance: [1200, 2000] },
    },
  },
  {
    code: 'PL', group: 4, rank: 8, label: 'Peak lactate', short: 'PL',
    name: 'PL / Peak Lactate', rpe: '20', energyModel: false, speedRatio: 0.92,
    desc: 'Maximum 75–400m efforts (straight or broken) on 10–30 min with active recovery, so each swim reaches peak lactate. Use sparingly.',
    hrBand: null,
    // Al, 2026-10-22 (Sweetenham & Atkinson ch. 1 and 13):
    //  - maximum effort: at or faster than race pace for the athlete's event (a 100 swimmer
    //    holds their 100 splits, a 200 swimmer their 200 splits)
    //  - efforts 75–400m, straight or broken (e.g. 3×200 as 4×50 on 60 — a broken effort is
    //    not yet expressible in a single line; see the set-format request)
    //  - send-off 10–30 min with active recovery (4×100 on 15:00; 4×100 on 20:00; 3×200 on 30:00)
    //  - 300–800m of peak-lactate swimming
    criteria: {
      eventPace: {
        sprint:    { event: 100, lo: null, hi: 1.02 },
        allround:  { event: 200, lo: null, hi: 1.02 },
        endurance: { event: 400, lo: null, hi: 1.02 },
      },
      speed: [null, 1.0],
      onSec: [600, 1800], onOptions: [600, 900, 1200, 1500, 1800],
      distMin: 75, distMax: 400,
      volumeM: [300, 800],
    },
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
