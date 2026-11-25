// node src/records/testVersions.test.mjs
import { isCompatible, compatibleSet, levelRank, levelShortLabel, highestHeld } from './testVersions.js';
import { ladderProtocol } from '../../tests/fixtures/ladderRuns.mjs';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };

const v1 = { ...ladderProtocol, id: 'v1', version: 1, ownerOrgId: null };
const opts = [
  { value: 'J1', label: 'Junior 1 — 10×100 on 2:00', qty: 10, onTime: '2:00' },
  ...v1.params.level.options.map((o, i) => ({ ...o, label: `Club ${i + 1}${o.label.slice(o.label.indexOf(' —'))}` })),
  { value: 'N1', label: 'National 1 — 35×100 on 1:15', qty: 35, onTime: '1:15' },
];
const v2 = { ...v1, id: 'v2', version: 2, name: '100s Ladder', params: { level: { ...v1.params.level, options: opts } } };

console.log('\nwhich versions are one history');
// The level rules hold for any test with a level param; the ladder itself is one
// history whatever its versions hold (2026-11-25), so those checks use a non-ladder copy.
const s1 = { ...v1, key: 'lvl-test', analyser: 'series' }, s2 = { ...v2, key: 'lvl-test', analyser: 'series' };
ok('adding levels (and relabelling) keeps v1 compatible', isCompatible(s2, s1));
ok('a changed level is not compatible', !isCompatible({ ...s2, params: { level: { ...v2.params.level, options: opts.map((o) => (o.value === 'L2' ? { ...o, onTime: '1:24' } : o)) } } }, s1));
ok('a removed level is not compatible', !isCompatible({ ...s2, params: { level: { ...v2.params.level, options: opts.filter((o) => o.value !== 'L3') } } }, s1));
ok('a different set is not compatible', !isCompatible({ ...s2, set: { ...v2.set, poolType: '50LC' } }, s1));
const vOpen = { ...v1, id: 'v3', version: 3, params: { sendOff: { kind: 'onTime', label: 'Send-off', default: '1:30', options: ['1:30', '2:00'] } },
  set: { ...v1.set, blocks: [{ repeats: 1, lines: [{ ...v1.set.blocks[0].lines[0], qty: 60, open: true, interval: { type: 'fixed', onTime: '1:30', param: 'sendOff' } }] }] } };
ok('ladder: the open version and the level versions are one history', isCompatible(vOpen, v1) && isCompatible(vOpen, v2) && compatibleSet([v1, v2, vOpen]).versions.length === 3);
ok('a different analyser is not compatible', !isCompatible({ ...v2, analyser: 'series' }, v1));
ok('a club copy (other owner) is not mixed in', !isCompatible({ ...v2, ownerOrgId: 'club-1' }, v1));
const reorder = (x) => (Array.isArray(x) ? x.map(reorder) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).reverse().map((k) => [k, reorder(x[k])])) : x);
ok('key order in JSON does not matter', isCompatible(s2, { ...s1, set: reorder(v1.set) }) && Object.keys(reorder(v1.set))[0] !== Object.keys(v1.set)[0]);
const cs = compatibleSet([v1, v2]);
ok('newest is v2, both versions together', cs.newest.id === 'v2' && cs.versions.map((p) => p.id).join() === 'v2,v1', cs.versions.map((p) => p.id));
ok('incompatible older version left out', compatibleSet([{ ...s1, set: { ...v1.set, poolType: '50LC' } }, s2]).versions.length === 1);

console.log('\nlevels');
ok('rank follows the list (junior lowest)', levelRank(v2, 'J1') === 0 && levelRank(v2, 'L1') === 1 && levelRank(v2, 'N1') === 4);
ok('short label from the newest version', levelShortLabel(v2, 'L2') === 'Club 2' && levelShortLabel(v2, 'J1') === 'Junior 1');
console.log('\ntightest send-off held (2026-11-25)');
const views = [
  { swumOn: '2026-07-04', summary: { held: true, sendOffSec: 90, swum: 20 } },
  { swumOn: '2026-08-29', summary: { held: true, sendOffSec: 85, swum: 25 } },
  { swumOn: '2026-10-03', summary: { held: false, sendOffSec: 80, swum: 30 } },
  { swumOn: '2026-09-20', summary: { held: true, sendOffSec: 85, swum: 25 } },
  { swumOn: '2026-11-25', summary: { held: true, sendOffSec: 120, swum: 16 } },
  { swumOn: '2026-11-26', summary: { held: true, sendOffSec: 85, swum: 18 } },
];
const h = highestHeld(v2, views);
ok('25 × 100 @ 1:25, first held 29 Aug', h.sendOffSec === 85 && h.reps === 25 && h.swumOn === '2026-08-29' && h.label === '25 × 100 @ 1:25', h);
ok('nothing held → null', highestHeld(v2, [{ swumOn: 'x', summary: { held: false, sendOffSec: 80, swum: 30 } }]) === null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
