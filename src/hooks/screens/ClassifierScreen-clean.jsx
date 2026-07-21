// screens/ClassifierScreen.jsx - Classifier tab UI - CLEAN VERSION

import { useClassifier } from "../hooks/useClassifier";
import { parseTime, REST_TYPE_OPTS } from "../zones/index.js";

export function ClassifierScreen({ 
  activeAthlete, poolDisplay, editingBlock,
  sbNewLine, sbNewBlock, sbCommitBlock, coachNote
}) {
  const {
    inputs,
    updateInput,
    selectedZone,
    setSelectedZone,
    suggestions,
  } = useClassifier();

  const set = (k, v) => updateInput(k, v);

  const labelStyle = { 
    fontSize: "8px", 
    color: "rgba(255,255,255,0.3)", 
    letterSpacing: "0.06em", 
    marginBottom: 2, 
    fontWeight: 600, 
    textTransform: "uppercase" 
  };
  
  const inputStyle = { 
    background: "rgba(255,255,255,0.05)", 
    border: "1px solid rgba(255,255,255,0.1)", 
    borderRadius: 5, 
    color: "#fff", 
    padding: "5px 6px", 
    fontFamily: "monospace", 
    fontSize: 13, 
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div>
      {/* Active athlete banner */}
      {activeAthlete && (
        <div style={{ 
          background: "rgba(52,199,89,0.08)", 
          border: "1px solid rgba(52,199,89,0.25)",
          borderRadius: 8, 
          padding: "8px 14px", 
          marginBottom: 12
        }}>
          <span style={{ 
            fontSize: 10, 
            color: "rgba(52,199,89,0.9)", 
            letterSpacing: "0.06em" 
          }}>
            {activeAthlete.name || "ACTIVE ATHLETE"} {activeAthlete.seNumber && `(${activeAthlete.seNumber})`}
          </span>
        </div>
      )}

      {/* Inputs Panel */}
      <div style={{ 
        background: "rgba(255,255,255,0.025)", 
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 10, 
        padding: "12px 14px", 
        marginBottom: 14 
      }}>
        
        {/* Row 1: All text inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(70px, 1fr))", gap: 8, marginBottom: 12 }}>
          {/* Stroke */}
          <div>
            <label style={labelStyle}>Stroke</label>
            <select 
              value={inputs.stroke}
              onChange={e => set("stroke", e.target.value)}
              style={inputStyle}
            >
              <option value="FS">FS</option>
              <option value="BK">BK</option>
              <option value="BR">BR</option>
              <option value="Fly">Fly</option>
              <option value="IM">IM</option>
            </select>
          </div>

          {/* Distance */}
          <div>
            <label style={labelStyle}>Dist (m)</label>
            <input 
              type="text"
              value={inputs.distM}
              onChange={e => set("distM", e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Qty */}
          <div>
            <label style={labelStyle}>Qty</label>
            <input 
              type="number"
              value={inputs.qty}
              onChange={e => set("qty", e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Target Time */}
          <div>
            <label style={labelStyle}>Target</label>
            <input 
              type="text"
              value={inputs.targetTime}
              onChange={e => set("targetTime", e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* ON Time */}
          <div>
            <label style={labelStyle}>ON</label>
            <input 
              type="text"
              placeholder="rest"
              value={inputs.onTime}
              onChange={e => set("onTime", e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* 200 PB */}
          <div>
            <label style={labelStyle}>200 PB</label>
            <input 
              type="text"
              value={inputs.pace200}
              onChange={e => set("pace200", e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Row 2: Zone Selector Buttons */}
        <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
          {["HVO", "LT", "LP", "AT", "CS", "A3", "A2", "A1"].map(z => {
            const ZC = { 
              HVO: "#FF2D55", LT: "#FF5500", LP: "#FF9500", AT: "#FFCC00", 
              CS: "#30B0C7", A3: "#34C759", A2: "#30B0C7", A1: "#007AFF" 
            };
            const zc = ZC[z] || "#fff";
            const isActive = selectedZone === z;
            return (
              <button
                key={z}
                onClick={() => setSelectedZone(isActive ? null : z)}
                style={{
                  flex: 1,
                  minWidth: 40,
                  padding: "5px 2px",
                  borderRadius: 5,
                  cursor: "pointer",
                  fontFamily: "monospace",
                  fontSize: 11,
                  fontWeight: 700,
                  border: `1px solid ${isActive ? zc : zc + "55"}`,
                  background: isActive ? zc + "25" : zc + "0A",
                  color: isActive ? zc : zc + "99",
                  transition: "all 0.15s"
                }}
              >
                {z}
              </button>
            );
          })}
        </div>

        {/* Row 3: Rest Type */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: "0.08em", marginRight: 4 }}>REST:</span>
          {REST_TYPE_OPTS.map(o => (
            <button
              key={o.v}
              onClick={() => set("restType", o.v)}
              style={{
                padding: "3px 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 9,
                fontWeight: 700,
                border: `1px solid ${inputs.restType === o.v ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.08)"}`,
                background: inputs.restType === o.v ? "rgba(255,255,255,0.1)" : "transparent",
                color: inputs.restType === o.v ? "#fff" : "rgba(255,255,255,0.35)",
                whiteSpace: "nowrap"
              }}
            >
              {o.l}
            </button>
          ))}
        </div>

        {/* Row 4: Zone Suggestions */}
        {selectedZone && suggestions && suggestions[selectedZone] && (() => {
          const sg = suggestions[selectedZone];
          const ZC = { 
            HVO: "#FF2D55", LT: "#FF5500", LP: "#FF9500", AT: "#FFCC00", 
            CS: "#30B0C7", A3: "#34C759", A2: "#30B0C7", A1: "#007AFF" 
          };
          const zc = ZC[selectedZone] || "#fff";
          const times = [sg.inLowStr, sg.inMidStr, sg.inHighStr].filter(Boolean);
          return (
            <div style={{ 
              background: zc + "0A", 
              border: "1px solid " + zc + "25",
              borderRadius: 6, 
              padding: "8px 10px", 
              marginBottom: 12 
            }}>
              <div style={{ fontSize: 8, color: zc, fontWeight: 700, marginBottom: 4, letterSpacing: "0.05em" }}>
                {selectedZone} TIMES
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {times.map(time => (
                  <button
                    key={time}
                    onClick={() => set("targetTime", time)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontFamily: "monospace",
                      fontSize: 11,
                      fontWeight: 700,
                      border: `1px solid ${inputs.targetTime === time ? zc : zc + "55"}`,
                      background: inputs.targetTime === time ? zc + "30" : zc + "10",
                      color: inputs.targetTime === time ? zc : zc + "bb"
                    }}
                  >
                    {time}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Row 5: Add to Set Button */}
        {inputs.distM && inputs.targetTime && (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button 
              onClick={() => {
                const inSec = parseTime(inputs.targetTime) || 0;
                const onStr = inputs.onTime || (inSec > 0 ? String(Math.round(inSec + (parseFloat(inputs.restSec) || 0))) : "");
                const newLine = sbNewLine({
                  dist: inputs.distM,
                  stroke: inputs.stroke,
                  qty: inputs.qty,
                  targetTime: inputs.targetTime,
                  onTime: onStr,
                  intensity: selectedZone || "A2",
                  note: "",
                  modifier: "Full",
                  poolType: poolDisplay,
                });
                sbCommitBlock(sbNewBlock({ children: [newLine] }));
              }}
              style={{
                padding: "7px 20px",
                background: "rgba(52,199,89,0.12)",
                border: "1px solid rgba(52,199,89,0.45)",
                borderRadius: 6,
                color: "#34C759",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em"
              }}
            >
              + ADD TO SET
            </button>
          </div>
        )}
      </div>

      {/* Status */}
      <div style={{ 
        textAlign: "center", 
        padding: "12px 0", 
        color: "rgba(255,255,255,0.2)", 
        fontSize: 10,
        letterSpacing: "0.05em"
      }}>
        {suggestions && Object.values(suggestions).some(Boolean) 
          ? "Select zone to see time suggestions"
          : "Enter stroke, distance, and 200 PB"}
      </div>

      <style>{`
        option { background: #1a1a28; color: #fff; }
        input:focus, select:focus { border-color: rgba(255, 255, 255, 0.3) !important; }
      `}</style>
    </div>
  );
}
