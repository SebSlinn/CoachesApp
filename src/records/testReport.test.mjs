// node src/records/testReport.test.mjs
import { buildRunView, compareRuns, toCsv, summaryRows, fmtTime, fmtDelta, CSV_COLUMNS, exportFileName } from './testReport.js';
import { ladderProtocol, ladderRuns } from '../../tests/fixtures/ladderRuns.mjs';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };

console.log('\none run, comprehensive');
const v2 = buildRunView(ladderProtocol, ladderRuns[1]);
ok('20 reps, all swum', v2.reps.length === 20 && v2.swum === 20 && v2.prescribed === 20, [v2.reps.length, v2.swum, v2.prescribed]);
ok('level and settings text', v2.level === 'L1' && v2.paramText === 'Level 1 — 20×100 on 1:30', v2.paramText);
const rr1 = v2.reps[0], r2s = v2.reps[1];
const measured = +((Date.parse(r2s.startedAt) - Date.parse(rr1.startedAt)) / 1000 - rr1.timeSec).toFixed(2);
ok('rest after rep 1 measured from start times (next start − this finish)', rr1.restFrom === 'measured' && rr1.restSec === measured && measured !== +(90 - rr1.timeSec).toFixed(2), [rr1.restSec, measured]);
ok('no rest after the last rep', v2.reps[19].restSec === null && v2.reps[19].restFrom === null, v2.reps[19]);
const v1 = buildRunView(ladderProtocol, ladderRuns[0]);
ok('no start times saved → estimate from the send-off (90 − time)', v1.reps[0].restFrom === 'send-off' && v1.reps[0].restSec === +(90 - v1.reps[0].timeSec).toFixed(2), v1.reps[0]);
ok('…still none after the last rep', v1.reps[19].restSec === null);
ok('pace per 100', v2.reps[0].pace100Sec === v2.reps[0].timeSec);
ok('lengths from cumulative splits', v2.reps[0].lengths.length === 4 && v2.reps[0].lengths[3].cumSec === v2.reps[0].timeSec, v2.reps[0].lengths);
ok('HR columns carried', v2.reps[0].hrPeak === 163 && v2.has.includes('hrPeak'));
ok('empty columns not flagged (no lactate)', !v2.has.includes('lactate'));
ok('summary rows labelled, held first', v2.summaryRows[0].key === 'held' && v2.summaryRows[0].value === true && v2.summaryRows[1].label === 'Average pace per 100', v2.summaryRows.slice(0, 2));
const v3 = buildRunView(ladderProtocol, ladderRuns[2]);
ok('L2 run: 25 prescribed, one not timed', v3.prescribed === 25 && v3.swum === 24, [v3.prescribed, v3.swum]);
ok('L2 send-off 1:25', v3.reps[0].sendOffSec === 85);
ok('L2 not held (a rep missing)', v3.summary.held === false);
ok('settings for L2', v3.paramText === 'Level 2 — 25×100 on 1:25');

console.log('\nsummary recomputed when missing');
const bare = buildRunView(ladderProtocol, { ...ladderRuns[0], summary: null });
ok('analyser re-run from reps', bare.summary.analyser === 'ladder' && bare.summary.swum === 20, bare.summary);
const moved = buildRunView(ladderProtocol, { ...ladderRuns[0], summary: { analyser: 'series', v: 1, n: 20, meanSec: 74.8 } });
ok('a summary from another test (moved run) is recalculated by the ladder', moved.summary.analyser === 'ladder' && moved.summary.held === true, moved.summary);
ok('error summary shown as text', summaryRows({ analyser: 'css', error: 'needs one 400 and one 200' })[0].value === 'needs one 400 and one 200');
ok('blocks list each block', summaryRows({ analyser: 'blocks', dropOffSec: 0.8, blocks: [{ n: 10, distM: 100, stroke: 'FS', meanSec: 75 }, { n: 10, distM: 100, stroke: 'FS', meanSec: 75.8 }] }).length === 3);

console.log('\nside by side');
const cmp = compareRuns(ladderRuns.map((r) => buildRunView(ladderProtocol, r)).reverse());
ok('runs oldest → newest regardless of input order', cmp.runs.map((r) => r.id).join() === 'run-1,run-2,run-3');
ok('labels carry the level name', cmp.labels[2] === '3 Oct 2026 · Level 2', cmp.labels);
ok('levels differ flagged', cmp.levelsDiffer === true);
ok('rep rows to the longest prescribed set (25)', cmp.reps.length === 25 && cmp.reps[24].swim === '100 Free' && cmp.reps[24].times.every((t) => t == null), cmp.reps[24]);
const r21 = cmp.reps[20];
ok('rep 21 only in the L2 run → no "fastest" mark', r21.times[0] == null && r21.times[2] != null && r21.best.length === 0, r21);
const r1 = cmp.reps[0];
ok('rep 1 fastest marked', r1.best.length === 1 && r1.best[0] === r1.times.indexOf(Math.min(...r1.times)), r1);
ok('untimed prescribed rep 25 is not "extra"', cmp.reps[24].extra === false);
const pace = cmp.summary.find((s) => s.key === 'per100Sec');
ok('pace row: best = lowest, change newest − oldest', pace.best[0] === pace.values.indexOf(Math.min(...pace.values)) && pace.change === +(pace.values[2] - pace.values[0]).toFixed(2), pace);
const sc5 = cmp.summary.find((s) => s.key === 'first5Sc');
ok('all-equal row marks nothing', sc5.values.every((v) => v === sc5.values[0]) && sc5.best.length === 0, sc5);
const lastSc = cmp.summary.find((s) => s.key === 'last5Sc');
ok('tied best marks both', lastSc.values[0] === lastSc.values[1] && lastSc.best.join() === '0,1', lastSc);
const held = cmp.summary.find((s) => s.key === 'held');
ok('held row is text-like, no change', held.change === null && held.best.length === 0);

console.log('\nCSV');
const csv = toCsv({ athleteName: 'Esme Slinn', testName: '100s Ladder (20 · 25 · 30)', testKey: 'ladder-100s', testVersion: 1 }, cmp.runs);
const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
ok('BOM for Excel', csv.charCodeAt(0) === 0xfeff);
ok('one row per rep per run + header', lines.length === 1 + 20 + 20 + 24, lines.length);
ok('header names', lines[0].split(',').length === CSV_COLUMNS.length && lines[0].startsWith('athlete,test,test_key'));
ok('row starts with athlete, test, run', lines[1].startsWith('Esme Slinn,100s Ladder (20 · 25 · 30),ladder-100s,1,2026-07-04,Level 1,'), lines[1]);
ok('settings column', /,Level 1 — 20×100 on 1:30,/.test(lines[1]));
ok('note with comma is quoted', toCsv({}, [{ ...cmp.runs[0], reps: [{ ...cmp.runs[0].reps[0], note: 'tired, slow turn' }] }]).includes('"tired, slow turn"'));

console.log('\nflushes (2026-10-25): inline, reps stay aligned');
{
  const base = ladderRuns[1];
  // same run twice: one with a flush after rep 5, one with two flushes after rep 5 and one before rep 1
  const flushed = { ...base, id: 'run-f', swumOn: '2026-10-24', conditions: { ...(base.conditions || {}), recoveries: [
    { afterRepNo: 5, distM: 50, stroke: 'FS', timeSec: 45.2, startedAt: '2026-10-24T08:10:00Z' },
  ] } };
  const flushed2 = { ...base, id: 'run-g', swumOn: '2026-10-25', conditions: { ...(base.conditions || {}), recoveries: [
    { afterRepNo: 0, distM: 100, timeSec: 90 },
    { afterRepNo: 5, distM: 50, timeSec: 40 }, { afterRepNo: 5, distM: 50, timeSec: 41.5 },
  ] } };
  const vf = buildRunView(ladderProtocol, flushed);
  ok('flushes read from conditions.recoveries', vf.flushes.length === 1 && vf.flushes[0].afterRepNo === 5 && vf.flushes[0].timeSec === 45.2, vf.flushes);
  ok('flush hangs off the rep it follows; reps keep their numbers', vf.reps[4].flushAfter?.length === 1 && vf.reps[5].repNo === 6 && vf.reps.length === 20);
  const cf = compareRuns([buildRunView(ladderProtocol, base), vf, buildRunView(ladderProtocol, flushed2)]);
  const kinds = cf.rows.map((r) => (r.kind === 'flush' ? 'f' + r.afterRepNo : r.repNo));
  ok('rows: flush before rep 1, reps 1–5, flush, rep 6…', kinds.slice(0, 8).join() === 'f0,1,2,3,4,5,f5,6', kinds.slice(0, 8));
  const f5 = cf.rows.find((r) => r.kind === 'flush' && r.afterRepNo === 5);
  ok('flush row: blank for the run without one, summed for two', f5.cells[0] === null && f5.cells[1].timeSec === 45.2 && f5.cells[2].timeSec === 81.5 && f5.cells[2].count === 2, f5.cells);
  ok('rep 7 sits next to rep 7 in every run', cf.rows.filter((r) => r.kind === 'rep' && r.repNo === 7).length === 1 && cf.reps.length === 20);
  ok('stats rows (cmp.reps) carry no flushes', cf.reps.every((r) => r.repNo >= 1));
  const fcsv = toCsv({}, [vf]).replace(/^﻿/, '').trim().split('\r\n');
  const hdr = fcsv[0].split(',');
  const fl = fcsv.findIndex((l) => l.split(',')[hdr.indexOf('flush_after_rep')] === '5');
  ok('CSV: flush row straight after rep 5, no rep number', fl === 6 && fcsv[fl].split(',')[hdr.indexOf('rep')] === '' && fcsv[fl - 1].split(',')[hdr.indexOf('rep')] === '5', [fl, fcsv[fl]]);
}

console.log('\nformatting');
ok('times', fmtTime(31.2) === '31.20' && fmtTime(72.456) === '1:12.46' && fmtTime(59.999) === '1:00.00' && fmtTime(null) === '');
ok('deltas', fmtDelta(0.42) === '+0.42' && fmtDelta(-1.2) === '−1.20' && fmtDelta(0) === '±0.00');
ok('file name', /^\d{4}-\d{2}-\d{2}_Esme-Slinn_ladder-100s\.xlsx$/.test(exportFileName({ athleteName: 'Esme Slinn', testKey: 'ladder-100s' }, 'xlsx')));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
