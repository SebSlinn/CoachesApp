// components/SbLineView.jsx
import { DRILL_LIBRARY } from '../drills/index.js';

function SbLineView({ line, sbZoneColor, sbLineRest, pace200Map, phvStatus, convertTime }) {
  if (line.type === "rest" || (line.type === "swim" && !parseFloat(line.distM) && line.onTime)) {
    return (
      <div style={{ padding: "3px 0 3px 14px", fontSize: 10,
        color: "rgba(255,204,0,0.55)", fontStyle: "italic",
        borderLeft: "2px solid rgba(255,204,0,0.2)" }}>
        — {line.note || "Rest"}{line.onTime ? " " + line.onTime : ""}
      </div>
    );
  }
  if (line.type === "note") {
    return (
      <div style={{ padding: "3px 0 3px 14px", fontSize: 10,
        color: "rgba(255,255,255,0.3)", fontStyle: "italic",
        borderLeft: "2px solid rgba(255,255,255,0.06)" }}>
        * {line.note}
      </div>
    );
  }
  const restSec = sbLineRest(line);
  const zc = sbZoneColor(line.intensity);
  var computedZone = null;
  if (pace200Map && line.distM && line.targetTime && line.type === "swim") {
    var SMULT2 = { FS:1.0, BK:1.045, BR:1.254, Fly:1.051, IM:1.082 };
    var lStroke = line.stroke || "FS";
    var lp200 = pace200Map[lStroke] || pace200Map["FS"];
    if (lp200) {
      var lBase = (lp200 * (SMULT2[lStroke]||1.0)) / 2;
      var lDist = parseFloat(line.distM);
      var ltStr = String(line.targetTime); var ltc = ltStr.indexOf(":");
      var lWork = ltc > -1 ? parseInt(ltStr.slice(0,ltc))*60+parseFloat(ltStr.slice(ltc+1)) : parseFloat(ltStr)||0;
      if (lWork > 0 && lDist > 0) {
        var lsr = (lWork/lDist*100)/lBase;
        if(lsr<0.97)computedZone="LT";
        else if(lsr<1.025)computedZone="LP";
        else if(lsr<1.10)computedZone="AT";
        else if(lsr<1.22)computedZone="A3";
        else if(lsr<1.38)computedZone="A2";
        else computedZone="A1";
      }
    }
  }
  var czc = computedZone ? sbZoneColor(computedZone) : null;
  return (
    <div style={{ padding: "3px 0 3px 14px", display: "flex", alignItems: "baseline",
      gap: 6, flexWrap: "wrap", borderLeft: "2px solid " + (czc || "rgba(255,255,255,0.06)") }}>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", fontFamily: "monospace" }}>
        {parseFloat(line.qty) > 1 ? line.qty + "x " : ""}
        <span style={{ fontWeight: 700 }}>{line.distM}m {line.stroke}</span>
        {line.modifier && line.modifier !== "Full" ? (
          <span style={{ color: "rgba(255,255,255,0.4)" }}> {line.modifier}</span>
        ) : null}
      </span>
      {computedZone && (
        <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3,
          background: czc + "30", border: "1px solid " + czc + "70",
          color: czc, fontFamily: "monospace", fontWeight: 700 }}>{computedZone}</span>
      )}
      {line.intensity && line.intensity !== computedZone && (
        <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3,
          background: zc + "10", color: zc, fontFamily: "monospace",
          opacity: 0.5 }}>{line.intensity}</span>
      )}
      {line.targetTime && (
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)",
          fontFamily: "monospace" }}>IN {convertTime ? convertTime(line.targetTime, line.poolType) : line.targetTime}</span>
      )}
      {line.onTime && (
        <span style={{ fontSize: 10, color: restSec > 0 ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.15)",
          fontFamily: "monospace" }}>
          ON {convertTime ? convertTime(line.onTime, line.poolType) : line.onTime}
          {restSec > 0 && (
            <span style={{ color: "rgba(255,255,255,0.2)", marginLeft: 4 }}>
              ({Math.round(restSec)}s rest)
            </span>
          )}
        </span>
      )}
      {!line.onTime && line.targetTime && (
        <span style={{ fontSize: 9, color: "rgba(255,204,0,0.35)", fontStyle: "italic" }}>straight on</span>
      )}
      {line.note && (
        <span style={{ fontSize: 9,
          color: (line.modifier === "Drill" || line.modifier === "Focus" || line.modifier === "Tech")
            ? "rgba(142,142,147,0.8)" : "rgba(255,204,0,0.5)",
          fontStyle: "italic",
          background: (line.modifier === "Drill" || line.modifier === "Focus")
            ? "rgba(142,142,147,0.10)" : "transparent",
          padding: (line.modifier === "Drill" || line.modifier === "Focus") ? "1px 4px" : "0",
          borderRadius: 3 }}>
          {line.modifier === "Drill" || line.modifier === "Focus" ? "◆ " : ""}{line.note}
        </span>
      )}
    </div>
  );
}

// Block display (read-only)

export default SbLineView;
