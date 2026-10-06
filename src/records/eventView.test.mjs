// node src/records/eventView.test.mjs
import { courseOf, eventSlug, parseEventSlug, annotateEvent, eventSummary, courseOrder, lapSplits, kindLabel } from './eventView.js';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };

console.log('\nevent keys & courses');
ok('slug round-trips', JSON.stringify(parseEventSlug(eventSlug('FS', 100))) === JSON.stringify({ distM: 100, stroke: 'FS' }));
ok('Fly slug', parseEventSlug('200-Fly').stroke === 'Fly');
ok('bad slug → null', parseEventSlug('FS100') === null);
ok('courses', courseOf('50LC') === 'LC' && courseOf('25SC') === 'SC' && courseOf('25Y') === 'SCY' && courseOf(null) === 'unknown');

console.log('\nPB at the time, per course');
const rows = [
  { id: 'c', swumOn: '2026-03-01', timeSec: 66.0, poolType: '25SC', effort: 'maximal' },
  { id: 'a', swumOn: '2026-01-10', timeSec: 70.0, poolType: '50LC', effort: 'maximal' },
  { id: 'b', swumOn: '2026-02-01', timeSec: 68.5, poolType: '50LC', effort: 'maximal' },
  { id: 'd', swumOn: '2026-04-01', timeSec: 69.0, poolType: '50LC', effort: 'maximal' },   // slower than LC PB
  { id: 'e', swumOn: '2026-05-01', timeSec: 60.0, poolType: '50LC', effort: 'submaximal' },// never a PB
  { id: 'f', swumOn: '2026-06-01', timeSec: 67.9, poolType: '50LC', effort: 'maximal' },
];
const a = annotateEvent(rows);
const by = Object.fromEntries(a.map((r) => [r.id, r]));
ok('sorted oldest → newest', a.map((r) => r.id).join('') === 'abcdef', a.map((r) => r.id));
ok('first LC swim is a PB with no gain', by.a.isPB && by.a.gainSec === null);
ok('second LC swim beats it by 1.5', by.b.isPB && by.b.gainSec === 1.5, by.b);
ok('SC swim is its own course PB (not compared to LC)', by.c.isPB && by.c.prevBest === null);
ok('slower swim is not a PB, carries the PB it chased', !by.d.isPB && by.d.prevBest === 68.5);
ok('submaximal never a PB', !by.e.isPB);
ok('current LC PB is the latest faster swim', by.f.isCurrentPB && !by.b.isCurrentPB);
ok('current SC PB', by.c.isCurrentPB);
const s = eventSummary(a);
ok('summary per course', s.LC.count === 5 && s.SC.count === 1 && s.LC.pb.id === 'f', s);
ok('total LC gain first → PB', s.LC.totalGainSec === 2.1, s.LC.totalGainSec);
ok('course order', courseOrder(s).join() === 'LC,SC');
const tie = annotateEvent([{ id: 'x', swumOn: '2026-01-01', timeSec: 30, poolType: '25SC' }, { id: 'y', swumOn: '2026-02-01', timeSec: 30, poolType: '25SC' }]);
ok('a tie does not re-set the PB', tie[0].isCurrentPB && !tie[1].isPB);

console.log('\nlap splits');
const cum = lapSplits([{ dist: 50, sec: 31.2, sc: 18 }, { dist: 100, sec: 65.0, sc: 20 }], 100);
ok('cumulative → laps', cum[0].lapSec === 31.2 && cum[1].lapSec === 33.8 && cum[1].cumSec === 65, cum);
ok('lap distance', cum[1].lapDist === 50);
ok('per-length extras kept', cum[1].extra.sc === 20);
const laps = lapSplits([31.2, 33.8], 100);
ok('plain lap numbers (not increasing) → cumulative built', laps[1].cumSec === 65 && laps[1].lapSec === 33.8 && laps[1].dist === 100, laps);
const plainCum = lapSplits([31.2, 65.0], 100);
ok('plain increasing numbers read as cumulative', plainCum[1].lapSec === 33.8 && plainCum[0].dist === 50, plainCum);
ok('no splits → []', lapSplits(null, 100).length === 0);

console.log('\nlabels');
ok('kind labels', kindLabel({ kind: 'meet' }) === 'Competition' && kindLabel({ kind: 'time_trial' }) === 'Time trial');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
