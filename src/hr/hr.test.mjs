// src/hr/hr.test.mjs — node src/hr/hr.test.mjs
// Packet parsing + per-rep metrics. No browser, no Bluetooth needed.
import assert from 'node:assert/strict';
import { parseHeartRate } from './hrMonitor.js';
import { repHrMetrics, coverage, hrAt, sliceStream } from './hrMetrics.js';

let mPass = 0;
const test = (name, fn) => { fn(); mPass++; console.log('  ✓', name); };
const view = (bytes) => new DataView(new Uint8Array(bytes).buffer);

console.log('parseHeartRate');
test('uint8 bpm, no extras', () => {
  assert.deepEqual(parseHeartRate(view([0x00, 152])), { bpm: 152, contact: null, rr: [] });
});
test('uint16 bpm', () => {
  assert.equal(parseHeartRate(view([0x01, 0x2c, 0x01])).bpm, 300);
});
test('contact supported + detected', () => {
  assert.equal(parseHeartRate(view([0x06, 140])).contact, true);
  assert.equal(parseHeartRate(view([0x04, 140])).contact, false);
});
test('RR intervals (1/1024 s → ms), energy field skipped', () => {
  // flags: energy(0x08)+rr(0x10); bpm 150; energy 0x0000; rr 410/1024s, 420/1024s
  const r = parseHeartRate(view([0x18, 150, 0, 0, 0x9a, 0x01, 0xa4, 0x01]));
  assert.equal(r.bpm, 150);
  assert.deepEqual(r.rr, [400, 410]);
});

console.log('repHrMetrics');
const T0 = Date.parse('2026-10-05T18:00:00Z');
// 60 s rep, swimmer only surfaces every ~4 s; HR climbs 140→170, then recovers.
const mStream = [];
for (let s = 0; s <= 60; s += 4) mStream.push({ t: T0 + s * 1000, bpm: 140 + Math.round(s / 2) });
mStream.push({ t: T0 + 61000, bpm: 171 });
mStream.push({ t: T0 + 70000, bpm: 160 });
mStream.push({ t: T0 + 90000, bpm: 140 });
mStream.push({ t: T0 + 120000, bpm: 120 });

test('avg / peak / end / recovery', () => {
  const m = repHrMetrics(mStream, { startedAt: T0, timeSec: 60 });
  assert.equal(m.hrPeak, 171);
  assert.equal(m.hrEnd, 170);
  assert.equal(m.hr, 170);
  assert.equal(m.hrRec10, 160);
  assert.equal(m.hrRec30, 140);
  assert.equal(m.hrRec60, 120);
  assert.equal(m.hrDrop30, 30);
  assert.ok(m.hrCoverage > 0.9, `coverage ${m.hrCoverage}`);
});
test('ISO startedAt accepted', () => {
  assert.equal(repHrMetrics(mStream, { startedAt: new Date(T0).toISOString(), timeSec: 60 }).hrPeak, 171);
});
test('recovery stops at next rep start', () => {
  const m = repHrMetrics(mStream, { startedAt: T0, timeSec: 60, nextStartedAt: T0 + 80000 });
  assert.equal(m.hrRec10, 160);
  assert.equal(m.hrRec30, null);
  assert.equal(m.hrRec60, null);
});
test('gappy rep → low coverage, still returns what it has', () => {
  const gappy = [{ t: T0 + 2000, bpm: 130 }, { t: T0 + 59000, bpm: 168 }];
  const m = repHrMetrics(gappy, { startedAt: T0, timeSec: 60 });
  assert.ok(m.hrCoverage < 0.2, `coverage ${m.hrCoverage}`);
  assert.equal(m.hrPeak, 168);
});
test('no data → nulls, coverage 0', () => {
  const m = repHrMetrics([], { startedAt: T0, timeSec: 60 });
  assert.equal(m.hr, null); assert.equal(m.hrCoverage, 0);
});
test('zero bpm ignored (no skin contact)', () => {
  assert.equal(hrAt([{ t: T0, bpm: 0 }], T0), 0); // hrAt is raw; metrics filter it:
  assert.equal(repHrMetrics([{ t: T0 + 1000, bpm: 0 }], { startedAt: T0, timeSec: 10 }).hrPeak, null);
});
test('coverage of empty window is 0', () => assert.equal(coverage(mStream, T0, T0), 0));
test('sliceStream trims and compacts', () => {
  const s = sliceStream([{ t: T0, bpm: 100, rr: [1] }, { t: T0 + 5000, bpm: 110 }], T0, T0 + 1000);
  assert.deepEqual(s, [{ t: T0, bpm: 100 }]);
});

console.log(`\n${mPass} passed`);
