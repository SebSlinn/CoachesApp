// node src/records/testReport.test.mjs
import { buildRunView, compareRuns, toCsv, summaryRows, fmtTime, fmtDelta, CSV_COLUMNS, exportFileName } from './testReport.js';
import { ladderProtocol, ladderRuns } from '../../tests/fixtures/ladderRuns.mjs';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };

console.log('\none run, comprehensive');
const v2 = buildRunView(ladderProtocol, ladderRuns[1]);
ok('20 reps, all swum', v2.reps.length === 20 && v2.swum === 20 && v2.prescribed === 20, [v2.reps.length, v2.swum, v2.prescribed]);
ok('level and settings text', v2.level === 'L1' && v2.paramText === 'Level 1 — 20×100 on 1:30', v2.paramText);
ok('send-off from the snapshot → rest = 90 − time', v2.reps[0].sendOffSec === 90 && v2.reps[0].restSec === +(90 - v2.reps[0].timeSec).toFixed(2), v2.reps[0]);
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
ok('error summary shown as text', summaryRows({ analyser: 'css', error: 'needs one 400 and one 200' })[0].value === 'needs one 400 and one 200');
ok('blocks list each block', summaryRows({ analyser: 'blocks', dropOffSec: 0.8, blocks: [{ n: 10, distM: 100, stroke: 'FS', meanSec: 75 }, { n: 10, distM: 100, stroke: 'FS', meanSec: 75.8 }] }).length === 3);

console.log('\nside by side');
const cmp = compareRuns(ladderRuns.map((r) => buildRunView(ladderProtocol, r)).reverse());
ok('runs oldest → newest regardless of input order', cmp.runs.map((r) => r.id).join() === 'run-1,run-2,run-3');
ok('labels carry level', cmp.labels[2] === '3 Oct 2026 · L2', cmp.labels);
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
ok('row starts with athlete, test, run', lines[1].startsWith('Esme Slinn,100s Ladder (20 · 25 · 30),ladder-100s,1,2026-07-04,L1,'), lines[1]);
ok('settings column', /,Level 1 — 20×100 on 1:30,/.test(lines[1]));
ok('note with comma is quoted', toCsv({}, [{ ...cmp.runs[0], reps: [{ ...cmp.runs[0].reps[0], note: 'tired, slow turn' }] }]).includes('"tired, slow turn"'));

console.log('\nformatting');
ok('times', fmtTime(31.2) === '31.20' && fmtTime(72.456) === '1:12.46' && fmtTime(59.999) === '1:00.00' && fmtTime(null) === '');
ok('deltas', fmtDelta(0.42) === '+0.42' && fmtDelta(-1.2) === '−1.20' && fmtDelta(0) === '±0.00');
ok('file name', /^\d{4}-\d{2}-\d{2}_Esme-Slinn_ladder-100s\.xlsx$/.test(exportFileName({ athleteName: 'Esme Slinn', testKey: 'ladder-100s' }, 'xlsx')));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
