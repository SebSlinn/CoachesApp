// src/athlete/swimmingResults.js
// Parse copied SwimmingResults.org page text into rich, DB-ready records.
// Page COPY (tab-delimited), not PDF — the PDF loses columns, wraps long meet
// names and mangles ligatures.
//
// Two pages a coach/parent can copy:
//   1. Individual Best Times (All Time)  → one PB per event, Long AND Short
//      Course, each with Date, Meet, Venue, Licence, Level. parseBestTimes().
//   2. A single event's page (e.g. 100 Freestyle · Long Course) → EVERY swim
//      for that event, with Date, Meet, Venue, Club, Level. parseEventHistory().
//
// Both yield records carrying the official detail so they persist as real meets
// (kind 'meet', maximal), deduped by the meet licence / event+date.
// Zero imports — safe to unit-test and reuse anywhere.

const STROKE_CODE = {
  Freestyle: 'FS', Backstroke: 'BK', Breaststroke: 'BR',
  Butterfly: 'Fly', 'Individual Medley': 'IM',
};
const CODE_STROKE = { FS: 'Freestyle', BK: 'Backstroke', BR: 'Breaststroke', Fly: 'Butterfly', IM: 'Individual Medley' };

// "29.34" | "1:02.27" | "17:53.48" | "00:01:07.970" → seconds, or NaN
export function parseTimeSec(v) {
  if (v == null) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}

// DD/MM/YY or DD/MM/YYYY (UK) → YYYY-MM-DD. NOT via JS Date (which reads US).
export function ukDateToIso(v) {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, '0'), mm = m[2].padStart(2, '0');
  let yy = m[3];
  if (yy.length === 2) yy = (Number(yy) > 70 ? '19' : '20') + yy;
  const mo = Number(mm), da = Number(dd);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return `${yy}-${mm}-${dd}`;
}

// Swim England region / home-nation from the licence prefix (best-effort).
function awardingBodyFromLicence(pLic) {
  const s = String(pLic || '').toUpperCase();
  if (/^WL/.test(s)) return 'Swim Wales';
  if (/^SD|^SS/.test(s)) return 'Scottish Swimming';
  if (/^[A-Z]{2}\d/.test(s)) return 'Swim England';
  return null;
}

// "50 Freestyle" | "200 Individual Medley" → { dist, code, stroke } | null
function parseEventName(pStr) {
  const m = String(pStr).trim().match(/^(\d+)\s+(.+)$/);
  if (!m) return null;
  const dist = Number(m[1]);
  const code = STROKE_CODE[m[2].trim()];
  if (!dist || !code) return null;
  return { dist, code, stroke: m[2].trim() };
}

// "Esmee Slinn - (1371610) - City of Liverpool SC[ - 100 Freestyle - Long Course][Search Again…]"
function parseSwimmerHeader(pLine) {
  const line = pLine.replace(/Search Again.*$/i, '').trim();
  const m = line.match(/^(.+?)\s-\s\((\d+)\)\s-\s(.+)$/);
  if (!m) return null;
  let club = m[3].trim(), event = null, course = null;
  // a single-event page appends " - <event> - <Long|Short> Course"
  const ev = club.match(/^(.*?)\s-\s(\d+\s+[A-Za-z ]+?)\s-\s(Long|Short)\sCourse$/);
  if (ev) { club = ev[1].trim(); event = parseEventName(ev[2]); course = ev[3] === 'Long' ? 'LC' : 'SC'; }
  return { name: m[1].trim(), seNumber: m[2], club, event, course };
}

const poolForCourse = (c) => (c === 'LC' ? '50LC' : '25SC');

// SwimmingResults copies as TAB-delimited, but some copy paths collapse tabs to
// spaces. Split a data row by tab when present, else by a shape-anchored regex.
const RE_TIME = '\\d{1,2}:\\d{2}\\.\\d{2}|\\d{1,2}\\.\\d{2}';
const RE_DATE = '\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}';

const RE_BEST = new RegExp(
  `^(\\d+\\s+(?:Freestyle|Backstroke|Breaststroke|Butterfly|Individual Medley))\\s+(${RE_TIME})\\s+(${RE_TIME})\\s+(\\d+)\\s+(${RE_DATE})\\s+(.+?)\\s+([A-Za-z]{2}\\d{5,7})\\s+(\\d+)\\s*$`);
function bestRowCells(line) {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  const m = line.trim().match(RE_BEST);
  if (!m) return null;
  return [m[1], m[2], m[3], m[4], m[5], m[6], '', m[7], m[8]];
}

const RE_EVENT = new RegExp(
  `^(${RE_TIME})\\s+(\\d+)\\s+([A-Za-z]{1,3})\\s+(${RE_DATE})\\s+(.+?)\\s+(\\d+)\\s*$`);
function eventRowCells(line) {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  const m = line.trim().match(RE_EVENT);
  if (!m) return null;
  return [m[1], m[2], m[3], m[4], m[5], '', '', m[6]];
}

// ── Individual Best Times page ─────────────────────────────────────────────
// Columns: Stroke | Time | Converted | WA Pts | Date | Meet | Venue | Licence | Level
export function parseBestTimes(pText) {
  const lines = String(pText || '').split(/\r?\n/);
  const out = { name: '', seNumber: '', club: '', records: [] };
  let course = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (/^Long Course$/i.test(t)) { course = 'LC'; continue; }
    if (/^Short Course$/i.test(t)) { course = 'SC'; continue; }
    if (!out.name) { const h = parseSwimmerHeader(t); if (h) { out.name = h.name; out.seNumber = h.seNumber; out.club = h.club; continue; } }
    const cells = bestRowCells(line);
    if (!cells) continue;
    const ev = parseEventName(cells[0]);
    if (!ev || !course) continue;
    const timeSec = parseTimeSec(cells[1]);
    if (!(timeSec > 0)) continue;
    out.records.push({
      code: ev.code, dist: ev.dist, stroke: ev.stroke, course,
      poolType: poolForCourse(course),
      timeSec, timeStr: cells[1], convertedSec: parseTimeSec(cells[2]),
      waPoints: Number(cells[3]) || null,
      date: ukDateToIso(cells[4]), meet: cells[5] || '', venue: cells[6] || '',
      licence: cells[7] || '', level: cells[8] ? Number(cells[8]) : null,
    });
  }
  return out;
}

// ── Single-event page (every swim for one event) ───────────────────────────
// Columns: Time | WA Pts | Round | Date | Meet | Venue | Club Swam Under | Level
export function parseEventHistory(pText) {
  const lines = String(pText || '').split(/\r?\n/);
  const out = { name: '', seNumber: '', club: '', event: null, course: null, records: [] };
  const seen = new Set();
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (!out.name) { const h = parseSwimmerHeader(t); if (h) { out.name = h.name; out.seNumber = h.seNumber; out.club = h.club; out.event = h.event; out.course = h.course; continue; } }
        if (!out.event) continue;
    const cells = eventRowCells(line);
    if (!cells) continue;
    const timeSec = parseTimeSec(cells[0]);
    const date = ukDateToIso(cells[3]);
    if (!(timeSec > 0) || !date) continue;                 // skip header/other rows
    const key = date + '|' + cells[0];
    if (seen.has(key)) continue; seen.add(key);            // Time-order & Date-order repeat the same swims
    out.records.push({
      code: out.event.code, dist: out.event.dist, stroke: out.event.stroke, course: out.course,
      poolType: poolForCourse(out.course),
      timeSec, timeStr: cells[0], waPoints: Number(cells[1]) || null, round: cells[2] || '',
      date, meet: cells[4] || '', venue: cells[5] || '', club: cells[6] || '', level: cells[7] ? Number(cells[7]) : null,
    });
  }
  return out;
}

// ── Records → swimzone.result/1 rows (official meets) ──────────────────────
// Deduped downstream by (athlete, stroke, dist, date, meet); importRef keeps the
// licence for traceability. Every row is a maximal official swim.
export function recordsToResultRows(pRecords, pAthleteId) {
  return (pRecords || []).filter((r) => r.code && r.dist > 0 && r.timeSec > 0 && r.date).map((r) => ({
    kind: 'meet', source: 'import', effort: 'maximal',
    swumOn: r.date, stroke: r.code, distM: r.dist, poolType: r.poolType, timeSec: r.timeSec,
    provenance: {
      sanctioned: true, meetName: r.meet || null, venue: r.venue || null, country: 'GB',
      awardingBody: awardingBodyFromLicence(r.licence),
      importRef: `sr:${pAthleteId}:${r.licence || 'na'}:${r.dist}${r.code}:${r.date}`,
    },
    note: r.level != null ? `Level ${r.level}` : null,
  }));
}

// ── Records → the Athlete Setup `times` grid object ────────────────────────
// One cell per event (dist_code). Best Times has both courses; prefer LC (the
// standard for classification), fall back to SC. lcEq uses the page's converted
// time so profile derivation compares like with like.
export function recordsToSetupTimes(pRecords, pNowMs = Date.now()) {
  const byEvent = new Map();
  for (const r of pRecords || []) {
    if (!r.code || !(r.dist > 0) || !(r.timeSec > 0)) continue;
    const key = `${r.dist}_${r.code}`;
    const prev = byEvent.get(key);
    // prefer LC; otherwise keep the faster
    const better = !prev || (r.course === 'LC' && prev.course !== 'LC') ||
      (r.course === prev.course && r.timeSec < prev.timeSec);
    if (better) byEvent.set(key, r);
  }
  const times = {};
  for (const [key, r] of byEvent) {
    const monthsOld = r.date ? (pNowMs - Date.parse(r.date)) / (1000 * 60 * 60 * 24 * 30.4375) : 0;
    times[key] = {
      sec: r.timeSec,
      lcEq: r.course === 'LC' ? r.timeSec : (r.convertedSec || r.timeSec),
      display: r.timeStr || null,
      pool: r.course === 'LC' ? 'LC' : 'SC',
      dist: r.dist, code: r.code, stroke: CODE_STROKE[r.code] || r.stroke,
      date: r.date || '', monthsOld: Math.round(monthsOld * 10) / 10, stale: monthsOld > 13,
    };
  }
  return times;
}

// Convenience: parse a best-times paste into everything Athlete Setup needs.
export function parseSwimmingResults(pText) {
  const parsed = parseBestTimes(pText);
  return { name: parsed.name, seNumber: parsed.seNumber, club: parsed.club,
           records: parsed.records, times: recordsToSetupTimes(parsed.records) };
}

// Auto-detecting entry point: recognises the Individual Best Times page (PBs for
// all strokes) vs a single event's All-Times page (every swim for one event) and
// parses appropriately. Returns { pageType, name, seNumber, club, event?, course?,
// records, times }.
export function parsePaste(pText) {
  let header = null;
  for (const raw of String(pText || '').split(/\r?\n/)) {
    const h = parseSwimmerHeader(raw.trim());
    if (h) { header = h; break; }
  }
  if (header && header.event) {
    const eh = parseEventHistory(pText);
    return { pageType: 'event-history', name: eh.name, seNumber: eh.seNumber, club: eh.club,
             event: eh.event, course: eh.course, records: eh.records, times: recordsToSetupTimes(eh.records) };
  }
  const bt = parseBestTimes(pText);
  return { pageType: 'best-times', name: bt.name, seNumber: bt.seNumber, club: bt.club,
           records: bt.records, times: recordsToSetupTimes(bt.records) };
}