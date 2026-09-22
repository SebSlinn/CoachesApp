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
