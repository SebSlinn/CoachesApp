//src/session/utils.js - Utility functions for session modeling and set builder operations.
// Set Builder utility functions
function sbId() { return "sb" + Date.now() + Math.random().toString(36).substr(2, 9); }

function sbNewLine(defaults) {
  return {
    id: sbId(), distM: "100", qty: "1", targetTime: "", onTime: "",
    restSec: "20", stroke: "FS", intensity: "A2", note: "", type: "swim",
    poolType: "25SC", ...defaults
  };
}

function sbNewBlock(defaults) {
  return { id: sbId(), repeats: "1", label: "", children: [], ...defaults };
}

function sbAddChild(block, child) { return { ...block, children: [...block.children, child] }; }
function sbDeleteChild(block, id) { return { ...block, children: block.children.filter(c => c.id !== id) }; }
function sbUpdateChild(block, id, updater) {
  return { ...block, children: block.children.map(c =>
    c.id === id ? (typeof updater === "function" ? updater(c) : { ...c, ...updater }) : c
  )};
}
function sbMoveChild(block, id, dir) {
  const arr = [...block.children];
  const i = arr.findIndex(c => c.id === id);
  if (i < 0) return block;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return block;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return { ...block, children: arr };
}

function sbParseSec(s) {
  if (!s) return 0;
  s = s.trim();
  const p = s.split(":");
  if (p.length === 2) return parseFloat(p[0]) * 60 + parseFloat(p[1]);
  return parseFloat(s) || 0;
}

function sbFmtDur(sec) {
  if (!sec || isNaN(sec)) return "--";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  return m + ":" + String(s).padStart(2, "0");
}

function sbFmtTime(s) {
  if (!s || isNaN(s)) return "--";
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

function sbZoneColor(zone) {
  // Must match ZONE_COLORS in zones/constants.js exactly.
  const colors = {
    HVO: "#FF2D55", LT: "#FF5500", LP: "#FF9500", AT: "#FFCC00",
    A3: "#34C759", A2: "#30B0C7", A1: "#007AFF",
    CS: "#30B0C7", // CS shares A2's colour family (aerobic threshold zone)
  };
  return colors[zone] || "#888";
}

function sbBlockVolume(block) {
  return block.children.reduce((sum, child) => {
    if (child.children) return sum + sbBlockVolume(child) * parseFloat(child.repeats || 1);
    return sum + parseFloat(child.distM || 0) * parseFloat(child.qty || 1);
  }, 0);
}

function sbBlockTotalTime(block) {
  return block.children.reduce((sum, child) => {
    if (child.children) return sum + sbBlockTotalTime(child) * parseFloat(child.repeats || 1);
    const lineTime = (sbParseSec(child.targetTime) || 0) * parseFloat(child.qty || 1);
    const restTime = sbParseSec(child.restSec) * (parseFloat(child.qty || 1) - 1);
    return sum + lineTime + Math.max(0, restTime);
  }, 0);
}

function sbLineRest(line) {
  return sbParseSec(line.restSec) || 0;
}

export {
  sbId, sbNewLine, sbNewBlock, sbAddChild, sbDeleteChild, sbUpdateChild, sbMoveChild,
  sbParseSec, sbFmtDur, sbFmtTime, sbZoneColor, sbBlockVolume, sbBlockTotalTime, sbLineRest
};