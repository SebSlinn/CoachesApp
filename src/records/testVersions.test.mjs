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
ok('adding levels (and relabelling) keeps v1 compatible', isCompatible(v2, v1));
ok('a changed level is not compatible', !isCompatible({ ...v2, params: { level: { ...v2.params.level, options: opts.map((o) => (o.value === 'L2' ? { ...o, onTime: '1:24' } : o)) } } }, v1));
ok('a removed level is not compatible', !isCompatible({ ...v2, params: { level: { ...v2.params.level, options: opts.filter((o) => o.value !== 'L3') } } }, v1));
ok('a different set is not compatible', !isCompatible({ ...v2, set: { ...v2.set, poolType: '50LC' } }, v1));
ok('a different analyser is not compatible', !isCompatible({ ...v2, analyser: 'series' }, v1));
ok('a club copy (other owner) is not mixed in', !isCompatible({ ...v2, ownerOrgId: 'club-1' }, v1));
const reorder = (x) => (Array.isArray(x) ? x.map(reorder) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).reverse().map((k) => [k, reorder(x[k])])) : x);
ok('key order in JSON does not matter', isCompatible(v2, { ...v1, set: reorder(v1.set) }) && Object.keys(reorder(v1.set))[0] !== Object.keys(v1.set)[0]);
const cs = compatibleSet([v1, v2]);
ok('newest is v2, both versions together', cs.newest.id === 'v2' && cs.versions.map((p) => p.id).join() === 'v2,v1', cs.versions.map((p) => p.id));
ok('incompatible older version left out', compatibleSet([{ ...v1, analyser: 'series' }, v2]).versions.length === 1);

console.log('\nlevels');
ok('rank follows the list (junior lowest)', levelRank(v2, 'J1') === 0 && levelRank(v2, 'L1') === 1 && levelRank(v2, 'N1') === 4);
ok('short label from the newest version', levelShortLabel(v2, 'L2') === 'Club 2' && levelShortLabel(v2, 'J1') === 'Junior 1');
const views = [
  { level: 'L1', swumOn: '2026-07-04', summary: { held: true } },
  { level: 'L2', swumOn: '2026-08-29', summary: { held: true } },
  { level: 'L3', swumOn: '2026-10-03', summary: { held: false } },
  { level: 'L2', swumOn: '2026-09-20', summary: { held: true } },
];
const h = highestHeld(v2, views);
ok('highest held is Club 2, first held 29 Aug', h.value === 'L2' && h.swumOn === '2026-08-29' && h.label === 'Club 2', h);
ok('nothing held → null', highestHeld(v2, [{ level: 'L3', swumOn: 'x', summary: { held: false } }]) === null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
