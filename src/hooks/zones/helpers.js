function parseTime(s) {
  if (!s) return null;
  s = s.trim();
  const p = s.split(":");
  if (p.length === 2) return parseFloat(p[0]) * 60 + parseFloat(p[1]);
  return parseFloat(s) || null;
}
function fmtTime(s) {
  if (!s || isNaN(s)) return "--";
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}
function secToDisplay(sec) {
  if (!sec || isNaN(sec)) return "--";
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return m + ":" + s;
}

// ─── PHV zone-specific capacity (Sweetenham) ────────────────────────────────
// ATP-CP: all ages. AT: limited pre-PHV but accessible. LT/LP: post-PHV only.

export { parseTime, fmtTime, secToDisplay };
