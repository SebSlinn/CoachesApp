import { parseTime, secToDisplay } from '../zones/helpers.js';

const STALE_MONTHS = 13;
const VALID_DISTS  = [50, 100, 200, 400, 800, 1500];
const STROKE_NAMES = [
  { name: "Freestyle",     code: "FS"  },
  { name: "Backstroke",    code: "BK"  },
  { name: "Breaststroke",  code: "BR"  },
  { name: "Butterfly",     code: "Fly" },
  { name: "Individual Medley", code: "IM" },
];

function parseDateToAge(ddmmyy) {
  if (!ddmmyy || ddmmyy.length < 8) return null;
  let day = 0, mon = 0, yr = 0;
  let i = 0;
  while (i < ddmmyy.length && ddmmyy[i] >= "0" && ddmmyy[i] <= "9") { day = day*10 + parseInt(ddmmyy[i]); i++; }
  if (ddmmyy[i] === "/") i++;
  while (i < ddmmyy.length && ddmmyy[i] >= "0" && ddmmyy[i] <= "9") { mon = mon*10 + parseInt(ddmmyy[i]); i++; }
  if (ddmmyy[i] === "/") i++;
  while (i < ddmmyy.length && ddmmyy[i] >= "0" && ddmmyy[i] <= "9") { yr = yr*10 + parseInt(ddmmyy[i]); i++; }
  if (!day || !mon || !yr) return null;
  const fullYr = yr < 50 ? 2000 + yr : 1900 + yr;
  const then = new Date(fullYr, mon - 1, day);
  const now  = new Date();
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
}

function splitTimeToken(str, start) {
  let i = start;
  // Skip all whitespace including non-breaking space (U+00A0) and other Unicode spaces
  while (i < str.length && (str[i] === " " || str[i] === "\u00A0" || str[i] === "\t" || str[i] === "\r" || str[i] === "\n")) i++;
  const j0 = i;
  // Read integer part (minutes or whole seconds)
  while (i < str.length && str[i] >= "0" && str[i] <= "9") i++;
  if (i >= str.length || i === j0) return null;
  if (str[i] === ":") {
    // m:ss.cc or mm:ss.cc
    i++;
    const ssStart = i;
    while (i < str.length && str[i] >= "0" && str[i] <= "9") i++;
    if (i - ssStart < 1) return null;
    if (i < str.length && str[i] === ".") {
      i++;
      let dec = 0;
      while (i < str.length && str[i] >= "0" && str[i] <= "9" && dec < 2) { i++; dec++; }
    }
  } else if (str[i] === ".") {
    // ss.cc — cap at 2 decimal places
    i++;
    let dec = 0;
    while (i < str.length && str[i] >= "0" && str[i] <= "9" && dec < 2) { i++; dec++; }
  } else return null;
  if (i === j0) return null;
  return { token: str.slice(j0, i), end: i };
}

function parseTimeToSec(t) {
  if (!t) return null;
  const colonIdx = t.indexOf(":");
  if (colonIdx > -1) {
    const mins = parseInt(t.slice(0, colonIdx));
    const secs = parseFloat(t.slice(colonIdx + 1));
    return mins * 60 + secs;
  }
  return parseFloat(t);
}

function handleParse() {
  const log = [];
  const times = {};
  // Normalise whitespace (non-breaking spaces etc from web paste)
  let text = rawPaste;
  let norm = "";
  for (let ci2 = 0; ci2 < text.length; ci2++) {
    const code = text.charCodeAt(ci2);
    norm += (code === 160 || (code >= 8192 && code <= 8203)) ? " " : text[ci2];
  }
  text = norm;
  // Extract athlete header: Name - (SENumber) - Club
  const dashParen = text.indexOf(" - (");
  if (dashParen > -1) {
    const lineStart = text.lastIndexOf("\n", dashParen) + 1;
    const lineEnd   = text.indexOf("\n", dashParen);
    const headerLine = text.slice(lineStart, lineEnd > -1 ? lineEnd : text.length).trim();
    const p1 = headerLine.indexOf(" - (");
    const p2 = headerLine.indexOf(") - ", p1);
    if (p1 > -1 && p2 > -1) {
      setAthleteName(headerLine.slice(0, p1).trim());
      setSeNumber(headerLine.slice(p1 + 4, p2).trim());
      setClubName(headerLine.slice(p2 + 4).trim());
      log.push("Athlete: " + headerLine.slice(0, p1).trim() + " (" + headerLine.slice(p1 + 4, p2).trim() + ")");
    }
  }
  const sections = [];
  const lcIdx = text.indexOf("Long Course");
  const scIdx = text.indexOf("Short Course");
  if (lcIdx > -1) sections.push({ label: "LC", pos: lcIdx });
  if (scIdx > -1) sections.push({ label: "SC", pos: scIdx });
  sections.sort((a, b) => a.pos - b.pos);
  if (sections.length === 0) { setParseLog(["No 'Long Course' or 'Short Course' section found."]); return; }

  sections.forEach((sec, si) => {
    const secEnd = si + 1 < sections.length ? sections[si + 1].pos : text.length;
    const secText = text.slice(sec.pos, secEnd);
    const pool = sec.label;
    log.push("Parsing " + pool + " section (" + secText.length + " chars)");

    VALID_DISTS.forEach(dist => {
      STROKE_NAMES.forEach(sn => {
        const marker = dist + " " + sn.name;
        const mi = secText.indexOf(marker);
        if (mi < 0) return;
        const after = secText.slice(mi + marker.length);
        const t1 = splitTimeToken(after, 0);
        if (!t1) return;
        const t2 = splitTimeToken(after, t1.end);
        const actualSec = parseTimeToSec(t1.token);
        if (!actualSec || actualSec < 10) return;
        const lcEqSec = pool === "LC" ? actualSec : (t2 ? parseTimeToSec(t2.token) : actualSec);
        if (!lcEqSec || lcEqSec < 10) return;
        const display = t1.token.indexOf(":") > -1
          ? t1.token
          : Math.floor(actualSec / 60) + ":" + (actualSec % 60).toFixed(2).padStart(5, "0");

        let dateStr = "";
        let k = t2 ? t2.end : t1.end;
        let scanned = 0;
        while (k < after.length && scanned < 200) {
          if (after[k] >= "0" && after[k] <= "9") {
            const candidate = after.slice(k, k + 8);
            let d2 = 0, m2 = 0, y2 = 0, ci = 0;
            while (ci < candidate.length && candidate[ci] >= "0" && candidate[ci] <= "9") { d2 = d2*10+parseInt(candidate[ci]); ci++; }
            if (candidate[ci] === "/") {
              ci++;
              while (ci < candidate.length && candidate[ci] >= "0" && candidate[ci] <= "9") { m2 = m2*10+parseInt(candidate[ci]); ci++; }
              if (candidate[ci] === "/") {
                ci++;
                while (ci < candidate.length && candidate[ci] >= "0" && candidate[ci] <= "9") { y2 = y2*10+parseInt(candidate[ci]); ci++; }
                if (d2 > 0 && d2 <= 31 && m2 > 0 && m2 <= 12 && y2 > 0) {
                  dateStr = (d2 < 10 ? "0" : "") + d2 + "/" + (m2 < 10 ? "0" : "") + m2 + "/" + y2;
                  break;
                }
              }
            }
          }
          k++; scanned++;
        }
        const monthsOld = parseDateToAge(dateStr);
        const stale = monthsOld !== null && monthsOld > STALE_MONTHS;
        const key = dist + "_" + sn.code;
        if (!times[key] || lcEqSec < times[key].lcEq) {
          times[key] = { sec: actualSec, lcEq: lcEqSec, display, pool, dist,
                         code: sn.code, stroke: sn.name, date: dateStr, monthsOld, stale };
          log.push("  " + pool + " " + dist + "m " + sn.name + ": " + display + (stale ? " [STALE]" : ""));
        }
      });
    });
  });

  const dp = deriveAthleteType(times);
  log.push("Parsed " + Object.keys(times).length + " times.");
  setAthleteTimes(times);
  setParseLog([...log]);
  setDerivedProfile(dp);
}

function deriveAthleteType(times) {
  const get = (dist, code) => times[dist + "_" + code] || null;
  let css = null, cssMethod = null;
  const fs1500 = get(1500,"FS"), fs800 = get(800,"FS"),
        fs400  = get(400,"FS"),  fs200 = get(200,"FS"), fs100 = get(100,"FS");
  if (fs1500 && fs400) { css = 100*(fs1500.sec-fs400.sec)/(1500-400); cssMethod = "1500m + 400m"; }
  else if (fs800 && fs400) { css = 100*(fs800.sec-fs400.sec)/(800-400); cssMethod = "800m + 400m"; }
  else if (fs400 && fs200) { css = 100*(fs400.sec-fs200.sec)/(400-200); cssMethod = "400m + 200m"; }
  else if (fs200 && fs100) { css = 100*(fs200.sec-fs100.sec)/(200-100); cssMethod = "200m + 100m"; }

  const paces = [];
  // Aerobic index uses 200m+ only — 50m and 100m are ATP-CP/technique dominated
  // and distort the profile for endurance swimmers
  const AEROBIC_INDEX_DISTS = [200, 400, 800, 1500];
  let staleUsed = false;
  AEROBIC_INDEX_DISTS.forEach(d => {
    const t = get(d,"FS");
    if (t) {
      paces.push({ dist: d, pace: t.lcEq / d * 100 });
      if (t.stale) staleUsed = true;
    }
  });
  if (paces.length < 2) {
    return css ? { type: null, mult: null, label: null, confidence: "none",
      method: null, aiPct: null, css, cssMethod,
      reasoning: "Insufficient freestyle times for profiling. CSS calculated from " + cssMethod + "." } : null;
  }
  paces.sort((a,b) => a.dist - b.dist);
  const drops = [];
  for (let i = 1; i < paces.length; i++) {
    const rawDrop = (paces[i].pace - paces[i-1].pace) / paces[i-1].pace;
    const logRatio = Math.log2(paces[i].dist / paces[i-1].dist);
    if (logRatio > 0) drops.push(rawDrop / logRatio);
  }
  const avgDrop = drops.reduce((s,d) => s+d, 0) / drops.length;
  const aiPct = (avgDrop * 100).toFixed(1);
  const confidence = drops.length >= 3
    ? (staleUsed ? "medium" : "high")
    : (staleUsed ? "low" : "medium");
  let type, mult, label;
  if (avgDrop < 0.03)      { type = "endurance"; mult = 1.35; label = "Endurance"; }
  else if (avgDrop < 0.06) { type = "allround";  mult = 1.00; label = "All-Round"; }
  else                     { type = "sprint";     mult = 0.75; label = "Sprint";    }
  return { type, mult, label, confidence, method: "Aerobic index (FS 200m+ drop-off curve)",
    aiPct, css, cssMethod, staleUsed,
    reasoning: "Average pace drop per doubling of distance (200m+): " + aiPct + "% (" + drops.length + " pairs)"
      + (staleUsed ? " — based partly on stale times" : "") };
}

export {
  STALE_MONTHS, VALID_DISTS, STROKE_NAMES,
  parseDateToAge, splitTimeToken, parseTimeToSec, deriveAthleteType,
};
