// src/zones/zones.test.mjs — node src/zones/zones.test.mjs
// Training types, schemes and the criteria evaluator (contracts/ZONES.md).
import assert from 'node:assert/strict';
import {
  TYPES, TYPE_CODES, ALL_TYPE_CODES, PRESCRIBABLE_CODES, ENERGY_MODEL_CODES, GROUPS, typesInGroup, hrTargetRange, formatHrBand,
} from './types.js';
import {
  BUILT_IN_SCHEMES, resolveZoneStyle, zoneColor, groupColor, copyScheme, sanitiseScheme, UNKNOWN_COLOR, withAlpha,
} from './schemes.js';
import { evaluateZoneMatch, ACTIVE_CRITERIA } from './zoneCriteria.js';
import { ZONES, ZONE_COLORS, ZONE_WRITEUPS, ZONE_GROUPS } from './constants.js';
import { classifySet } from './classify.js';
import { suggestTimes } from './suggest.js';
import { sbZoneColor } from '../session/utils.js';

let mPass = 0;
const test = (name, fn) => { fn(); mPass++; console.log('  ✓', name); };

console.log('types');
test('the target list from ZONES.md is all there, in its groups', () => {
  const mWant = { A1: 1, A2: 1, A3: 1, AT: 2, CS: 3, MVO: 3, LP: 4, LT: 4, PL: 4, HVO: 5 };
  assert.deepEqual(Object.fromEntries(TYPE_CODES.map(c => [c, TYPES[c].group])), mWant);
});
test('intensity order: LP below LT (Sweetenham & Atkinson), PL above LT', () => {
  assert.deepEqual(TYPE_CODES, ['A1', 'A2', 'A3', 'AT', 'CS', 'MVO', 'LP', 'LT', 'PL', 'HVO']);
});
test('LR is benched: code reserved, hidden from pickers/groups/criteria', () => {
  assert.equal(TYPES.LR.benched, true);
  assert.ok(ALL_TYPE_CODES.includes('LR') && !TYPE_CODES.includes('LR') && !PRESCRIBABLE_CODES.includes('LR'));
  assert.ok(!typesInGroup(3).includes('LR') && !('LR' in ACTIVE_CRITERIA));
  assert.equal(resolveZoneStyle('LR').known, true, 'a stored LR line still displays');
});
test('every type has a writeup, a valid group and criteria (or none on purpose)', () => {
  for (const c of TYPE_CODES) {
    assert.ok(TYPES[c].writeup?.name, `${c} writeup`);
    assert.ok(GROUPS.some(g => g.zone === TYPES[c].group), `${c} group`);
    assert.ok(TYPES[c].criteria && typeof TYPES[c].criteria === 'object', `${c} criteria`);
  }
});
test('HR bands match the chart (bbm below max)', () => {
  const mBands = Object.fromEntries(TYPE_CODES.map(c => [c, formatHrBand(TYPES[c].hrBand)]));
  assert.deepEqual(mBands, {
    A1: '>50 bbm', A2: '40–50 bbm', A3: '30–40 bbm', AT: '20–30 bbm',
    CS: '5–20 bbm', MVO: '10–20 bbm', LP: '0–10 bbm', LT: '0–10 bbm', PL: 'N/A', HVO: 'N/A',
  });
  assert.equal(TYPES.AT.writeup.hr, '20–30 bbm', 'writeup.hr is derived from the band');
});
test('hrTargetRange: bpm from max HR; null without max HR or band', () => {
  assert.deepEqual(hrTargetRange('A2', 200), { lo: 150, hi: 160 });
  assert.deepEqual(hrTargetRange('A1', 200), { lo: null, hi: 150 });
  assert.equal(hrTargetRange('A2', null), null);
  assert.equal(hrTargetRange('HVO', 200), null);
});
test('energy model is still the original seven', () => {
  assert.deepEqual([...ENERGY_MODEL_CODES].sort(), ['A1', 'A2', 'A3', 'AT', 'HVO', 'LP', 'LT']);
  assert.deepEqual(ZONES.map(z => z.id), ['HVO', 'LT', 'LP', 'AT', 'A3', 'A2', 'A1']);
});
test('TYPES is frozen (codes are permanent)', () => {
  assert.ok(Object.isFrozen(TYPES) && Object.isFrozen(TYPES.AT));
});

console.log('schemes');
test('default scheme = exactly the colours SwimZone has always shown', () => {
  // old ZONE_COLORS / sbZoneColor / Classifier zoneColors (CS teal) + PL banner colour
  const mOld = { HVO: '#FF2D55', LT: '#FF5500', LP: '#FF9500', AT: '#FFCC00', A3: '#34C759', A2: '#30B0C7', A1: '#007AFF',
                 CS: '#30B0C7', PL: '#CC2200' };
  for (const [c, col] of Object.entries(mOld)) assert.equal(zoneColor(c), col, c);
  // old ZONE_GROUPS header colours
  assert.deepEqual([1, 2, 3, 4, 5].map(z => groupColor(z)), ['#30B0C7', '#FFCC00', '#FF9500', '#FF5500', '#FF2D55']);
  // old ZONES text colours and names
  assert.equal(resolveZoneStyle('AT').text, '#1a1a2e');
  for (const c of ['HVO', 'LT', 'LP', 'A3', 'A2', 'A1']) assert.equal(resolveZoneStyle(c).text, '#fff', c);
  assert.equal(resolveZoneStyle('AT').name, 'AT / Anaerobic Threshold');
  assert.equal(resolveZoneStyle('HVO').name, 'HVO / ATP-CP');
  assert.equal(withAlpha('#30B0C7', 0.12), 'rgba(48,176,199,0.12)');
});
test('Zone 3 types share one colour in every built-in scheme', () => {
  for (const id of Object.keys(BUILT_IN_SCHEMES)) {
    assert.equal(zoneColor('CS', id), zoneColor('MVO', id), id);
  }
});
test('labels: HVO code stays, label is the scheme\'s', () => {
  assert.equal(resolveZoneStyle('HVO', 'sweetenham').label, 'Sprint / ATP-PC');
  assert.equal(resolveZoneStyle('HVO', 'urbanchek').label, 'Gold');
  assert.equal(resolveZoneStyle('HVO', 'maglischo').short, 'SP3');
  assert.equal(resolveZoneStyle('HVO', 'urbanchek').code, 'HVO');
});
test('scheme names: relabelled types read "CODE / label"', () => {
  assert.equal(resolveZoneStyle('AT', 'urbanchek').name, 'AT / Blue');
});
test('Urbanchek / Maglischo mappings from the chart', () => {
  const u = c => resolveZoneStyle(c, 'urbanchek').label;
  assert.deepEqual(['A1', 'A2', 'A3', 'AT', 'CS', 'MVO', 'LT', 'LP', 'HVO'].map(u),
    ['White', 'Pink', 'Red', 'Blue', 'Purple', 'Purple', 'Orange', 'Green', 'Gold']);
  const m = c => resolveZoneStyle(c, 'maglischo').label;
  assert.deepEqual(['A1', 'A2', 'A3', 'AT', 'CS', 'LT', 'LP', 'HVO'].map(m),
    ['EN1', 'EN1', 'EN2', 'EN2', 'EN3', 'SP1', 'SP2', 'SP3']);
});
test('fallbacks: group colour, then neutral grey for non-zones', () => {
  const mBare = { id: 'x', types: {}, groups: { 4: { color: '#123456' } } };
  assert.equal(zoneColor('PL', mBare), '#123456');
  assert.equal(zoneColor('A2', mBare), GROUPS[0].color);
  assert.equal(zoneColor('Drill'), UNKNOWN_COLOR);
  assert.equal(resolveZoneStyle(null).known, false);
  assert.equal(groupColor(3, 'urbanchek'), '#7E57C2');
});
test('light colours get dark text', () => {
  assert.equal(resolveZoneStyle('A1', 'urbanchek').text, '#111');
  assert.equal(resolveZoneStyle('LT').text, '#fff');
});
test('copyScheme is an editable deep copy; sanitiseScheme drops junk', () => {
  const c = copyScheme('urbanchek', { name: 'Al' });
  c.types.AT.color = '#000000';
  assert.equal(BUILT_IN_SCHEMES.urbanchek.types.AT.color, '#1E88E5', 'built-in untouched');
  assert.equal(c.builtIn, false);
  const s = sanitiseScheme({ id: 'mine', types: { AT: { color: 'red', label: 'Thresh' }, ZZ: { color: '#000000' } }, groups: { 9: { color: '#000000' } } });
  assert.deepEqual(s.types, { AT: { label: 'Thresh' } });
  assert.deepEqual(s.groups, {});
  assert.equal(sanitiseScheme(null).id, 'sweetenham');
});

console.log('back-compat');
test('ZONE_COLORS / sbZoneColor / ZONE_GROUPS come from the same source', () => {
  for (const c of TYPE_CODES) assert.equal(sbZoneColor(c), ZONE_COLORS[c]);
  assert.equal(sbZoneColor('Skills'), '#888', 'Set Builder keeps its old grey for non-zones');
  assert.deepEqual(ZONE_GROUPS.find(g => g.zone === 3).members, ['CS', 'MVO']);
  assert.deepEqual(typesInGroup(4), ['LP', 'LT', 'PL'], 'LP below LT (Sweetenham)');
  assert.ok(ZONE_WRITEUPS.MVO && ZONE_WRITEUPS.PL);
});
test('classifySet breakdown still sums to 100 over the seven', () => {
  const r = classifySet({ distM: 100, qty: 8, targetTimeSec: 68, restSec: 12, pace200Sec: 130, stroke: 'FS' });
  assert.equal(r.breakdown.length, 7);
  assert.equal(r.breakdown.reduce((a, z) => a + z.pct, 0), 100);
});

console.log('evaluateZoneMatch');
// helper: a fake classifySet() result
const res = (o) => ({ speedRatio: 1.0, restWorkRatio: 0.5, workDur: 60, repPace100: 60, base100Pace: 60, ...o });
test('criteria table covers every type', () => {
  assert.deepEqual(Object.keys(ACTIVE_CRITERIA), TYPE_CODES);
});
test('hrBand: skipped without max HR or without a measured HR', () => {
  const r = res({ speedRatio: 1.30 });
  const mNoHr = evaluateZoneMatch('A2', r, { distM: 100, qty: 10 }, { maxHr: 200 });
  assert.deepEqual(mNoHr.criteria.map(c => c.key), ['speed']);
  const mNoMax = evaluateZoneMatch('A2', r, { distM: 100, qty: 10, hrAvg: 155 }, {});
  assert.deepEqual(mNoMax.criteria.map(c => c.key), ['speed']);
});
test('hrBand: passes inside the band, fails outside', () => {
  const r = res({ speedRatio: 1.30 });
  const mIn = evaluateZoneMatch('A2', r, { distM: 100, qty: 10, hrAvg: 155 }, { maxHr: 200 });
  assert.equal(mIn.isMatch, true);
  const mOut = evaluateZoneMatch('A2', r, { distM: 100, qty: 10, hrPeak: 185 }, { maxHr: 200 });
  assert.equal(mOut.isMatch, false); assert.equal(mOut.isPartial, true);
  assert.equal(mOut.criteria.find(c => c.key === 'hrBand').met, false);
});
test('hr prefers explicit hr, then hrPeak, then hrAvg', () => {
  const r = res({ speedRatio: 1.30 });
  const m = evaluateZoneMatch('A2', r, { hr: 155, hrPeak: 190, hrAvg: 120 }, { maxHr: 200 });
  assert.equal(m.criteria.find(c => c.key === 'hrBand').met, true);
});
test('LR (benched): no opinion', () => {
  assert.equal(evaluateZoneMatch('LR', res({ speedRatio: 1.03 }), { distM: 100, qty: 10 }, { maxHr: 200 }), null);
});
test('PL sits above LT: Urbanchek Orange, Maglischo SP1; 50–100m reps', () => {
  assert.equal(zoneColor('PL', 'urbanchek'), zoneColor('LT', 'urbanchek'));
  assert.equal(resolveZoneStyle('PL', 'maglischo').short, 'SP1');
  assert.ok(TYPES.PL.rank > TYPES.LT.rank && TYPES.LT.rank > TYPES.LP.rank);
  // PL (2026-10-22): max 75–400m efforts on 10–30 min. Ratio fallback (no athlete).
  const r = res({ speedRatio: 0.93, restWorkRatio: 14, workDur: 60 });     // on 15:00
  assert.equal(evaluateZoneMatch('PL', r, { distM: 100, qty: 4 }).isMatch, true);
  assert.equal(evaluateZoneMatch('PL', r, { distM: 50, qty: 8 }).isMatch, false, 'too short');
  assert.equal(evaluateZoneMatch('PL', r, { distM: 800, qty: 1 }).isMatch, false, 'too long');
});
test('MVO and PL have working criteria', () => {
  // 10×200 @ 2:20 with 1:30 rest-ish: rw 0.6, 140 s reps, 23 min work, ratio 1.03
  const mMvo = evaluateZoneMatch('MVO', res({ speedRatio: 1.03, restWorkRatio: 0.6, workDur: 140 }), { distM: 200, qty: 10 });
  assert.equal(mMvo.isMatch, true);
  // 4×200 max on 20:00
  const mPl = evaluateZoneMatch('PL', res({ speedRatio: 0.99, restWorkRatio: (1200 - 130) / 130, workDur: 130 }), { distM: 200, qty: 4 });
  assert.equal(mPl.isMatch, true);
  // max 100s on 4:00 are not PL (that rest is LT territory)
  assert.equal(evaluateZoneMatch('PL', res({ speedRatio: 0.93, restWorkRatio: 3, workDur: 60 }), { distM: 100, qty: 4 }).isMatch, false);
});

console.log('suggestTimes');
test('every type with criteria gets a suggestion; ON high never below ON low', () => {
  assert.equal(suggestTimes('LR', 100, 'FS', 130, 70), null, 'LR benched');
  for (const c of TYPE_CODES) {
    const s = suggestTimes(c, 100, 'FS', 130, 70);
    assert.ok(s, c);
    assert.ok(s.onHigh >= s.onLow, `${c} on ${s.onLow}-${s.onHigh}`);
    assert.ok(s.inHigh > s.inLow, `${c} in`);
  }
});

console.log('LT (Al, 2026-10-16)');
// Esmee: 200 PB 2:09.55 → ½ = 64.8 s/100. LT pace band 62.8–66.8 s/100.
const mLtRes = (pIn, pDist, pOn) => ({
  speedRatio: (pIn / pDist * 100) / 64.775, restWorkRatio: (pOn - pIn) / pIn, workDur: pIn,
  repPace100: pIn / pDist * 100, base100Pace: 64.775,
});
const mEsmee = { pace200Sec: 129.55, athleteType: 'endurance' };
test('LT match: 12×100 @ 1:05 on 4:00 for an endurance swimmer', () => {
  const m = evaluateZoneMatch('LT', mLtRes(65, 100, 240), { distM: 100, qty: 12 }, mEsmee);
  assert.equal(m.isMatch, true, JSON.stringify(m.criteria));
});
test('LT: 100 PB pace (0:59) is too fast; 2:10 send-off is too soon; 500m too little', () => {
  const m = evaluateZoneMatch('LT', mLtRes(59, 100, 130), { distM: 100, qty: 5 }, mEsmee);
  const mBad = m.criteria.filter(c => !c.met).map(c => c.key).sort();
  assert.deepEqual(mBad, ['onSec', 'racePace', 'volumeM']);
});
test('LT: reps 50–200m only', () => {
  assert.equal(evaluateZoneMatch('LT', mLtRes(16, 25, 180), { distM: 25, qty: 40 }, mEsmee).isMatch, false);
  assert.equal(evaluateZoneMatch('LT', mLtRes(260, 400, 300), { distM: 400, qty: 4 }, mEsmee).isMatch, false);
  assert.equal(evaluateZoneMatch('LT', mLtRes(130, 200, 300), { distM: 200, qty: 8 }, mEsmee).isMatch, true);
});
test('LT volume follows athlete type; 600–2000m with no type', () => {
  const r = mLtRes(65, 100, 240);
  assert.equal(evaluateZoneMatch('LT', r, { distM: 100, qty: 8 }, { pace200Sec: 129.55, athleteType: 'sprint' }).isMatch, true);
  assert.equal(evaluateZoneMatch('LT', r, { distM: 100, qty: 12 }, { pace200Sec: 129.55, athleteType: 'sprint' }).isMatch, false);
  assert.equal(evaluateZoneMatch('LT', r, { distM: 100, qty: 6 }, { pace200Sec: 129.55 }).isMatch, true);
  assert.equal(evaluateZoneMatch('LT', r, { distM: 100, qty: 5 }, { pace200Sec: 129.55 }).isMatch, false);
});
test('LT pace uses the 200 goal time when one is given', () => {
  // goal 2:04 → 62 s/100; 1:02 passes on goal, fails on PB 2:09.55 (needs ≥ 62.8)
  const r = mLtRes(62, 100, 240);
  assert.equal(evaluateZoneMatch('LT', r, { distM: 100, qty: 12 }, mEsmee).isMatch, false);
  assert.equal(evaluateZoneMatch('LT', r, { distM: 100, qty: 12 }, { ...mEsmee, goal200Sec: 124 }).isMatch, true);
});
test('LT suggestions: IN around ½ × 200, ON 3:00–5:00 in 30 s steps', () => {
  const s100 = suggestTimes('LT', 100, 'FS', 129.55, null);
  assert.equal(s100.inLow, 63); assert.equal(s100.inHigh, 67);
  assert.deepEqual(s100.onOptions, [180, 210, 240, 270, 300]);
  assert.equal(s100.onLow, 180); assert.equal(s100.onHigh, 300);
  const s50 = suggestTimes('LT', 50, 'FS', 129.55, null);
  assert.equal(s50.inLow, 31); assert.equal(s50.inHigh, 33);
  const s200 = suggestTimes('LT', 200, 'FS', 129.55, null);
  assert.equal(s200.inLow, 126); assert.equal(s200.inHigh, 134);
  const sGoal = suggestTimes('LT', 100, 'FS', 129.55, null, 124);
  assert.equal(sGoal.inLow, 60); assert.equal(sGoal.inHigh, 64);
  // every suggested IN/ON pair inside the band is an LT match
  for (const mOn of s100.onOptions) {
    const m = evaluateZoneMatch('LT', mLtRes(65, 100, mOn), { distM: 100, qty: 12 }, mEsmee);
    assert.equal(m.isMatch, true, `on ${mOn}`);
  }
});

console.log('LP and PL (Al, 2026-10-22)');
// A sprinter: 100 PB 58.0 → 100 pace 58.0/100, LP band 58.0–60.9 per 100 (50 in 29.0–30.45).
const mSprinter = { athleteType: 'sprint', pace200Sec: 129.55, times: { '100_FS': { sec: 58.0 } } };
const mRep = (pIn, pDist, pOn) => ({
  speedRatio: (pIn / pDist * 100) / 64.775, restWorkRatio: (pOn - pIn) / pIn, workDur: pIn,
  repPace100: pIn / pDist * 100, base100Pace: 64.775,
});
test('LP sprinter: 10×50 @ 30 on 1:30 (≈1:2) is LP; 1000m max', () => {
  const m = evaluateZoneMatch('LP', mRep(30, 50, 90), { distM: 50, qty: 10, stroke: 'FS' }, mSprinter);
  assert.equal(m.isMatch, true, JSON.stringify(m.criteria));
  assert.equal(evaluateZoneMatch('LP', mRep(30, 50, 90), { distM: 50, qty: 24 }, mSprinter).isMatch, false, '1200m too much');
});
test("LP sprinter: Sweetenham's 10×50 on 2:30–3:00 still fits (rest ≤ 5×)", () => {
  assert.equal(evaluateZoneMatch('LP', mRep(30, 50, 150), { distM: 50, qty: 10 }, mSprinter).isMatch, true);
  assert.equal(evaluateZoneMatch('LP', mRep(30, 50, 180), { distM: 50, qty: 10 }, mSprinter).isMatch, true);
});
test('LP: too slow for 100 pace, too short a rest, too long a rep', () => {
  const mBad = k => evaluateZoneMatch('LP', ...k).criteria.filter(c => !c.met).map(c => c.key);
  assert.deepEqual(mBad([mRep(33, 50, 99), { distM: 50, qty: 10 }, mSprinter]), ['eventPace']);
  assert.deepEqual(mBad([mRep(30, 50, 50), { distM: 50, qty: 10 }, mSprinter]), ['restWork']);
  assert.ok(mBad([mRep(120, 200, 360), { distM: 200, qty: 4 }, mSprinter]).includes('dist'));
});
test('LP all-round uses 200 pace (goal first); endurance uses 400 PB', () => {
  const mAll = { athleteType: 'allround', pace200Sec: 129.55 };
  assert.equal(evaluateZoneMatch('LP', mRep(33, 50, 99), { distM: 50, qty: 16 }, mAll).isMatch, true);
  assert.equal(evaluateZoneMatch('LP', mRep(33, 50, 99), { distM: 50, qty: 16 }, { ...mAll, goal200Sec: 124 }).isMatch, false);
});
// Al's 4:28 400 swimmer (67/100): the book's 4 × (100 on 2:00, 2 × 50 on 60) at 400 pace.
const mEnd = { athleteType: 'endurance', pace200Sec: 129.55, times: { '400_FS': { sec: 268 } } };
test('LP endurance: 400 pace from the 400 PB; 100 on 2:00 (67:53) and 50 on 60 (33:27) fit', () => {
  const m100 = evaluateZoneMatch('LP', mRep(67, 100, 120), { distM: 100, qty: 4 }, mEnd);
  assert.equal(m100.criteria.find(c => c.key === 'restWork').met, true);
  assert.equal(m100.criteria.find(c => c.key === 'eventPace').met, true);
  const m50 = evaluateZoneMatch('LP', mRep(33.5, 50, 60), { distM: 50, qty: 8 }, mEnd);
  assert.equal(m50.criteria.find(c => c.key === 'restWork').met, true);
  // the same rest is too short for a sprinter's LP (needs ≥ 1:1)
  assert.equal(evaluateZoneMatch('LP', mRep(29, 50, 52), { distM: 50, qty: 16 }, mSprinter)
    .criteria.find(c => c.key === 'restWork').met, false);
  // 20 × 50 on 1:15 = 1000m of race pace: a full match
  assert.equal(evaluateZoneMatch('LP', mRep(33.5, 50, 75), { distM: 50, qty: 20 }, mEnd).isMatch, true);
});
test('LP endurance suggestions scale with the swimmer: 100s at 67–69 → 2:00 … 3:30', () => {
  const s = suggestTimes('LP', 100, 'FS', 129.55, null, null, mEnd);
  assert.deepEqual(s.onOptions, [120, 135, 150, 165, 210]);
});
test('LP suggestions: race pace IN; ON at 1:1 … 1:5', () => {
  const s = suggestTimes('LP', 50, 'FS', 129.55, null, null, mSprinter);
  assert.equal(s.inLow, 29); assert.equal(s.inHigh, 30);
  assert.deepEqual(s.onOptions, [60, 90, 120, 150, 180]);
});
test('PL: max 100s on 15:00 for a 100 swimmer; 200s at 200 pace on 20:00 for a 200 swimmer', () => {
  assert.equal(evaluateZoneMatch('PL', mRep(58.5, 100, 900), { distM: 100, qty: 4 }, mSprinter).isMatch, true);
  assert.equal(evaluateZoneMatch('PL', mRep(62, 100, 900), { distM: 100, qty: 4 }, mSprinter).isMatch, false, 'not max');
  assert.equal(evaluateZoneMatch('PL', mRep(129, 200, 1200), { distM: 200, qty: 4 }, { athleteType: 'allround', pace200Sec: 129.55 }).isMatch, true);
});
test('PL suggestions: ON 10/15/20/25/30 min', () => {
  const s = suggestTimes('PL', 100, 'FS', 129.55, null, null, mSprinter);
  assert.deepEqual(s.onOptions, [600, 900, 1200, 1500, 1800]);
  assert.ok(s.inLow <= 58 && s.inHigh >= 58);
});

console.log(`\n${mPass} passed`);
