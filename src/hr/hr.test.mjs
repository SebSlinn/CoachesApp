// src/hr/hr.test.mjs — node src/hr/hr.test.mjs
// Packet parsing + per-rep metrics. No browser, no Bluetooth needed.
import assert from 'node:assert/strict';
import { parseHeartRate } from './hrMonitor.js';
import { repHrMetrics, coverage, hrAt, sliceStream, freshness, packStream, unpackStream, applyHrToReps, hrRollup, lengthHrMetrics, splitsWithHr } from './hrMetrics.js';

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
  assert.equal(m.hrPeak, 170);                       // 171 arrives after the touch — not part of the swim
  assert.equal(m.hrMin, 140);
  assert.equal(m.hrEnd, 170);
  assert.equal(m.hr, 170);
  assert.equal(m.hrRec10, 160);
  assert.equal(m.hrRec30, 140);
  assert.equal(m.hrRec60, 120);
  assert.equal(m.hrDrop30, 30);
  assert.ok(m.hrCoverage > 0.9, `coverage ${m.hrCoverage}`);
});
test('HR-Start = last reading before the start; HR-End = first reading after the touch', () => {
  const s = [{ t: T0 - 40000, bpm: 99 }, { t: T0 - 6000, bpm: 118 }, { t: T0 - 2000, bpm: 122 }, { t: T0 + 10000, bpm: 150 },
             { t: T0 + 19000, bpm: 168 }, { t: T0 + 23000, bpm: 171 }, { t: T0 + 28000, bpm: 165 }];
  const m = repHrMetrics(s, { startedAt: T0, timeSec: 20 });
  assert.equal(m.hrStart, 122); assert.equal(m.hrEnd, 171); assert.equal(m.hr, 171);
  assert.deepEqual([m.hrMin, m.hrPeak], [150, 168]);
  assert.equal(repHrMetrics(s, { startedAt: T0 + 50000, timeSec: 5 }).hrStart, 165);   // within 30 s before
  assert.equal(repHrMetrics(s, { startedAt: T0, timeSec: 20, nextStartedAt: T0 + 21000 }).hrEnd, null);   // next rep began first
});
test('ISO startedAt accepted', () => {
  assert.equal(repHrMetrics(mStream, { startedAt: new Date(T0).toISOString(), timeSec: 60 }).hrPeak, 170);
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

console.log('freshness');
const N = T0 + 60000;
test('every second → 100% fresh, good', () => {
  const s = Array.from({ length: 60 }, (_, i) => ({ t: T0 + i * 1000 + 500, bpm: 140 + (i % 5), rr: [400 + i] }));
  const f = freshness(s, N);
  assert.equal(f.freshPct, 100); assert.equal(f.verdict, 'good'); assert.equal(f.rrPct, 100);
  assert.ok(f.longestGapSec <= 1, `gap ${f.longestGapSec}`); assert.equal(f.held, false);
});
test('surfacing every 3 s with 8 s underwater gaps → patchy', () => {
  const s = [];
  for (let t = 0; t < 60; t += 11) for (let k = 0; k < 3; k++) s.push({ t: T0 + (t + k) * 1000 + 100, bpm: 150 + k, rr: [400 + k] });
  const f = freshness(s, N);
  assert.ok(f.freshPct > 25 && f.freshPct < 40, `fresh ${f.freshPct}`);
  assert.ok(f.longestGapSec >= 8, `gap ${f.longestGapSec}`);
  assert.notEqual(f.verdict, 'good');
});
test('same bpm, no RR for 12 s → held, poor', () => {
  const s = Array.from({ length: 13 }, (_, i) => ({ t: T0 + 40000 + i * 1000, bpm: 162, rr: [] }));
  const f = freshness(s, N);
  assert.equal(f.held, true); assert.ok(f.heldSec >= 12); assert.equal(f.verdict, 'poor');
});
test('same bpm but fresh RR each time → not held (steady real HR)', () => {
  const s = Array.from({ length: 13 }, (_, i) => ({ t: T0 + 40000 + i * 1000, bpm: 162, rr: [370 + (i % 3)] }));
  assert.equal(freshness(s, N).held, false);
});
test('current age = time since last reading', () => {
  assert.equal(freshness([{ t: N - 7000, bpm: 150 }], N).currentAgeSec, 7);
});
test('just connected: time before the first reading is not a gap', () => {
  const s = Array.from({ length: 5 }, (_, i) => ({ t: N - 5000 + i * 1000 + 100, bpm: 140 + i, rr: [400 + i] }));
  const f = freshness(s, N);
  assert.equal(f.verdict, 'good'); assert.ok(f.freshPct >= 80, `fresh ${f.freshPct}`); assert.ok(f.windowSec <= 6);
});
test('no readings → none', () => {
  const f = freshness([], N);
  assert.equal(f.verdict, 'none'); assert.equal(f.currentAgeSec, null);
});

console.log('stored stream + roll-ups');
test('pack → unpack round trip, trimmed to window', () => {
  const p = packStream(mStream, { sensor: 'S', from: T0, to: T0 + 60000 });
  assert.equal(p.sensor, 'S'); assert.ok(Array.isArray(p.samples[0]));
  const u = unpackStream(p);
  assert.equal(u.length, p.samples.length); assert.deepEqual(u[0], { t: T0, bpm: 140 });
});
test('unpack tolerates junk and object samples', () => {
  assert.deepEqual(unpackStream({ samples: [[T0, 0], ['x', 1], { t: T0 + 1, bpm: 99 }] }), [{ t: T0 + 1, bpm: 99 }]);
  assert.deepEqual(unpackStream(null), []);
});
test('applyHrToReps: typed hr kept, sensor figures added', () => {
  const reps = [{ repNo: 1, startedAt: new Date(T0).toISOString(), timeSec: 60, metrics: { hr: 175, rpe: 15 } }];
  const [r] = applyHrToReps(reps, mStream);
  assert.equal(r.metrics.hr, 175); assert.equal(r.metrics.hrPeak, 170); assert.equal(r.metrics.rpe, 15);
  assert.equal(r.metrics.hrRec30, 140);
});
test('applyHrToReps: rep outside the stream left alone', () => {
  const reps = [{ repNo: 1, startedAt: new Date(T0 + 3600000).toISOString(), timeSec: 60, metrics: {} }];
  assert.equal(applyHrToReps(reps, mStream)[0], reps[0]);
});
test('hrRollup', () => {
  const ru = hrRollup([{ metrics: { hr: 160, hrPeak: 165, hrDrop30: 20, hrCoverage: 0.8 } }, { metrics: { hr: 170, hrPeak: 178, hrDrop30: 30, hrCoverage: 0.6 } }, { metrics: {} }]);
  assert.deepEqual(ru, { reps: 2, peak: 178, min: null, avg: null, meanEnd: 165, meanDrop30: 25, coverage: 0.7, fromSensor: true });
  assert.deepEqual([hrRollup([{ metrics: { hrMin: 120, hrAvg: 150, hrPeak: 170 } }, { metrics: { hrMin: 130, hrAvg: 160, hrPeak: 180 } }]).min,
                    hrRollup([{ metrics: { hrMin: 120, hrAvg: 150, hrPeak: 170 } }, { metrics: { hrMin: 130, hrAvg: 160, hrPeak: 180 } }]).avg], [120, 155]);
  assert.equal(hrRollup([{ metrics: { rpe: 12 } }]), null);
  assert.equal(hrRollup([{ metrics: { hr: 150 } }]).fromSensor, false);
});

console.log('per length');
test('lengthHrMetrics: 4 × 15 s lengths', () => {
  const marks = [T0, T0 + 15000, T0 + 30000, T0 + 45000, T0 + 60000];
  const L = lengthHrMetrics(mStream, marks);
  assert.equal(L.length, 4);
  assert.deepEqual([L[0].hrPeak, L[3].hrPeak], [146, 170]);       // 140,142,144,146 … 164,166,168,170
  assert.deepEqual([L[0].hrMin, L[0].hrFirst, L[0].hrLast], [140, 140, 146]);
  assert.deepEqual([L[3].hrMin, L[3].hrFirst, L[3].hrLast], [164, 164, 170]);
  assert.equal(L[1].hrEnd, 154);                                  // nearest to the 30 s turn (28 s → 154, 32 s → 156; tie → first)
  assert.equal(L[3].hrEnd, 170);
  assert.ok(L.every((x) => x.hrCoverage > 0.9));
});
test('lengthHrMetrics: underwater length → nulls, 0 coverage', () => {
  const gappy = [{ t: T0 + 1000, bpm: 130 }, { t: T0 + 29000, bpm: 160 }];
  const L = lengthHrMetrics(gappy, [T0, T0 + 15000, T0 + 30000]);
  assert.equal(L[1].hrAvg, 160); assert.ok(L[1].hrCoverage < 0.3);
  assert.equal(lengthHrMetrics(gappy, [T0 + 40000, T0 + 50000])[0].hrAvg, null);
});
test('splitsWithHr: cumulative splits keep sc/sr and gain HR', () => {
  const rep = { startedAt: new Date(T0).toISOString(), splits: [{ dist: 25, sec: 15, sc: 12, sr: 40 }, { dist: 50, sec: 30, sc: 13 }] };
  const out = splitsWithHr(rep, mStream);
  assert.equal(out[0].sc, 12); assert.equal(out[0].sr, 40);
  assert.deepEqual([out[0].hrFirst, out[0].hrLast], [140, 146]);
  assert.ok(!('hrAvg' in out[0]) && !('hrPeak' in out[0]) && !('hrMin' in out[0]), 'per length: first/last only');
  assert.deepEqual(splitsWithHr({ startedAt: 'x', splits: rep.splits }, mStream), rep.splits);
});
test('applyHrToReps also fills per-length HR on splits', () => {
  const [r] = applyHrToReps([{ startedAt: new Date(T0).toISOString(), timeSec: 60, metrics: {}, splits: [{ dist: 50, sec: 30 }, { dist: 100, sec: 60 }] }], mStream);
  assert.equal(r.splits[1].hrLast, 170); assert.equal(r.metrics.hrPeak, 170); assert.equal(r.metrics.hrMin, 140);
});

console.log(`\n${mPass} passed`);
