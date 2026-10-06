import { store } from './mockFactory.js';
import * as P from '../../src/services/protocols.js';
import * as R from '../../src/services/results.js';
import * as A from '../../src/services/athleteService.js';
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };


console.log('\nAthlete profile (per athlete, stored on their record)');
{
  ok('no profile yet → null, no error', (await A.loadAthleteProfile('sam')).data === null);
  const s1 = await A.saveAthleteProfile('sam', { athleteType: 'endurance', phvStatus: 'developing', seNumber: '123', club: 'EPASC', derivedProfile: { type: 'allround' } });
  ok('saves type + PHV + identity', !s1.error && s1.data.athleteType === 'endurance' && s1.data.phvStatus === 'developing' && s1.data.club === 'EPASC', s1);
  await A.saveAthleteProfile('jo', { athleteType: 'sprint', phvStatus: 'pre' });
  const back = (await A.loadAthleteProfile('sam')).data;
  ok('loading another athlete does not overwrite the first', back.athleteType === 'endurance' && back.phvStatus === 'developing', back);
  ok('derived suggestion snapshot kept beside the coach decision', back.derivedProfile.type === 'allround');
  ok('rejects unknown type', !!(await A.saveAthleteProfile('sam', { athleteType: 'middle' })).error);
  ok('rejects unknown PHV', !!(await A.saveAthleteProfile('sam', { phvStatus: 'late' })).error);
  ok('needs an athlete id', (await A.saveAthleteProfile(null, { athleteType: 'sprint' })).error?.message.includes('No athlete'));
  ok('active-athlete object remembers its id', A.buildAthleteObject({ athleteId: 'sam', name: 'Sam', times: {} }).athleteId === 'sam');
}

const set = (onTime) => ({ fmt: 'swimzone.set/1', name: 'step', blocks: [{ repeats: 1, lines: [
  { type: 'swim', stroke: 'FS', distM: 200, qty: 1, targetRule: { base: 'PB', plusFrom: 20, plusTo: 20 }, interval: { type: 'fixed', onTime, param: 'sendOff' } },
  { type: 'swim', stroke: 'FS', distM: 200, qty: 1, targetRule: { base: 'PB', plusFrom: 0, plusTo: 0 }, interval: { type: 'fixed', onTime, param: 'sendOff' } },
] }] });
const def = { key: 'step-mini', name: 'Mini step', set: set('5:00'), measures: ['time', 'hr', 'lactate'],
  params: { sendOff: { label: 'Send-off', kind: 'onTime', default: '5:00' } }, analyser: 'step' };

console.log('\nprotocols service');
const c1 = await P.createProtocol(null, def);
ok('create validates and saves v1', c1.data && c1.data.version === 1, c1.error);
ok('create rejects a bad protocol', (await P.createProtocol(null, { ...def, key: 'Bad Key' })).error?.message.startsWith('INVALID'));
await P.createProtocol('club-1', { ...def, name: 'Club step' });
const l1 = (await P.listProtocols()).data;
ok('list: global first, then club', l1[0].scope === 'global' && l1[1].scope === 'club', l1.map((p) => p.scope));

store.bests.sam = [['FS', 200, 130]];
const pr = (await P.prescribeForAthletes(c1.data.id, [{ id: 'sam', name: 'Sam' }], { chosen: { sendOff: '5:30' } })).data;
ok('prescription uses Sam\'s bests: 2:30 then 2:10', pr.athletes[0].reps.map((r) => r.targetTime).join() === '2:30,2:10', pr.athletes[0].reps);
ok('prescription applies chosen send-off', pr.set.blocks[0].lines[0].interval.onTime === '5:30' && pr.params.sendOff === '5:30');

console.log('\naddSetResult with a protocol');
const reps = pr.athletes[0].reps.map((r, i) => ({ repNo: r.repNo, distM: 200, stroke: 'FS', timeSec: [150, 131][i],
  targetTime: r.targetTime, pbAtSwim: r.pbAtSwim, metrics: { hr: [150, 185][i], lactate: [2.0, 6.0][i], junk: 'x', sc: '' } }));
const sr = { protocolId: c1.data.id, swumOn: '2026-09-30', sessionId: 'lane3-am', set: pr.set, params: pr.params, conditions: { poolType: '25SC' }, reps };
const s1 = await R.addSetResult('sam', sr);
ok('saved', s1.data && s1.data.reps === 2 && !s1.data.alreadyPresent, s1);
ok('summary computed by the step analyser', s1.data.summary.analyser === 'step' && s1.data.summary.peakHr === 185, s1.data.summary);
ok('speed at 4 mmol interpolated', s1.data.summary.speedAt4mmol > 200 / 150 && s1.data.summary.speedAt4mmol < 200 / 131, s1.data.summary.speedAt4mmol);
const e = store.efforts[0];
ok('metrics cleaned (junk + blank dropped)', JSON.stringify(store.reps[0].metrics) === '{"hr":150,"lactate":2}', store.reps[0].metrics);
ok('targets frozen in conditions, params kept', e.conditions.targets.length === 2 && e.conditions.params.sendOff === '5:30' && e.conditions.poolType === '25SC', e.conditions);
ok('deterministic client_uuid from sessionId', /^[0-9a-f-]{36}$/.test(e.clientUuid));
ok('protocol locked after use', store.protocols.find((p) => p.id === c1.data.id).locked === true);
const s2 = await R.addSetResult('sam', sr);
ok('same run saved again → alreadyPresent, nothing added', s2.data.alreadyPresent === true && store.efforts.length === 1, s2);
ok('unknown protocol → clear error', (await R.addSetResult('sam', { ...sr, protocolId: 'nope', sessionId: 'x' })).error?.message.includes('not found'));

console.log('\nlocked protocol + versions');
const u1 = await P.updateProtocol(c1.data.id, { measures: ['time'] });
ok('locked: definition change refused with a clear message', u1.error?.message.startsWith('LOCKED'), u1);
ok('locked: rename allowed', !(await P.updateProtocol(c1.data.id, { name: 'Mini step test' })).error);
const v2 = await P.newVersion(c1.data.id, { params: { sendOff: { label: 'Send-off', kind: 'onTime', default: '4:45' } } });
ok('newVersion creates v2 with the same key', v2.data?.version === 2 && v2.data.key === 'step-mini', v2);
ok('list shows only the latest version by default', (await P.listProtocols()).data.find((p) => p.key === 'step-mini' && p.scope === 'global').version === 2);
ok('allVersions shows both', (await P.listProtocols({ allVersions: true })).data.filter((p) => p.key === 'step-mini' && p.scope === 'global').length === 2);

console.log('\nreanalyse');
store.efforts[0].summary = null;
const ra = await R.reanalyseSetResults(c1.data.id, 'sam');
ok('reanalyse rewrites the summary from stored reps', ra.data?.updated === 1 && store.efforts[0].summary?.peakHr === 185, store.efforts[0].summary);

console.log('\ningest a Poolside test file');
const file = { fmt: 'swimzone.setresult/1', sessionId: 'pool-sess-9', athleteId: 'sam', athleteName: 'Sam',
  swumOn: '2026-09-30', protocolId: c1.data.id, protocolName: 'Mini step', set: pr.set, params: pr.params,
  conditions: { poolType: '25SC' }, missing: [],
  reps: [{ repNo: 1, distM: 200, stroke: 'FS', timeSec: 152, targetTime: '2:30', metrics: { hr: 148, lactate: 1.9 } },
         { repNo: 2, distM: 200, stroke: 'FS', timeSec: 132, targetTime: '2:10', metrics: { hr: 184, lactate: 5.5 } }] };
const i1 = await R.ingestPoolsideSetResult(file, {});
ok('saved to the athlete in the file', i1.data && i1.data.athleteId === 'sam' && i1.data.reps === 2 && !i1.data.alreadyPresent, i1);
ok('summary computed on import', i1.data.summary && i1.data.summary.analyser === 'step' && i1.data.summary.peakHr === 184, i1.data.summary);
const i2 = await R.ingestPoolsideSetResult(file, {});
ok('importing the same file again is a no-op', i2.data && i2.data.alreadyPresent === true, i2);
ok('file for another swimmer refused when one is loaded',
   (await R.ingestPoolsideSetResult({ ...file, sessionId: 'x2' }, { expectAthleteId: 'jo' })).error?.message.includes('not the loaded athlete'));
ok('file with no athlete uses the fallback',
   (await R.ingestPoolsideSetResult({ ...file, sessionId: 'x3', athleteId: null }, { fallbackAthleteId: 'jo' })).data?.athleteId === 'jo');
ok('not a test file → clear error', (await R.ingestPoolsideSetResult({ fmt: 'swimzone.import/1' })).error?.message.includes('not a Poolside test file'));

console.log('\nlive heart rate in a Poolside test file');
{
  const T0 = Date.parse('2026-10-05T18:00:00Z');
  const samples = [];
  for (let t = 0; t <= 400; t += 2) {                           // 2 reps: 0–150 s and 300–432 s
    const bpm = t <= 150 ? 120 + Math.round(t / 3) : t < 300 ? Math.max(110, 170 - Math.round((t - 150) / 2)) : 130 + Math.round((t - 300) / 2.5);
    samples.push([T0 + t * 1000, bpm]);
  }
  const hrFile = { ...file, sessionId: 'pool-hr-1',
    reps: [{ repNo: 1, distM: 200, stroke: 'FS', timeSec: 150, startedAt: new Date(T0).toISOString(), targetTime: '2:30', metrics: { lactate: 2.1 },
             splits: [{ dist: 100, sec: 75, sc: 30 }, { dist: 200, sec: 150, sc: 32, sr: 38 }] },
           { repNo: 2, distM: 200, stroke: 'FS', timeSec: 132, startedAt: new Date(T0 + 300000).toISOString(), targetTime: '2:10', metrics: { hr: 181, lactate: 5.2 } }],
    hrStream: { source: 'ble-poolside', sensor: 'Polar Sense TEST', samples } };
  const h1 = await R.ingestPoolsideSetResult(hrFile, {});
  ok('saved with a heart-rate stream', h1.data && h1.data.reps === 2 && !h1.data.alreadyPresent, h1);
  const eff = store.efforts.find((e) => e.id === h1.data.effortId);
  const [r1, r2] = store.reps.filter((r) => r.effortId === eff.id).sort((a, b) => a.repNo - b.repNo);
  ok('rep HR derived from the stream (avg/peak/end/coverage)', r1.metrics.hrPeak === 170 && r1.metrics.hrEnd === 170 && r1.metrics.hrCoverage > 0.9 && r1.metrics.hrAvg > 130, r1.metrics);
  ok('rep 1: hr filled from the sensor when not typed', r1.metrics.hr === 170, r1.metrics);
  ok('rep 2: coach-typed hr kept over the sensor', r2.metrics.hr === 181 && r2.metrics.hrPeak === 170, r2.metrics);
  ok('rep 2: stream stopped before the finish → no end reading, partial coverage', r2.metrics.hrEnd === undefined && r2.metrics.hrCoverage < 0.9, r2.metrics);
  ok('recovery after rep 1 measured (+30 s)', r1.metrics.hrRec30 === 155 && r1.metrics.hrDrop30 === 15, r1.metrics);
  ok('per-length HR (first/last) added to each split, SC/SR kept', r1.splits[0].hrFirst === 120 && r1.splits[0].hrLast === 145 && r1.splits[1].hrLast === 170 && !('hrPeak' in r1.splits[1]) && r1.splits[1].sc === 32 && r1.splits[1].sr === 38, r1.splits);
  ok('other readings untouched', r1.metrics.lactate === 2.1 && r2.metrics.lactate === 5.2);
  ok('raw stream kept in conditions.hrStream', eff.conditions.hrStream && eff.conditions.hrStream.samples.length === samples.length && eff.conditions.hrStream.sensor === 'Polar Sense TEST');
  ok('no stream → reps saved exactly as given', !store.reps.filter((r) => r.effortId === i1.data.effortId).some((r) => 'hrPeak' in r.metrics));
}

console.log('\nladder test: level chosen per run');
{
  const ladDef = { key: 'ladder-svc', name: 'Ladder', analyser: 'ladder', measures: ['time', 'sc'],
    set: { fmt: 'swimzone.set/1', name: 'Ladder', poolType: '25SC', blocks: [{ repeats: 1, lines: [
      { type: 'swim', stroke: 'FS', distM: 100, qty: 20, targetRule: { base: 'AT' }, interval: { type: 'fixed', onTime: '1:30', param: 'level' }, intensity: 'AT', measures: ['time', 'sc'] }] }] },
    params: { level: { label: 'Level', kind: 'level', default: 'L1', options: [
      { value: 'L1', label: 'Level 1', qty: 20, onTime: '1:30' }, { value: 'L2', label: 'Level 2', qty: 25, onTime: '1:25' }, { value: 'L3', label: 'Level 3', qty: 30, onTime: '1:20' }] } } };
  const lc = await P.createProtocol(null, ladDef);
  ok('a ladder protocol with levels saves', lc.data && !lc.error, lc.error);
  const lp = (await P.prescribeForAthletes(lc.data.id, [{ id: 'sam', name: 'Sam' }], { chosen: { level: 'L2' } })).data;
  ok('prescription at level 2: 25 reps on 1:25', lp.athletes[0].reps.length === 25 && lp.set.blocks[0].lines[0].interval.onTime === '1:25' && lp.params.level === 'L2');
  const lreps = lp.athletes[0].reps.map((r, i) => ({ repNo: r.repNo, distM: 100, stroke: 'FS', timeSec: 74 + i * 0.1, metrics: { sc: 40 } }));
  const ls = await R.addSetResult('sam', { protocolId: lc.data.id, swumOn: '2026-10-06', sessionId: 'lad-1', set: lp.set, params: lp.params, reps: lreps });
  ok('ladder run saved with level + held in its summary', ls.data && ls.data.summary.level === 'L2' && ls.data.summary.prescribed === 25 && ls.data.summary.held === true, ls.data && ls.data.summary);
  const eff = store.efforts.find((e) => e.id === ls.data.effortId);
  ok('chosen level kept with the run', eff.conditions.params.level === 'L2');
  eff.summary = null;
  await R.reanalyseSetResults(lc.data.id, 'sam');
  ok('recomputing keeps the level (read back from the run)', eff.summary && eff.summary.level === 'L2' && eff.summary.prescribed === 25, eff.summary);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
