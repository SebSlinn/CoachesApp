// tests/fixtures/ladderRuns.mjs
// Realistic sample: the seeded 100s Ladder protocol and three saved runs, in the
// exact shape getSetResultsByProtocol returns (set efforts with reps). Used by
// the report tests, the Excel test and the page preview. Deterministic.
import { resolveParams, analyse } from '../../src/session/protocolFormat.js';

export const ladderProtocol = {
  id: 'proto-ladder', key: 'ladder-100s', version: 1, name: '100s Ladder (20 · 25 · 30)', analyser: 'ladder',
  measures: ['time', 'sc', 'hr', 'rpe'],
  set: { fmt: 'swimzone.set/1', name: '100s Ladder', poolType: '25SC', note: '', blocks: [{ repeats: 1, lines: [
    { type: 'swim', stroke: 'FS', distM: 100, qty: 20, targetRule: { base: 'AT' }, interval: { type: 'fixed', onTime: '1:30', param: 'level' }, intensity: 'AT', measures: ['time', 'sc'], note: '' },
  ] }] },
  params: { level: { label: 'Level', kind: 'level', default: 'L1', options: [
    { value: 'L1', label: 'Level 1 — 20×100 on 1:30', qty: 20, onTime: '1:30' },
    { value: 'L2', label: 'Level 2 — 25×100 on 1:25', qty: 25, onTime: '1:25' },
    { value: 'L3', label: 'Level 3 — 30×100 on 1:20', qty: 30, onTime: '1:20' },
  ] } },
};

// A swimmer who starts at ~1:13 and fades a little; later runs are quicker.
function run(id, swumOn, level, base, fade, n, { hr = false, splits = false, skip = [], starts = false } = {}) {
  const { set, params } = resolveParams(ladderProtocol.set, ladderProtocol.params, { level });
  const reps = [];
  for (let i = 1; i <= n; i++) {
    if (skip.includes(i)) continue;
    const wobble = [0.3, -0.2, 0.1, -0.4, 0.2, 0, -0.1, 0.35, -0.25, 0.15][i % 10];
    const time = Math.round((base + fade * (i - 1) + wobble) * 100) / 100;
    const sc = 16 + Math.floor((i - 1) / 7);
    const metrics = { sc, rpe: i === n ? 17 : undefined };
    if (hr) Object.assign(metrics, { hrStart: 128 + i, hrMin: 126 + i, hrAvg: 150 + i, hrPeak: 162 + i, hrEnd: 161 + i, hrRec30: 138 + i, hrCoverage: i === 7 ? 0.62 : 0.97, hr: 161 + i });
    reps.push({
      id: `${id}-r${i}`, repNo: i, distM: 100, stroke: 'FS', timeSec: time, pbAtSwim: 63.4,
      metrics: Object.fromEntries(Object.entries(metrics).filter(([, v]) => v != null)),
      splits: splits ? [
        { dist: 25, sec: Math.round(time * 0.235 * 100) / 100, sc: sc - 1 },
        { dist: 50, sec: Math.round(time * 0.485 * 100) / 100, sc },
        { dist: 75, sec: Math.round(time * 0.74 * 100) / 100, sc },
        { dist: 100, sec: time, sc: sc + 1 },
      ] : null,
      note: i === 12 && hr ? 'Missed the wall on the turn' : '',
      // Poolside "go" presses: on the send-off, give or take a late push-off
      startedAt: starts ? new Date(Date.parse(swumOn + 'T07:00:00Z') + ((i - 1) * 90 + [0, 0.4, -0.2, 0.6, 0.1][i % 5]) * 1000).toISOString() : undefined,
    });
  }
  const summary = analyse('ladder', reps, { set, params });
  return { id, athleteId: 'ath-esme', swumOn, protocolId: ladderProtocol.id, set,
    conditions: { poolType: '25SC', location: 'Ellesmere Port Sports Village', params, targets: [] }, summary, reps };
}

export const ladderRuns = [
  run('run-1', '2026-07-04', 'L1', 73.6, 0.12, 20, { skip: [] }),
  run('run-2', '2026-08-29', 'L1', 72.4, 0.07, 20, { hr: true, splits: true, starts: true }),
  run('run-3', '2026-10-03', 'L2', 72.0, 0.06, 25, { hr: true, splits: true, skip: [25] }),
];
