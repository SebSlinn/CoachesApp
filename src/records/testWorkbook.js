// src/records/testWorkbook.js
// The formatted Excel download for test-set results, built in the browser from
// the same model as the screen and the CSV (records/testReport.js).
//
//   Summary        — the runs side by side: when, level, the analyser's
//                    numbers, best per row, change newest vs oldest (formula)
//   Reps compared  — rep × run times; fastest per rep highlighted by a rule,
//                    average / fastest / slowest / spread as formulas
//   one sheet per run — everything about that run: details, results, every rep
//                    (pace, rest, vs target as formulas), per-length splits
//   Data           — one row per rep per run, as a filterable Excel table, for
//                    pivot tables and charts (same columns as the CSV)
//
// Times are real Excel times (fraction of a day) shown as 31.20 / 1:12.46, so
// they sort, average and chart like numbers. Seconds differences are plain
// numbers. ExcelJS is loaded only when a download is asked for.
import { compareRuns, fmtDay, CSV_COLUMNS, fmtTime } from './testReport.js';

const FONT = 'Arial';
const INK = 'FF1F2430', MUTED = 'FF6B7280', RULE = 'FFD9DDE3';
const HEAD_BG = 'FF1A1A2E', HEAD_INK = 'FFFFFFFF';
const BAND = 'FFF5F7FA', GOOD_BG = 'FFDDF3E6', GOOD_INK = 'FF17663E', WARN_BG = 'FFFFF1D6';
const TIME_FMT = '[<0.000694444]ss.00;[m]:ss.00';      // 31.20 under a minute, 1:12.46 above
const DELTA_FMT = '+0.00;-0.00;0.00';
const SEC_FMT = '0.00';
const CLOCK_FMT = '[m]:ss';                               // send-offs: 1:30
const DAY = 86400;

const T = (sec) => (sec == null ? null : sec / DAY);   // seconds → Excel time
const colL = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

function sheetName(pBase, pUsed) {
  let n = String(pBase).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim();
  let k = 2;
  while (pUsed.has(n.toLowerCase())) { const sfx = ` (${k++})`; n = n.slice(0, 31 - sfx.length) + sfx; }
  pUsed.add(n.toLowerCase());
  return n;
}

function style(cell, { bold, size, color, fill, fmt, align, italic, wrap, border } = {}) {
  cell.font = { name: FONT, size: size || 10, bold: !!bold, italic: !!italic, color: { argb: color || INK } };
  if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  if (fmt) cell.numFmt = fmt;
  cell.alignment = { horizontal: align, vertical: 'middle', wrapText: !!wrap };
  if (border) cell.border = { bottom: { style: 'thin', color: { argb: RULE } } };
}

function headerRow(ws, pRow, pLabels, { from = 1, aligns = [] } = {}) {
  const row = ws.getRow(pRow);
  pLabels.forEach((h, i) => {
    const c = row.getCell(from + i);
    c.value = h;
    style(c, { bold: true, color: HEAD_INK, fill: HEAD_BG, align: aligns[i] || (i === 0 ? 'left' : 'right'), wrap: true });
  });
  row.height = 30;
}

function titleBlock(ws, pTitle, pLines, { valueCol = 2 } = {}) {
  ws.getCell('A1').value = pTitle;
  style(ws.getCell('A1'), { bold: true, size: 15 });
  ws.getRow(1).height = 24;
  pLines.forEach(([k, v], i) => {
    const r = 2 + i;
    ws.getCell(r, 1).value = k; style(ws.getCell(r, 1), { color: MUTED });
    ws.getCell(r, valueCol).value = v; style(ws.getCell(r, valueCol));
  });
  return 2 + pLines.length + 1;   // next free row, after a gap
}

// value + format for a summary-row value of a given kind
function kindCell(kind, v) {
  if (v == null) return { value: null };
  if (kind === 'time') return { value: T(v), fmt: TIME_FMT };
  if (kind === 'delta') return { value: v, fmt: DELTA_FMT };
  if (kind === 'sec') return { value: v, fmt: SEC_FMT };
  if (kind === 'bool') return { value: v ? 'Yes' : 'No' };
  return { value: v, fmt: typeof v === 'number' && !Number.isInteger(v) ? '0.0#' : undefined };
}

export async function buildTestWorkbook(pMeta, pRunViews, { ExcelJS } = {}) {
  const XL = ExcelJS || (await import('exceljs')).default;
  const wb = new XL.Workbook();
  wb.creator = 'SwimZone';
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };   // Excel recalculates on open (ExcelJS can't store a cached 0)
  const used = new Set();
  const cmp = compareRuns(pRunViews);
  const runs = cmp.runs;
  const exported = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const SUMMARY = sheetName('Summary', used), REPS = sheetName('Reps compared', used);
  const names = runs.map((rv, i) => sheetName(`Run ${cmp.labels[i]}`, used));
  const DATA = sheetName('Data', used);

  // ── Summary ────────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet(SUMMARY, { views: [{ showGridLines: false }] });
    let r = titleBlock(ws, pMeta.testName, [
      ['Athlete', pMeta.athleteName],
      ['Test', `${pMeta.testKey} · version ${pMeta.testVersion}`],
      ['Runs', `${runs.length} (${cmp.labels[0]} to ${cmp.labels[runs.length - 1]})`],
      ...(pMeta.highestHeld ? [['Highest level held', pMeta.highestHeld]] : []),
      ['Exported', `${exported} from SwimZone`],
    ]);
    const nRuns = runs.length;
    const changeCol = 2 + nRuns;
    headerRow(ws, r, ['Measure', ...cmp.labels, ...(nRuns > 1 ? ['Change, newest vs oldest'] : [])]);
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: r, showGridLines: false }];
    r++;
    const info = [
      ['Date', runs.map((rv) => fmtDay(rv.swumOn))],
      ['Settings', runs.map((rv) => rv.paramText || '—')],
      ['Pool', runs.map((rv) => rv.poolType || '—')],
      ['Location', runs.map((rv) => rv.location || '—')],
      ['Reps timed', runs.map((rv) => `${rv.swum} of ${rv.prescribed}`)],
    ];
    for (const [label, vals] of info) {
      ws.getCell(r, 1).value = label; style(ws.getCell(r, 1), { color: MUTED, border: true });
      vals.forEach((v, i) => { const c = ws.getCell(r, 2 + i); c.value = v; style(c, { align: 'right', border: true, wrap: true }); });
      if (nRuns > 1) style(ws.getCell(r, changeCol), { border: true });
      r++;
    }
    r++;
    ws.getCell(r, 1).value = 'Results'; style(ws.getCell(r, 1), { bold: true, size: 11 });
    r++;
    cmp.summary.forEach((row, ri) => {
      const band = ri % 2 ? BAND : undefined;
      const lc = ws.getCell(r, 1);
      lc.value = row.unit ? `${row.label} (${row.unit})` : row.label;
      style(lc, { fill: band });
      row.values.forEach((v, i) => {
        const c = ws.getCell(r, 2 + i);
        const k = kindCell(row.kind, v);
        c.value = k.value ?? '—';
        const best = row.best.includes(i);
        style(c, { align: 'right', fmt: k.fmt, fill: best ? GOOD_BG : band, bold: best, color: best ? GOOD_INK : (k.value == null ? MUTED : INK) });
      });
      if (nRuns > 1) {
        const c = ws.getCell(r, changeCol);
        const a = `${colL(2)}${r}`, b = `${colL(1 + nRuns)}${r}`;
        if (row.change != null && row.values[0] != null && row.values[nRuns - 1] != null) {
          // seconds for times; plain difference otherwise
          c.value = row.kind === 'time'
            ? { formula: `ROUND((${b}-${a})*${DAY},2)`, result: row.change }
            : { formula: `ROUND(${b}-${a},2)`, result: row.change };
          const ints = row.values.every((v) => v == null || Number.isInteger(v));
          style(c, { align: 'right', fmt: row.kind === 'num' && ints ? '+0;-0;0' : row.kind === 'num' ? '+0.0;-0.0;0' : DELTA_FMT, fill: band });
        } else style(c, { fill: band });
      }
      r++;
    });
    r++;
    const notes = [
      'Green marks the best run for each measure (lowest time, fade or stroke count; highest speed or rest).',
      'Change is newest minus oldest: a negative time or fade means faster or less slowing.',
      cmp.levelsDiffer ? 'These runs were at different levels. A tighter send-off naturally means a slower pace, so compare runs at the same level, or use the fade and stroke-count rows.' : null,
      'Results are worked out by SwimZone from the timed reps. Each run has its own sheet with every rep.',
    ].filter(Boolean);
    for (const n of notes) {
      ws.mergeCells(r, 1, r, Math.max(4, changeCol));
      const c = ws.getCell(r, 1); c.value = n; style(c, { color: MUTED, italic: true, wrap: true });
      ws.getRow(r).height = n.length > 110 ? 28 : 15;
      r++;
    }
    ws.getColumn(1).width = 34;
    for (let i = 0; i < nRuns; i++) ws.getColumn(2 + i).width = 20;
    if (nRuns > 1) ws.getColumn(changeCol).width = 16;
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  }

  // ── Reps compared ─────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet(REPS, { views: [{ showGridLines: false }] });
    let r = titleBlock(ws, `${pMeta.testName}: rep by rep`, [['Athlete', pMeta.athleteName]], { valueCol: 3 });
    const nRuns = runs.length;
    headerRow(ws, r, ['Rep', 'Swim', ...cmp.labels], { aligns: ['left', 'left'] });
    const head = r;
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: head, showGridLines: false }];
    r++;
    const first = r;
    cmp.reps.forEach((row, ri) => {
      const band = ri % 2 ? BAND : undefined;
      ws.getCell(r, 1).value = row.repNo; style(ws.getCell(r, 1), { fill: band, align: 'left' });
      ws.getCell(r, 2).value = row.swim + (row.extra ? ' (extra)' : ''); style(ws.getCell(r, 2), { fill: band });
      row.times.forEach((t, i) => {
        const c = ws.getCell(r, 3 + i);
        const rv = runs[i];
        const missing = t == null && row.repNo <= (rv.prescribed || 0);
        c.value = t != null ? T(t) : (missing ? 'not timed' : null);
        style(c, { fill: band, align: 'right', fmt: TIME_FMT, color: t == null ? MUTED : INK, italic: t == null });
      });
      r++;
    });
    const last = r - 1;
    if (nRuns > 1 && last >= first) {
      const ref = `${colL(3)}${first}:${colL(2 + nRuns)}${last}`;
      ws.addConditionalFormatting({ ref, rules: [{ type: 'expression', priority: 1,
        formulae: [`AND(ISNUMBER(${colL(3)}${first}),COUNT($${colL(3)}${first}:$${colL(2 + nRuns)}${first})>1,${colL(3)}${first}=MIN($${colL(3)}${first}:$${colL(2 + nRuns)}${first}))`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GOOD_BG } }, font: { bold: true, color: { argb: GOOD_INK } } } }] });
    }
    // formula rows
    const stats = [
      ['Average', 'AVERAGE', TIME_FMT, (ts) => ts.reduce((a, b) => a + b, 0) / ts.length],
      ['Fastest', 'MIN', TIME_FMT, (ts) => Math.min(...ts)],
      ['Slowest', 'MAX', TIME_FMT, (ts) => Math.max(...ts)],
      ['Spread (s)', 'SPREAD', SEC_FMT, (ts) => Math.max(...ts) - Math.min(...ts)],
    ];
    stats.forEach(([label, fn, fmt, calc], si) => {
      ws.getCell(r, 2).value = label;
      style(ws.getCell(r, 2), { bold: true, border: si === 0 });
      runs.forEach((rv, i) => {
        const col = colL(3 + i), rng = `${col}${first}:${col}${last}`;
        const ts = cmp.reps.map((x) => x.times[i]).filter((x) => x != null);
        const c = ws.getCell(r, 3 + i);
        if (!ts.length) { c.value = null; return; }
        const res = calc(ts);
        c.value = fn === 'SPREAD'
          ? { formula: `ROUND((MAX(${rng})-MIN(${rng}))*${DAY},2)`, result: Math.round(res * 100) / 100 }
          : { formula: `${fn}(${rng})`, result: res / DAY };
        style(c, { bold: true, align: 'right', fmt });
      });
      r++;
    });
    r++;
    ws.mergeCells(r, 1, r, Math.max(4, 2 + nRuns));
    ws.getCell(r, 1).value = 'Green is the fastest run for that rep. Reps beyond a shorter level are left blank; "not timed" means the rep was in the set but has no time.';
    style(ws.getCell(r, 1), { color: MUTED, italic: true, wrap: true });
    ws.getRow(r).height = 28;
    ws.getColumn(1).width = 6; ws.getColumn(2).width = 14;
    for (let i = 0; i < nRuns; i++) ws.getColumn(3 + i).width = 18;
    ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: `${head}:${head}` };
  }

  // ── One sheet per run ─────────────────────────────────────────────────────
  runs.forEach((rv, ri) => {
    const ws = wb.addWorksheet(names[ri], { views: [{ showGridLines: false }] });
    let r = titleBlock(ws, `${pMeta.testName}: ${fmtDay(rv.swumOn)}`, [
      ['Athlete', pMeta.athleteName],
      ['Settings', rv.paramText || '—'],
      ['Pool', rv.poolType || '—'],
      ['Location', rv.location || '—'],
      ['Reps timed', `${rv.swum} of ${rv.prescribed}`],
      ...(rv.hasHrStream ? [['Heart rate', 'Recorded by a sensor during the set']] : []),
    ], { valueCol: 4 });

    // results block
    ws.getCell(r, 1).value = 'Results'; style(ws.getCell(r, 1), { bold: true, size: 11 });
    r++;
    for (const row of rv.summaryRows) {
      ws.getCell(r, 1).value = row.unit ? `${row.label} (${row.unit})` : row.label;
      for (let k = 1; k <= 4; k++) style(ws.getCell(r, k), { color: k === 1 ? MUTED : INK, border: true });
      const k = kindCell(row.kind, row.value);
      const c = ws.getCell(r, 4); c.value = k.value; style(c, { fmt: k.fmt, align: 'right', bold: true, border: true });
      r++;
    }
    r++;

    // rep table — columns this run actually has
    const cols = [
      { h: 'Rep', w: 7, get: (x) => x.repNo, align: 'left' },
      { h: 'Distance (m)', w: 10, get: (x) => x.distM },
      { h: 'Stroke', w: 8, get: (x) => x.stroke, align: 'left' },
      { h: 'Send-off', w: 10, get: (x) => T(x.sendOffSec), fmt: CLOCK_FMT, show: rv.reps.some((x) => x.sendOffSec != null) },
      { h: 'Target', w: 10, get: (x) => T(x.targetSec), fmt: TIME_FMT, show: rv.has.includes('targetSec') },
      { h: 'Time', w: 10, get: (x) => T(x.timeSec), fmt: TIME_FMT, bold: true },
      { h: 'vs target (s)', w: 11, fmt: DELTA_FMT, show: rv.has.includes('targetSec'),
        formula: (c, row) => c.Target && c.Time && row.timeSec != null && row.targetSec != null ? { formula: `ROUND((${c.Time}-${c.Target})*${DAY},2)`, result: row.vsTargetSec } : null },
      { h: 'Rest after (s)', w: 10, fmt: SEC_FMT, show: rv.reps.some((x) => x.sendOffSec != null),
        formula: (c, row) => row.timeSec != null && row.sendOffSec != null ? { formula: `ROUND((${c['Send-off']}-${c.Time})*${DAY},2)`, result: row.restSec } : null },
      { h: 'Pace per 100', w: 11, fmt: TIME_FMT, show: rv.reps.some((x) => x.distM !== 100),
        formula: (c, row) => row.timeSec != null && row.distM ? { formula: `${c.Time}/${c['Distance (m)']}*100`, result: T(row.pace100Sec) } : null },
      { h: 'Strokes', w: 8, get: (x) => x.sc, show: rv.has.includes('sc') },
      { h: 'Stroke rate', w: 9, get: (x) => x.sr, fmt: '0', show: rv.has.includes('sr') },
      { h: 'HR start', w: 8, get: (x) => x.hrStart, show: rv.has.includes('hrStart') },
      { h: 'HR min', w: 8, get: (x) => x.hrMin, show: rv.has.includes('hrMin') },
      { h: 'HR avg', w: 8, get: (x) => x.hrAvg, show: rv.has.includes('hrAvg') },
      { h: 'HR peak', w: 8, get: (x) => x.hrPeak, show: rv.has.includes('hrPeak') },
      { h: 'HR end', w: 8, get: (x) => x.hrEnd, show: rv.has.includes('hrEnd') },
      { h: 'HR +30 s', w: 8, get: (x) => x.hrRec30, show: rv.has.includes('hrRec30') },
      { h: 'HR coverage', w: 10, get: (x) => x.hrCoverage, fmt: '0%', show: rv.has.includes('hrCoverage'), warn: (x) => x.hrCoverage != null && x.hrCoverage < 0.8 },
      { h: 'HR typed', w: 8, get: (x) => (x.hr != null && x.hr !== x.hrEnd ? x.hr : null), show: rv.reps.some((x) => x.hr != null && x.hr !== x.hrEnd) },
      { h: 'Lactate (mmol/L)', w: 10, get: (x) => x.lactate, fmt: '0.0', show: rv.has.includes('lactate') },
      { h: 'RPE', w: 6, get: (x) => x.rpe, show: rv.has.includes('rpe') },
      { h: 'Note', w: 30, get: (x) => x.note || null, align: 'left', show: rv.has.includes('note') },
    ].filter((c) => c.show !== false);

    ws.getCell(r, 1).value = 'Every rep'; style(ws.getCell(r, 1), { bold: true, size: 11 });
    r++;
    headerRow(ws, r, cols.map((c) => c.h), { aligns: cols.map((c) => c.align || 'right') });
    const head = r;
    r++;
    const first = r;
    const colOf = Object.fromEntries(cols.map((c, i) => [c.h, i + 1]));
    rv.reps.forEach((row, xi) => {
      const band = xi % 2 ? BAND : undefined;
      const refs = Object.fromEntries(cols.map((c, i) => [c.h, `${colL(i + 1)}${r}`]));
      cols.forEach((c, i) => {
        const cell = ws.getCell(r, i + 1);
        const v = c.formula ? c.formula(refs, row) : c.get(row);
        cell.value = v ?? null;
        const warn = c.warn && c.warn(row);
        style(cell, { fill: warn ? WARN_BG : band, fmt: c.fmt, align: c.align || 'right', bold: c.bold, wrap: c.h === 'Note' });
      });
      r++;
    });
    const last = r - 1;
    // average / fastest / slowest for the time column
    const tc = colL(colOf.Time);
    [['Average', 'AVERAGE'], ['Fastest', 'MIN'], ['Slowest', 'MAX']].forEach(([label, fn], si) => {
      ws.getCell(r, 1).value = label; style(ws.getCell(r, 1), { bold: true, border: si === 0 });
      ws.mergeCells(r, 1, r, colOf.Time - 1);
      const ts = rv.reps.map((x) => x.timeSec).filter((x) => x != null);
      const res = !ts.length ? null : fn === 'AVERAGE' ? ts.reduce((a, b) => a + b, 0) / ts.length : fn === 'MIN' ? Math.min(...ts) : Math.max(...ts);
      const c = ws.getCell(r, colOf.Time);
      c.value = ts.length ? { formula: `${fn}(${tc}${first}:${tc}${last})`, result: res / DAY } : null;
      style(c, { bold: true, fmt: TIME_FMT, align: 'right', border: si === 0 });
      r++;
    });
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: head, showGridLines: false }];
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });

    // per-length splits
    const lens = rv.reps.flatMap((x) => x.lengths.map((l) => ({ rep: x.repNo, ...l })));
    if (lens.length) {
      ws.getRow(r).addPageBreak();
      r++;
      ws.getCell(r, 1).value = 'Splits by length'; style(ws.getCell(r, 1), { bold: true, size: 11 });
      r++;
      const lcols = [
        ['Rep', (l) => l.rep], ['To (m)', (l) => l.dist], ['Lap', (l) => T(l.lapSec), TIME_FMT], ['Running', (l) => T(l.cumSec), TIME_FMT],
        ...(lens.some((l) => l.sc != null) ? [['Strokes', (l) => l.sc]] : []),
        ...(lens.some((l) => l.sr != null) ? [['Stroke rate', (l) => l.sr, '0']] : []),
        ...(lens.some((l) => l.hrFirst != null) ? [['HR in', (l) => l.hrFirst], ['HR out', (l) => l.hrLast]] : []),
      ];
      headerRow(ws, r, lcols.map((c) => c[0]), { aligns: ['left'] });
      r++;
      let prevRep = null, band = false;
      for (const l of lens) {
        if (l.rep !== prevRep) { band = !band; prevRep = l.rep; }
        lcols.forEach(([, get, fmt], i) => {
          const c = ws.getCell(r, i + 1); c.value = get(l) ?? null;
          style(c, { fill: band ? undefined : BAND, fmt, align: i === 0 ? 'left' : 'right' });
        });
        r++;
      }
    }
    if (rv.has.includes('hrCoverage') || rv.reps.some((x) => x.sendOffSec != null)) {
      r++;
      ws.mergeCells(r, 1, r, Math.min(cols.length, 10));
      ws.getCell(r, 1).value = [
        rv.reps.some((x) => x.sendOffSec != null) ? 'Rest after is what was left of the send-off once the rep was finished (send-off minus swim time): the rest before the next rep.' : '',
        rv.has.includes('hrCoverage') ? 'Amber HR coverage: the sensor dropped out for part of that rep, so its heart-rate figures are less reliable.' : '',
      ].filter(Boolean).join(' ');
      style(ws.getCell(r, 1), { color: MUTED, italic: true, wrap: true });
      ws.getRow(r).height = 28;
    }
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  });

  // ── Data ──────────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet(DATA);
    const timeCols = new Set(['target_sec', 'time_sec', 'vs_target_sec', 'rest_after_sec', 'pace_per_100_sec']);
    const rows = [];
    for (const rv of runs) for (const rep of rv.reps) rows.push(CSV_COLUMNS.map(([, f]) => { const v = f(pMeta, rv, rep); return v === '' ? null : v; }));
    ws.addTable({
      name: 'TestReps', ref: 'A1', headerRow: true, style: { theme: 'TableStyleLight9', showRowStripes: true },
      columns: CSV_COLUMNS.map(([h]) => ({ name: h, filterButton: true })),
      rows: rows.length ? rows : [CSV_COLUMNS.map(() => null)],
    });
    CSV_COLUMNS.forEach(([h], i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.min(34, Math.max(9, h.length + 2));
      col.font = { name: FONT, size: 10 };
      if (timeCols.has(h)) col.numFmt = '0.00';
    });
    ws.getRow(1).font = { name: FONT, size: 10, bold: true, color: { argb: HEAD_INK } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  return wb;
}

// Browser download helpers. The workbook buffer goes to a Blob; nothing is
// uploaded anywhere.
export async function downloadWorkbook(pMeta, pRunViews, pFileName) {
  const wb = await buildTestWorkbook(pMeta, pRunViews);
  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), pFileName);
}

export function saveBlob(pBlob, pFileName) {
  const url = URL.createObjectURL(pBlob);
  const a = document.createElement('a');
  a.href = url; a.download = pFileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export { fmtTime };
