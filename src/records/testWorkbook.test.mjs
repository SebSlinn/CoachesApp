// node src/records/testWorkbook.test.mjs  [out.xlsx]
// Builds the Excel export from the sample ladder runs and checks its structure.
// Pass a path to also write the file (to open it, or to recalc/render it).
import ExcelJS from 'exceljs';
import { buildTestWorkbook } from './testWorkbook.js';
import { buildRunView } from './testReport.js';
import { ladderProtocol, ladderRuns } from '../../tests/fixtures/ladderRuns.mjs';

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : '  → ' + JSON.stringify(x))); };

const meta = { athleteName: 'Esme Slinn', testName: ladderProtocol.name, testKey: ladderProtocol.key, testVersion: 1 };
const views = ladderRuns.map((r) => buildRunView(ladderProtocol, r));
const wb = await buildTestWorkbook(meta, views, { ExcelJS });

console.log('\nworkbook');
const names = wb.worksheets.map((w) => w.name);
ok('sheets: summary, reps, one per run, data', names.join('|') === 'Summary|Reps compared|Run 4 Jul 2026 · L1|Run 29 Aug 2026 · L1|Run 3 Oct 2026 · L2|Data', names);
const formulas = [];
wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => { if (c.value && c.value.formula) formulas.push({ ws: ws.name, f: c.value.formula, result: c.value.result }); })));
ok('formulas carry results (show without recalculation; a zero change is the one ExcelJS leaves for Excel to fill)', formulas.length > 60 && formulas.every((f) => f.result != null || /^ROUND\([A-Z]+\d+-[A-Z]+\d+,2\)$/.test(f.f)), formulas.filter((f) => f.result == null));
ok('Excel recalculates on open', wb.calcProperties.fullCalcOnLoad === true);
const reps = wb.getWorksheet('Reps compared');
let timeCell = null;
reps.eachRow((row) => row.eachCell((c) => { if (!timeCell && typeof c.value === 'number' && c.value < 0.01 && c.numFmt) timeCell = c; }));
ok('rep times are real Excel times with the swim-time format', timeCell && /\[m\]:ss\.00/.test(timeCell.numFmt), timeCell && timeCell.numFmt);
ok('fastest-per-rep rule on the compared reps', reps.conditionalFormattings && reps.conditionalFormattings.length === 1);
const run2 = wb.getWorksheet('Run 29 Aug 2026 · L1');
const header = [];
run2.eachRow((row) => { if (row.getCell(1).value === 'Rep') row.eachCell((c) => header.push(c.value)); });
ok('run sheet shows only the columns it has (HR yes, lactate no)', header.includes('HR peak') && !header.some((h) => /Lactate/.test(h)), header);
const data = wb.getWorksheet('Data');
ok('data table: one row per rep per run', data.getTable('TestReps') && data.rowCount === 1 + 20 + 20 + 24, data.rowCount);
const buf = await wb.xlsx.writeBuffer();
ok('writes a non-empty .xlsx', buf.byteLength > 10000, buf.byteLength);
if (process.argv[2]) { await wb.xlsx.writeFile(process.argv[2]); console.log('  wrote ' + process.argv[2]); }

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
