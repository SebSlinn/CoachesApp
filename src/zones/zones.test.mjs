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
  assert.deepEqual(typesInGroup(4), ['LP', 'LT', 'PL']);
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
test('MVO and PL have working criteria', () => {
  // 10×200 @ 2:20 with 1:30 rest-ish: rw 0.6, 140 s reps, 23 min work, ratio 1.03
  const mMvo = evaluateZoneMatch('MVO', res({ speedRatio: 1.03, restWorkRatio: 0.6, workDur: 140 }), { distM: 200, qty: 10 });
  assert.equal(mMvo.isMatch, true);
  // 3×100 all-out @ 0.93 with 8 min rest
  const mPl = evaluateZoneMatch('PL', res({ speedRatio: 0.93, restWorkRatio: 8, workDur: 60 }), { distM: 100, qty: 3 });
  assert.equal(mPl.isMatch, true);
  // an HVO-style 15 s sprint is not PL
  assert.equal(evaluateZoneMatch('PL', res({ speedRatio: 0.82, restWorkRatio: 8, workDur: 12 }), { distM: 25, qty: 8 }).isMatch, false);
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

console.log(`\n${mPass} passed`);
