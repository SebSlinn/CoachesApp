// components/SbLineEditor.jsx
import { useState } from 'react';
import { DRILL_LIBRARY } from '../drills/index.js';
import { suggestTimes } from '../zones/suggest.js';

function SbLineEditor({ line, onChange, onDelete, onMoveUp, onMoveDown, isFirst, isLast, pace200Map }) {
  const [drillOpen, setDrillOpen] = useState(false);
  const inp = {
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 5, color: "#fff", padding: "5px 5px", fontFamily: "monospace",
    fontSize: 11, outline: "none", boxSizing: "border-box", width: "100%",
  };
  const sel = { ...inp, background: "#16162a" };
  const lbl = { fontSize: 8, color: "rgba(255,255,255,0.25)", display: "block",
    marginBottom: 2, letterSpacing: "0.07em" };

  return (
    <div style={{ background: "rgba(255,255,255,0.025)",
      border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6,
      padding: "7px 8px", marginBottom: 5 }}>

      {/* Type + controls row */}
      <div style={{ display: "flex", gap: 4, marginBottom: line.type === "swim" ? 6 : 4,
        alignItems: "center" }}>
        {["swim","rest","note"].map(t => (
          <button key={t} onClick={() => onChange({ ...line, type: t })}
            style={{ padding: "2px 7px", borderRadius: 3, cursor: "pointer",
              fontFamily: "monospace", fontSize: 9, fontWeight: 700, border: "1px solid",
              borderColor: line.type === t ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.1)",
              background: line.type === t ? "rgba(255,255,255,0.1)" : "transparent",
              color: line.type === t ? "#fff" : "rgba(255,255,255,0.3)" }}>
            {t.toUpperCase()}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
          {!isFirst && <button onClick={onMoveUp} style={{ padding: "2px 5px", background: "transparent",
            border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3,
            color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 9 }}>↑</button>}
          {!isLast && <button onClick={onMoveDown} style={{ padding: "2px 5px", background: "transparent",
            border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3,
            color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 9 }}>↓</button>}
          <button onClick={onDelete} style={{ padding: "2px 6px",
            background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.2)",
            borderRadius: 3, color: "rgba(255,45,85,0.6)", cursor: "pointer", fontSize: 9 }}>✕</button>
        </div>
      </div>

      {line.type === "swim" && (
        <div style={{ display: "grid", gap: 5,
          gridTemplateColumns: "38px 55px 52px 58px 62px 62px 62px 1fr" }}>
          {[
            { k:"qty",        lb:"QTY",     ph:"1",     tp:"number" },
            { k:"distM",      lb:"DIST(m)", ph:"100",   tp:"number" },
            { k:"stroke",     lb:"STROKE",  ph:"",      tp:"sel", opts:["FS","BK","BR","Fly","IM","Kick"] },
            { k:"modifier",   lb:"TYPE",    ph:"",      tp:"sel", opts:["Full","Drill","Tech","Focus","Kick","Broken"] },
            { k:"intensity",  lb:"ZONE",    ph:"",      tp:"sel", opts:["A1","A2","A3","AT","CS","HVO","LP","LT","Drill","Skills"] },
            { k:"targetTime", lb:"IN",      ph:"1:10" },
            { k:"onTime",     lb:"ON",      ph:"1:20" },
            { k:"note",       lb:"NOTE",    ph:"Fast, drill name…" },
          ].map(f => (
            <div key={f.k}>
              <label style={lbl}>{f.lb}</label>
              {f.tp === "sel"
                ? <select value={line[f.k]} onChange={e => onChange({ ...line, [f.k]: e.target.value })} style={sel}>
                    {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                : <input type={f.tp || "text"} placeholder={f.ph} value={line[f.k]}
                    onChange={e => onChange({ ...line, [f.k]: e.target.value })} style={inp} />
              }
            </div>
          ))}
        </div>
      )}

      {/* Drill picker — shown when modifier is Drill */}
  {line.type === "swim" && (line.modifier === "Drill" || line.modifier === "Tech" || line.modifier === "Focus" || line.modifier === "Kick") && (function() {
    var drillStroke = line.stroke || "FS";
    var drillKey = (line.modifier === "Kick") ? "COND"
                 : (line.modifier === "Focus") ? "FS"
                 : drillStroke;
    // Build drill list for this stroke - include all relevant types
    var drillList = [];
    var DL = DRILL_LIBRARY;
    // Add stroke-specific drills
    if (DL[drillStroke]) DL[drillStroke].forEach(function(d) { drillList.push(d); });
    // Always add MULTI (sculling etc)
    if (DL["MULTI"]) DL["MULTI"].forEach(function(d) { drillList.push(d); });
    // Add COND for Kick modifier
    if (line.modifier === "Kick" && DL["COND"]) DL["COND"].forEach(function(d) { drillList.push(d); });
    // For Focus modifier, only focus type; for Drill, all drill+focus; for others, all
    if (line.modifier === "Focus") {
      drillList = drillList.filter(function(d) { return d.type === "focus"; });
    } else if (line.modifier === "Drill" || line.modifier === "Tech") {
      drillList = drillList.filter(function(d) { return d.type === "drill" || d.type === "focus" || d.type === "conditioning"; });
    }
    if (drillList.length === 0) return null;
    // Group drills by prefix (text before " — " or first word group)
    var groups = {};
    drillList.forEach(function(d) {
      var sep = d.name.indexOf(" — ");
      var grp = sep > -1 ? d.name.slice(0, sep) : (d.type === "focus" ? "Focus Points" : "Other");
      if (!groups[grp]) groups[grp] = [];
      groups[grp].push(d);
    });
    // Sort group names, keeping Focus Points last
    var groupNames = Object.keys(groups).sort(function(a,b) {
      if (a === "Focus Points") return 1;
      if (b === "Focus Points") return -1;
      return a.localeCompare(b);
    });
    // Find currently selected drill
    var selDrill = drillList.find(function(d) { return d.name === line.note; }) || null;
    // Compute suggested time for this drill
    var sugTime = null;
    if (selDrill && selDrill.paceFactor && pace200Map) {
      var SMULT5 = { FS:1.0, BK:1.045, BR:1.254, Fly:1.051, IM:1.082 };
      var p5 = pace200Map[drillStroke] || pace200Map["FS"];
      var zoneSR = { A1:1.52, A2:1.30, A3:1.16, AT:1.06, LP:1.00, LT:0.96, HVO:0.88, CS:1.06 };
      var sr5 = zoneSR[line.intensity] || 1.30;
      var dist5 = parseFloat(line.distM) || 100;
      if (p5) {
        var base5 = (p5 * (SMULT5[drillStroke]||1.0)) / 2;
        var rawSec = base5 * (dist5/100) * selDrill.paceFactor * sr5;
        var m5 = Math.floor(rawSec/60); var s5 = Math.round(rawSec%60);
        if (s5 === 60) { m5++; s5 = 0; }
        sugTime = m5 > 0 ? m5+":"+(s5<10?"0":"")+s5 : String(s5);
      }
    }
    var ZC5 = { HVO:"#FF2D55",LT:"#FF5500",LP:"#FF9500",AT:"#FFCC00",CS:"#30B0C7",A3:"#34C759",A2:"#30B0C7",A1:"#007AFF" };
    var zc5 = ZC5[line.intensity] || "#8E8E93";
    return (
      <div style={{ marginTop:4, padding:"6px 8px",
        background:"rgba(142,142,147,0.08)", border:"1px solid rgba(142,142,147,0.2)",
        borderRadius:5 }}>
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:8, color:"rgba(255,255,255,0.3)",
            letterSpacing:"0.08em", flexShrink:0 }}>DRILL:</span>
          <select value={line.note||""} onChange={function(e) {
            var chosen = drillList.find(function(d){return d.name===e.target.value;});
            var updates = { note: e.target.value };
            if (chosen && chosen.paceFactor && pace200Map) {
              var SMULT7 = { FS:1.0, BK:1.045, BR:1.254, Fly:1.051, IM:1.082 };
              var p7 = pace200Map[line.stroke||"FS"] || pace200Map["FS"];
              var zoneSR7 = { A1:1.52, A2:1.30, A3:1.16, AT:1.06, LP:1.00, LT:0.96, HVO:0.88, CS:1.06 };
              var sr7 = zoneSR7[line.intensity] || 1.30;
              var dist7 = parseFloat(line.distM) || 100;
              if (p7) {
                var base7 = (p7 * (SMULT7[line.stroke||"FS"]||1.0)) / 2;
                var raw7 = base7 * (dist7/100) * chosen.paceFactor * sr7;
                var m7 = Math.floor(raw7/60); var s7 = Math.round(raw7%60);
                if (s7 === 60) { m7++; s7 = 0; }
                updates.targetTime = m7 > 0 ? m7+":"+(s7<10?"0":"")+s7 : String(s7);
              }
            }
            onChange({...line, ...updates});
          }} style={{ flex:1, background:"rgba(255,255,255,0.07)",
            border:"1px solid rgba(255,255,255,0.12)", borderRadius:4,
            color:"#fff", padding:"3px 5px", fontFamily:"monospace",
            fontSize:10, outline:"none" }}>
            <option value="">— select drill —</option>
            {groupNames.map(function(grp) {
              return (
                <optgroup key={grp} label={grp}>
                  {groups[grp].map(function(d) {
                    var label = d.name.indexOf(" — ") > -1 ? d.name.slice(d.name.indexOf(" — ")+3) : d.name;
                    var ceiling = d.zoneCeiling ? " [≤"+d.zoneCeiling+"]" : "";
                    return <option key={d.name} value={d.name}>{label}{ceiling}</option>;
                  })}
                </optgroup>
              );
            })}
          </select>
          {sugTime && (
            <button onClick={function(){onChange({...line, targetTime:sugTime});}}
              style={{ padding:"3px 8px", background:zc5+"15",
                border:"1px solid "+zc5+"40", borderRadius:4,
                color:zc5, cursor:"pointer", fontFamily:"monospace",
                fontSize:9, fontWeight:700, flexShrink:0 }}>
              ≈ {sugTime}
            </button>
          )}
        </div>
        {selDrill && selDrill.objective && selDrill.objective !== "detail_pending" && (
          <div style={{ marginTop:4, fontSize:9, color:"rgba(255,255,255,0.4)",
            fontStyle:"italic", lineHeight:1.4 }}>
            {selDrill.objective}
          </div>
        )}
        {selDrill && selDrill.zoneCeiling && (function(){
          var zoneOrder = ["A1","A2","A3","AT","CS","LP","LT","HVO"];
          var ceilIdx = zoneOrder.indexOf(selDrill.zoneCeiling);
          var intIdx  = zoneOrder.indexOf(line.intensity);
          if (intIdx > ceilIdx && ceilIdx >= 0) {
            return (
              <div style={{ marginTop:3, fontSize:9,
                color:"rgba(255,149,0,0.8)", fontWeight:700 }}>
                ⚠ Zone ceiling for this drill is {selDrill.zoneCeiling} — intensity too high
              </div>
            );
          }
          return null;
        })()}
        {selDrill && selDrill.coachingNotes && selDrill.coachingNotes !== "" && selDrill.coachingNotes !== "detail_pending" && (
          <div style={{ marginTop:3, fontSize:9, color:"rgba(255,255,255,0.25)",
            lineHeight:1.4 }}>
            Coach: {selDrill.coachingNotes}
          </div>
        )}
      </div>
    );
  })()}

      {/* Zone suggestion */}
  {line.type === "swim" && line.intensity && line.distM && pace200Map && (function() {
    var SMULT4 = { FS:1.0, BK:1.045, BR:1.254, Fly:1.051, IM:1.082 };
    var s4 = line.stroke || "FS";
    var p4 = pace200Map[s4] || pace200Map["FS"];
    if (!p4) return null;
    var sg4 = suggestTimes(line.intensity, line.distM, s4, p4);
    if (!sg4) return null;
    var ZC4 = { HVO:"#FF2D55",LT:"#FF5500",LP:"#FF9500",AT:"#FFCC00",
      A3:"#34C759",A2:"#30B0C7",A1:"#007AFF" };
    var zc4 = ZC4[line.intensity] || "rgba(255,255,255,0.4)";
    return (
      <div style={{ marginTop:4, padding:"5px 8px",
        background:zc4+"0D", border:"1px solid "+zc4+"30", borderRadius:5,
        display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <span style={{ fontSize:8, color:zc4, fontWeight:700,
          letterSpacing:"0.08em" }}>{line.intensity}</span>
        <span style={{ fontSize:8, color:"rgba(255,255,255,0.4)" }}>
          Suggested:
        </span>
        <span style={{ fontSize:8, color:"rgba(255,255,255,0.6)",
          cursor:"pointer", textDecoration:"underline" }}
          onClick={function(){onChange({...line, targetTime:sg4.inMidStr});}}>
          IN {sg4.inLowStr}–{sg4.inHighStr}
        </span>
        <span style={{ fontSize:8, color:"rgba(255,255,255,0.4)",
          cursor:"pointer", textDecoration:"underline" }}
          onClick={function(){
            var onSec4 = Math.round((sg4.onLow+sg4.onHigh)/2);
            var inSec4 = Math.round((sg4.inLow+sg4.inHigh)/2);
            onChange({...line, targetTime:sg4.inMidStr,
              onTime:sg4.onMidStr});
          }}>
          ON {sg4.onLowStr}–{sg4.onHighStr}
        </span>
      </div>
    );
  })()}

  {(line.type === "rest" || line.type === "note") && (
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 6 }}>
          {line.type === "rest" && (
            <div>
              <label style={lbl}>DURATION</label>
              <input placeholder="2:00" value={line.onTime}
                onChange={e => onChange({ ...line, onTime: e.target.value })} style={inp} />
            </div>
          )}
          <div>
            <label style={lbl}>{line.type === "rest" ? "LABEL" : "NOTE"}</label>
            <input placeholder={line.type === "rest" ? "2 mins rest, Loo stop…" : "Coaching note…"}
              value={line.note} onChange={e => onChange({ ...line, note: e.target.value })} style={inp} />
          </div>
        </div>
      )}
    </div>
  );
}

// Block editor (handles nested inner blocks)

export default SbLineEditor;
