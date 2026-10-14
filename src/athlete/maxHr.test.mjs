// src/athlete/maxHr.test.mjs — node src/athlete/maxHr.test.mjs
import assert from 'node:assert/strict';
import { resolveMaxHr, ageInYears, ageBasedMaxHr, isValidMaxHr, MAX_HR_LIMITS } from './maxHr.js';
import { hrTargetRange } from '../zones/types.js';

let mPass = 0;
const test = (name, fn) => { fn(); mPass++; console.log('  ✓', name); };
const ASOF = '2026-10-14';

console.log('ageInYears / ageBasedMaxHr');
test('birthday not yet reached this year', () => {
  assert.equal(ageInYears('2012-11-01', ASOF), 13);
  assert.equal(ageInYears('2012-10-14', ASOF), 14);
  assert.equal(ageInYears('2012-01-01', ASOF), 14);
});
test('unknown or implausible ages give null', () => {
  assert.equal(ageInYears(null, ASOF), null);
  assert.equal(ageInYears('not a date', ASOF), null);
  assert.equal(ageInYears('2024-01-01', ASOF), null);   // 2 years old
  assert.equal(ageBasedMaxHr(null), null);
  assert.equal(ageBasedMaxHr(14), 206);
});

console.log('resolveMaxHr');
test('nothing known → none; plain working (no HR target)', () => {
  const r = resolveMaxHr({ asOf: ASOF });
  assert.equal(r.source, 'none'); assert.equal(r.maxHr, null);
  assert.equal(hrTargetRange('A2', r.maxHr), null);
});
test('date of birth only → 220 − age, marked estimated', () => {
  const r = resolveMaxHr({ dateOfBirth: '2012-03-02', asOf: ASOF });
  assert.deepEqual([r.source, r.maxHr, r.estimated, r.age], ['age', 206, true, 14]);
  assert.match(r.detail, /220 − age 14/);
});
test('a Max HR test beats the age estimate', () => {
  const r = resolveMaxHr({ dateOfBirth: '2012-03-02', testPeakHr: 201, testOn: '2026-10-01', asOf: ASOF });
  assert.deepEqual([r.source, r.maxHr, r.estimated], ['test', 201, false]);
});
test('a value saved on the profile beats everything', () => {
  const r = resolveMaxHr({ savedMaxHr: 198, savedSource: 'typed', dateOfBirth: '2012-03-02', testPeakHr: 201, asOf: ASOF });
  assert.deepEqual([r.source, r.maxHr], ['profile', 198]);
  assert.match(r.detail, /entered by the coach/);
  assert.match(resolveMaxHr({ savedMaxHr: 201, savedSource: 'test' }).detail, /from a Max HR test/);
});
test('implausible values are ignored and the next source is used', () => {
  assert.equal(resolveMaxHr({ savedMaxHr: 19, testPeakHr: 199 }).source, 'test');
  assert.equal(resolveMaxHr({ testPeakHr: 260, dateOfBirth: '2000-01-01', asOf: ASOF }).source, 'age');
  assert.equal(isValidMaxHr('195'), true);
  assert.equal(isValidMaxHr(MAX_HR_LIMITS.max + 1), false);
  assert.equal(isValidMaxHr(240), true, 'young children can reach 240');
  assert.equal(resolveMaxHr({ testPeakHr: 236 }).source, 'test');
});
test('feeds the zone HR targets', () => {
  const r = resolveMaxHr({ dateOfBirth: '2012-03-02', asOf: ASOF });   // 206
  assert.deepEqual(hrTargetRange('AT', r.maxHr), { lo: 176, hi: 186 });
});

console.log(`\n${mPass} passed`);
