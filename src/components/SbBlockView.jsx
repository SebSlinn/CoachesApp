// components/SbBlockView.jsx
import { useState } from 'react';
import SbLineView from './SbLineView.jsx';
import { DRILL_LIBRARY } from '../drills/index.js';

function SbBlockView({ block, onEdit, onDelete, onMoveUp, onMoveDown,
  isFirst, isLast, sbZoneColor, sbFmtDur, sbBlockVolume, sbBlockTotalTime, sbLineRest,
  isSelected, onSelect, pace200Map, phvStatus,
  onToggleSelect, selectMode, selectedLines, onBracket, convertTime,
  depth }) {
  depth = depth || 0;
  const vol  = sbBlockVolume(block);
  const time = sbBlockTotalTime(block);
  const reps = parseFloat(block.repeats) || 1;

  // Compute aggregate zone badge for this block
  var blockZone = null;
  var blockZoneColor = null;
  if (pace200Map && block.children && block.children.length > 0) {
    var SMULT3 = { FS:1.0, BK:1.045, BR:1.254, Fly:1.051, IM:1.082 };
    var zoneScores = { LT:0, LP:0, AT:0, A3:0, A2:0, A1:0 };
    var totalDist3 = 0;
    function scoreLine(line) {
      if (line.type !== "swim" || !line.distM || !line.targetTime) return;
      var s3 = line.stroke || "FS";
      var p3 = pace200Map[s3] || pace200Map["FS"];
      if (!p3) return;
      var base3 = (p3 * (SMULT3[s3]||1.0)) / 2;
      var d3 = parseFloat(line.distM) || 0;
      var ts3 = String(line.targetTime); var tc3 = ts3.indexOf(":");
      var w3 = tc3 > -1 ? parseInt(ts3.slice(0,tc3))*60+parseFloat(ts3.slice(tc3+1)) : parseFloat(ts3)||0;
      if (!w3 || !d3) return;
      var sr3 = (w3/d3*100)/base3;
      var qty3 = (parseFloat(line.qty)||1) * d3;
      totalDist3 += qty3;
      if(sr3<0.97) zoneScores.LT += qty3;
      else if(sr3<1.025) zoneScores.LP += qty3;
      else if(sr3<1.10) zoneScores.AT += qty3;
      else if(sr3<1.22) zoneScores.A3 += qty3;
      else if(sr3<1.38) zoneScores.A2 += qty3;
      else zoneScores.A1 += qty3;
    }
    function scoreBlock(b) {
      (b.children||[]).forEach(function(c) {
        if (c.children !== undefined) scoreBlock(c);
        else scoreLine(c);
      });
    }
    scoreBlock(block);
    if (totalDist3 > 0) {
      var topZone = null; var topVal = 0;
      Object.keys(zoneScores).forEach(function(k) {
        if (zoneScores[k] > topVal) { topVal = zoneScores[k]; topZone = k; }
      });
      if (topZone && topVal/totalDist3 > 0.25) {
        blockZone = topZone;
        blockZoneColor = sbZoneColor(topZone);
      }
    }
  }
  return (
    <div style={{ marginBottom: depth > 0 ? 4 : 8 }}>
      <div onClick={onSelect ? function(e){e.stopPropagation();onSelect();} : undefined}
        style={{
          background: isSelected ? "rgba(48,176,199,0.07)" : depth>0 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.028)",
          border: "1px solid " + (isSelected ? "rgba(48,176,199,0.4)" : "rgba(255,255,255,"+(depth>0?"0.05":"0.08")+")"),
          borderLeft: isSelected ? "3px solid #30B0C7" : reps>1 ? "3px solid rgba(255,204,0,0.4)" : "3px solid rgba(255,255,255,0.08)",
          borderRadius:8, padding:"8px 10px", cursor: onSelect ? "pointer" : "default",
        }}>
        {/* Block header */}
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: block.children.length > 0 ? 5 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {reps > 1 && (
              <span style={{ fontSize: 15, fontWeight: 900, color: "#FFCC00",
                fontFamily: "monospace" }}>{block.repeats}&times;</span>
            )}
            {block.label && (
              <span style={{ fontSize: 10, color: "rgba(255,204,0,0.6)",
                fontStyle: "italic" }}>{block.label}</span>
            )}
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
              {Math.round(vol)}m &middot; {sbFmtDur(time)}
            </span>
            {blockZone && (
              <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3,
                background: blockZoneColor + "25",
                border: "1px solid " + blockZoneColor + "60",
                color: blockZoneColor, fontFamily: "monospace", fontWeight: 700 }}>
                {blockZone}
              </span>
            )}
          </div>
          {depth === 0 && (
            <div style={{ display: "flex", gap: 4 }}>
              {!isFirst && (
                <button onClick={onMoveUp} style={{ padding: "2px 6px",
                  background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 3, color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 10 }}>↑</button>
              )}
              {!isLast && (
                <button onClick={onMoveDown} style={{ padding: "2px 6px",
                  background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 3, color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 10 }}>↓</button>
              )}
              <button onClick={onEdit} style={{ padding: "2px 8px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3,
                color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 9 }}>edit</button>
              {onToggleSelect && (
                <button onClick={onToggleSelect}
                  style={{ padding:"2px 8px",
                    background: selectMode?"rgba(255,204,0,0.12)":"rgba(255,255,255,0.03)",
                    border:"1px solid "+(selectMode?"rgba(255,204,0,0.4)":"rgba(255,255,255,0.08)"),
                    borderRadius:3, color:selectMode?"#FFCC00":"rgba(255,255,255,0.3)",
                    cursor:"pointer", fontSize:9 }}>{selectMode?"✓ done":"select"}</button>
              )}
              <button onClick={onDelete} style={{ padding: "2px 6px",
                background: "rgba(255,45,85,0.07)", border: "1px solid rgba(255,45,85,0.2)",
                borderRadius: 3, color: "rgba(255,45,85,0.55)", cursor: "pointer", fontSize: 9 }}>✕</button>
            </div>
          )}
        </div>

        {/* Children */}
        {block.children.map(child => (
          child.children !== undefined
            ? <SbBlockView key={child.id} block={child} depth={1}
                sbZoneColor={sbZoneColor} sbFmtDur={sbFmtDur}
                sbBlockVolume={sbBlockVolume} sbBlockTotalTime={sbBlockTotalTime}
                sbLineRest={sbLineRest} pace200Map={pace200Map} phvStatus={phvStatus}
                convertTime={convertTime}
                onEdit={() => {}} onDelete={() => {}}
                onMoveUp={() => {}} onMoveDown={() => {}}
                isFirst={true} isLast={true} />
            : (
              <div key={child.id} style={{ display:"flex", alignItems:"flex-start", gap:4 }}>
                {selectMode && (
                  <input type="checkbox"
                    checked={!!(selectedLines&&selectedLines[child.id])}
                    onChange={function(e){
                      if(onBracket) onBracket(e.target.checked?"select":"deselect", child.id);
                    }}
                    style={{ marginTop:6, cursor:"pointer", accentColor:"#FFCC00" }} />
                )}
                <div style={{ flex:1 }}>
                  <SbLineView line={child} sbZoneColor={sbZoneColor} sbLineRest={sbLineRest}
                    pace200Map={pace200Map} phvStatus={phvStatus} convertTime={convertTime} />
                </div>
              </div>
            )
        ))}
        {selectMode && selectedLines && Object.keys(selectedLines).length >= 2 && (
          <button onClick={function(){if(onBracket)onBracket("bracket");}}
            style={{ marginTop:6, width:"100%", padding:"5px",
              background:"rgba(255,204,0,0.08)", border:"1px dashed rgba(255,204,0,0.35)",
              borderRadius:5, color:"#FFCC00", cursor:"pointer",
              fontFamily:"monospace", fontSize:9, fontWeight:700 }}>
            BRACKET {Object.keys(selectedLines).length} SELECTED LINES
          </button>
        )}
      </div>
    </div>
  );
}

// Line editor row

export default SbBlockView;
