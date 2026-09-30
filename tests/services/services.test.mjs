import { store } from './mockFactory.js';
import * as P from '../../src/services/protocols.js';
import * as R from '../../src/services/results.js';
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };

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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
