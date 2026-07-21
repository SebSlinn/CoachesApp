// screens/ClassifierScreenRefactor.jsx

import React from 'react';
import { REST_TYPE_OPTS, ATHLETE_TYPE_OPTS, ENERGY_SYSTEMS, ZONE_GROUPS, ZONES, ZONE_WRITEUPS } from "../zones/index.js";
import { parseTime, fmtTime, secToDisplay, suggestTimes } from "../zones/index.js";
import { DRILL_LIBRARY } from "../drills/index.js";
import EnergyGraph from "../components/EnergyGraph.jsx";
import RepChart from "../components/RepChart.jsx";
import ZoneBar from "../components/ZoneBar.jsx";

export function ClassifierScreenRefactor({
  inputs,
  set,
  selectedZone,
  setSelectedZone,
  classifierDrill,
  setClassifierDrill,
  singleResult: rawSingleResult,
  seqResult,
  resultView,
  setResultView,
  activeAthlete,
  derivedProfile,
  poolDisplay,
  setPoolDisplay,
  selectedElement,
  onExitRefactor,
  // Set builder integration (optional — Add to Set button)
  sbNewLine,
  sbNewBlock,
  sbCommitBlock,
  editingBlock,
  setEditingBlock,
}) {
  const classifierSuggestion = (inputs.distM && inputs.stroke && inputs.pace200)
    ? (function() {
        try {
          const p200s = parseTime(inputs.pace200);
          if (!p200s) return null;
          const candidate = {};
          ["HVO","LT","LP","AT","CS","A3","A2","A1"].forEach(z => {
            candidate[z] = suggestTimes(z, inputs.distM, inputs.stroke, p200s, activeAthlete?.derivedProfile?.css);
          });
          return candidate;
        } catch(e) { return null; }
      })()
    : null;

  const zoneColors = {HVO:'#FF2D55',LT:'#FF5500',LP:'#FF9500',AT:'#FFCC00',CS:'#30B0C7',A3:'#34C759',A2:'#30B0C7',A1:'#007AFF'};
  const selectedSuggestion = classifierSuggestion && selectedZone ? classifierSuggestion[selectedZone] : null;
  const singleResult = seqResult || rawSingleResult;


  const restTypeOpt = REST_TYPE_OPTS.find(o => o.v === inputs.restType);
  const lb = { fontSize:10, color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:2, display:'block' };
  const inp = { background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:5, color:'#fff', fontFamily:'monospace', fontSize:13, outline:'none', padding:'5px 6px' };
  const DISTS = [25, 50, 75, 100, 150, 200, 300, 400, 800, 1500];
  function adjustDist(delta) {
    const cur = parseFloat(inputs.distM) || 100;
    const idx = DISTS.findIndex(d => d === cur);
    if (idx === -1) return;
    const next = DISTS[Math.min(DISTS.length - 1, Math.max(0, idx + delta))];
    set('distM', String(next));
  }


  function coachNote(r) {
    if (!r) return "";
    const notes = [];
    if (!r.restoreCheck?.atpcpRestored && r.avgAtpcp * 100 < 5)
      notes.push("ATP-CP virtually absent after rep 1. Set is glycolytic/aerobic from rep 2.");
    if (r.restoreCheck?.atpcpRestored)
      notes.push("Rest is sufficient — ATP-CP partially replenishes between reps.");
    if (r.workDur > 90 && r.speedRatio < 0.95)
      notes.push("Rep duration " + r.workDur?.toFixed(0) + "s — glycolytic system under sustained stress.");
    if (r.lastRep?.aerobic > 0.65)
      notes.push("By the last rep, aerobic contribution is ~" + (r.lastRep.aerobic * 100).toFixed(0) + "%.");
    return notes.join(" ");
  }

  return (
    <div>
      {activeAthlete && (
        <div style={{ background:'rgba(52,199,89,0.08)', border:'1px solid rgba(52,199,89,0.25)', borderRadius:8, padding:'8px 14px', marginBottom:12, display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px' }}>
          <span style={{ fontSize:10, color:'rgba(52,199,89,0.9)', letterSpacing:'0.06em' }}>
            {activeAthlete.name ? activeAthlete.name : 'ACTIVE ATHLETE'} {activeAthlete.seNumber ? '(' + activeAthlete.seNumber + ')' : ''} • {Object.keys(activeAthlete.times || {}).length} events
          </span>
          <span style={{ fontSize:9, color:'rgba(52,199,89,0.5)', textAlign:'right' }}>
            {ATHLETE_TYPE_OPTS.find(o => o.v === inputs.athleteType)?.l || 'All-Round'} • {{ pre:'Pre-PHV', developing:'Early Post-PHV', post:'Post-PHV' }[inputs.phvStatus]}
            {derivedProfile?.aiPct ? ' • ' + derivedProfile.aiPct + '% drop/doubling' : ''}
            {derivedProfile?.css ? ' • CSS ' + secToDisplay(derivedProfile.css) + '/100m' : ''}
          </span>
        </div>
      )}
      {selectedElement && seqResult && !editingBlock && (
        <div style={{ background:'rgba(48,176,199,0.08)', border:'1px solid rgba(48,176,199,0.25)', borderRadius:8, padding:'8px 12px', marginBottom:8, fontSize:10, color:'rgba(48,176,199,0.9)', letterSpacing:'0.04em' }}>
          Showing SetBuilder {selectedElement.type} analysis — numeric inputs are paused.
          <span style={{ opacity:0.6 }}> Open a block to edit to re-activate inputs.</span>
        </div>
      )}
      {selectedElement && seqResult && editingBlock && (
        <div style={{ background:'rgba(52,199,89,0.08)', border:'1px solid rgba(52,199,89,0.25)', borderRadius:8, padding:'8px 12px', marginBottom:8, fontSize:10, color:'rgba(52,199,89,0.9)', letterSpacing:'0.04em' }}>
          Editing block — classifier active. Use Add To Set to append lines to the open block.
        </div>
      )}

            {/* Inputs */}
    <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)",
        borderRadius:10, padding:"10px 14px", marginBottom:14 }}>

        {/* Row 1: numeric inputs */}
      
      <div style={{ background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, padding:'10px 14px', marginBottom:14 }}>

        {/* Numeric inputs row — greyed when SetBuilder element is selected */}
        <div style={{
          opacity: (selectedElement && seqResult && !editingBlock) ? 0.3 : 1,
          pointerEvents: (selectedElement && seqResult && !editingBlock) ? 'none' : 'auto',
          transition: 'opacity 0.2s',
        }}>
        <div style={{ display:'grid', gridTemplateColumns:'70px 110px 48px 72px 72px 78px', gap:'6px', alignItems:'end', marginBottom:8 }}>
          <div>
            <label style={lb}>Stroke</label>
            <select value={inputs.stroke} onChange={e => { const s=e.target.value; set('stroke',s); if(activeAthlete){ const t = activeAthlete.times['200_'+s]; if(t) set('pace200',t.display); }} }
              style={{ ...inp, width:'70px', padding:'5px', borderRadius:5 }}>
              <option value='FS'>FS</option><option value='BK'>BK</option><option value='BR'>BR</option><option value='Fly'>Fly</option><option value='IM'>IM</option>
            </select>
          </div>
          <div style={{ width:110 }}><label style={lb}>Dist m</label>
            <div style={{ display:'flex', gap:'0px' }}>
              <input style={{ ...inp, width:'100%', borderRadius:'5px 0 0 5px', textAlign:'right' }} value={inputs.distM} onChange={e => set('distM', e.target.value)} />
              <div style={{ display:'flex', flexDirection:'column', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'0 5px 5px 0', overflow:'hidden' }}>
                <button onClick={() => adjustDist(1)} style={{ padding:'0 6px', height:'50%', border:'none', background:'rgba(255,255,255,0.07)', color:'#fff', cursor:'pointer', fontSize:10 }}>▲</button>
                <button onClick={() => adjustDist(-1)} style={{ padding:'0 6px', height:'50%', border:'none', background:'rgba(255,255,255,0.07)', color:'#fff', cursor:'pointer', fontSize:10 }}>▼</button>
              </div>
            </div>
          </div>
          <div style={{ width:48 }}><label style={lb}>Qty</label>
            <input style={{ ...inp, padding:'5px 6px', width:'48px' }} type='number' value={inputs.qty} onChange={e => set('qty', e.target.value)} /></div>
          <div style={{ width:72 }}><label style={lb}>Target (IN)</label>
            <input style={{ ...inp, padding:'5px 6px', width:'72px' }} value={inputs.targetTime} onChange={e => set('targetTime', e.target.value)} />
          </div>
          <div style={{ width:72 }}><label style={lb}>ON</label>
            <input style={{ ...inp, padding:'5px 6px', width:'72px' }} placeholder='1:30' value={inputs.onTime} onChange={e => set('onTime', e.target.value)} />
          </div>
          <div style={{ width:78 }}><label style={lb}>200 PB</label>
            <input style={{ ...inp, padding:'5px 6px', width:'78px' }} value={inputs.pace200} onChange={e => set('pace200', e.target.value)} />
          </div>
        </div>
        </div> {/* end greyed numeric inputs wrapper */}

        <div style={{ display:'flex', gap:4, marginBottom:6 }}>
          {['HVO','LT','LP','AT','CS','A3','A2','A1'].map(function(z) {
            var zc = zoneColors[z];
            var active = selectedZone===z;
            return (
              <button key={z} onClick={() => { setSelectedZone(active ? null : z); setClassifierDrill(''); }}
                style={{ flex:1, padding:'5px 2px', borderRadius:5, cursor:'pointer', fontFamily:'monospace', fontSize:11, fontWeight:700,
                  border:'1px solid', borderColor: active ? zc : zc+'55', background: active ? zc+'25' : zc+'0A', color: active ? zc : zc+'99', transition:'all 0.15s' }}>
                {z}
              </button>
            );
          })}
        </div>

        <div style={{ display:'flex', gap:4, alignItems:'center', marginTop:6 }}>
          <span style={{ fontSize:9, color:'rgba(255,255,255,0.25)', letterSpacing:'0.08em', marginRight:2 }}>REST TYPE:</span>
          {REST_TYPE_OPTS.map(function(opt){ return (
            <button key={opt.v} onClick={() => set('restType', opt.v)} style={{ padding:'3px 10px', borderRadius:4, cursor:'pointer', fontFamily:'monospace', fontSize:9, fontWeight:700,
              border:'1px solid', borderColor: inputs.restType===opt.v ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.08)',
              background: inputs.restType===opt.v ? 'rgba(255,255,255,0.1)' : 'transparent', color: inputs.restType===opt.v ? '#fff' : 'rgba(255,255,255,0.3)'
            }}>{opt.l}</button>
          ); })}
        </div>
      </div>

      <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, padding:10, marginBottom:10 }}>
        {selectedSuggestion ? (
          (function() {
            const isCS = selectedZone === 'CS';
            const sg = selectedSuggestion;
            const cssPace = activeAthlete?.derivedProfile?.css;
            const dist3 = parseFloat(inputs.distM) || 100;

            const fmtOpt = sec => {
              const m = Math.floor(sec / 60);
              const s = Math.round(sec % 60);
              return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : String(s);
            };

            const inOpts = [];
            if (isCS && cssPace) {
              const cssTime = Math.round(cssPace * dist3 / 100);
              for (let di = -2; di <= 2; di++) inOpts.push(cssTime + di);
            } else {
              const inStep = Math.max(1, Math.round((sg.inHigh - sg.inLow) / 4));
              for (let i2 = sg.inLow; i2 <= sg.inHigh + 0.5; i2 += inStep) {
                inOpts.push(Math.round(i2));
                if (inOpts.length >= 5) break;
              }
            }

            const onOptsRaw = [];
            if (isCS && cssPace) {
              const cssTime2 = Math.round(cssPace * dist3 / 100);
              const inForOn = parseTime(inputs.targetTime) || cssTime2;
              const ratios = [2.0, 1.8, 1.7, 1.6, 1.5]; // descending ratio = ascending ON time
              ratios.forEach(r => onOptsRaw.push(Math.round((inForOn + inForOn / r) / 5) * 5));
            } else {
              const onStep = Math.max(5, Math.round((sg.onHigh - sg.onLow) / 4 / 5) * 5);
              for (let j2 = sg.onLow; j2 <= sg.onHigh + 2; j2 += onStep) {
                onOptsRaw.push(Math.round(j2 / 5) * 5);
                if (onOptsRaw.length >= 5) break;
              }
            }
            // Deduplicate and sort ascending (smallest ON = least rest first)
            const onOpts = [...new Set(onOptsRaw)].sort((a, b) => a - b);

            const zc = zoneColors[selectedZone] || '#fff';
            const showNoOn = selectedZone === 'A1' || (onOpts.length > 0 && onOpts[0] === onOpts[onOpts.length - 1] && onOpts[0] <= (sg.inHigh + 2));

            return (
              <>
                <div style={{ background:zc+'0A', border:'1px solid '+zc+'20', borderRadius:6, padding:'8px 10px', marginBottom:10 }}>
                  <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6 }}>
                    <span style={{ fontSize:9, color:zc, fontWeight:700, letterSpacing:'0.08em', width:24 }}>IN</span>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                      {inOpts.map(sec => {
                        const str = fmtOpt(sec);
                        const activeOpt = inputs.targetTime === str;
                        return (
                          <button key={sec} onClick={() => set('targetTime', str)}
                            style={{ padding:'4px 10px', borderRadius:4, cursor:'pointer', fontFamily:'monospace', fontSize:12, fontWeight:700,
                              border:'1px solid '+(activeOpt ? zc : zc+'55'),
                              background: activeOpt ? zc+'30' : zc+'10',
                              color: activeOpt ? zc : zc+'bb' }}>
                            {str}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <span style={{ fontSize:9, color:zc+'99', fontWeight:700, letterSpacing:'0.08em', width:24 }}>ON</span>
                    {showNoOn ? (
                      <span style={{ fontSize:10, color:zc+'77', fontStyle:'italic' }}>
                        {selectedZone === 'A1' ? 'straight-on (continuous)' : 'straight-on or short rest'}
                      </span>
                    ) : (
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                        {onOpts.map(sec => {
                          const str = fmtOpt(sec);
                          const activeOpt = inputs.onTime === str;
                          return (
                            <button key={sec} onClick={() => set('onTime', str)}
                              style={{ padding:'4px 10px', borderRadius:4, cursor:'pointer', fontFamily:'monospace', fontSize:12, fontWeight:700,
                                border:'1px solid '+(activeOpt ? zc : zc+'33'),
                                background: activeOpt ? zc+'20' : 'transparent',
                                color: activeOpt ? zc : zc+'77' }}>
                              {str}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {selectedZone && ['A1', 'A2', 'A3'].includes(selectedZone) && (() => {
                  const DL2 = DRILL_LIBRARY;
                  const ds = inputs.stroke;
                  const available2 = [];
                  if (DL2[ds]) DL2[ds].forEach(d => {
                    if (d.type !== 'drill' && d.type !== 'focus') return;
                    let ceilOk = !d.zoneCeiling;
                    if (!ceilOk) {
                      const zo = ['A1','A2','A3'];
                      ceilOk = zo.indexOf(selectedZone) <= zo.indexOf(d.zoneCeiling);
                    }
                    if (ceilOk) available2.push(d);
                  });
                  if (DL2.MULTI) DL2.MULTI.forEach(d => available2.push(d));
                  if (available2.length === 0) return null;

                  const ZC6 = { A3:'#34C759', A2:'#30B0C7', A1:'#007AFF' };
                  const zc6 = ZC6[selectedZone] || '#8E8E93';
                  const selD = available2.find(d => d.name === classifierDrill);

                  return (
                    <div style={{ marginTop:6, padding:'6px 8px', background:zc6+'08', border:'1px solid '+zc6+'20', borderRadius:5 }}>
                      <div style={{ fontSize:8, color:zc6+'99', letterSpacing:'0.08em', marginBottom:4 }}>DRILLS / FOCUS — {ds}</div>
                      <select value={classifierDrill} onChange={e => {
                        const name = e.target.value;
                        setClassifierDrill(name);
                        if (!name) return;
                        const chosen = available2.find(d => d.name === name);
                        if (!chosen || !chosen.paceFactor) return;
                        const SMULT6 = { FS:1.0, BK:1.045, BR:1.254, Fly:1.051, IM:1.082 };
                        const p6 = parseTime(inputs.pace200);
                        if (!p6) return;
                        const zoneSR6 = { A1:1.52, A2:1.30, A3:1.16 };
                        const sr6 = zoneSR6[selectedZone] || 1.30;
                        const dist6 = parseFloat(inputs.distM) || 100;
                        const base6 = (p6 * (SMULT6[ds]||1.0)) / 2;
                        const rawSec6 = base6 * (dist6/100) * chosen.paceFactor * sr6;
                        let m6 = Math.floor(rawSec6/60);
                        let s6 = Math.round(rawSec6 % 60);
                        if (s6 === 60) { m6++; s6 = 0; }
                        set('targetTime', m6 > 0 ? m6+':'+(s6<10?'0':'')+s6 : String(s6));
                      }} style={{ width:'100%', background:'rgba(255,255,255,0.07)', border:'1px solid '+zc6+'30', borderRadius:4, color:'#fff', padding:'4px 6px', fontFamily:'monospace', fontSize:10, outline:'none', cursor:'pointer' }}>
                        <option value=''>— select drill —</option>
                        {available2.map(d => (
                          <option key={d.name} value={d.name}>{d.name}{d.zoneCeiling ? ' [≤'+d.zoneCeiling+']' : ''}</option>
                        ))}
                      </select>
                      {selD && selD.objective && selD.objective !== 'detail_pending' && (
                        <div style={{ marginTop:4, fontSize:9, color:'rgba(255,255,255,0.4)', fontStyle:'italic', lineHeight:1.4 }}>{selD.objective}</div>
                      )}
                      {selD && selD.coachingNotes && selD.coachingNotes !== '' && selD.coachingNotes !== 'detail_pending' && (
                        <div style={{ marginTop:2, fontSize:9, color:'rgba(255,255,255,0.25)', lineHeight:1.4 }}>Coach: {selD.coachingNotes}</div>
                      )}
                    </div>
                  );
                })()}
              </>
            );
          })()
        ) : (
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.5)' }}>Pick a zone and valid stroke/dist/pace to see suggestion details.</div>
        )}
      </div>

      {/* Add to Set */}
      {inputs.distM && inputs.targetTime && sbNewLine && (
        <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:8 }}>
          <button onClick={() => {
            var inSec = parseTime(inputs.targetTime)||0;
            var onStr = inputs.onTime || (inSec > 0 ? String(Math.round(inSec)) : "");
            var newLine = sbNewLine({
              distM:inputs.distM, stroke:inputs.stroke, qty:inputs.qty,
              targetTime:inputs.targetTime, onTime:onStr,
              target:inputs.targetTime, turnaround:onStr,
              intensity:selectedZone||(singleResult&&singleResult.primary?singleResult.primary.id:"A2"),
              note:classifierDrill||"",
              modifier:classifierDrill?"Drill":"Full",
              poolType:poolDisplay,
            });
            if (editingBlock) {
              setEditingBlock(b => b ? {...b, children:[...b.children, newLine]} : b);
            } else {
              sbCommitBlock(sbNewBlock({children:[newLine]}));
            }
            setClassifierDrill?.("");
          }} style={{ padding:"7px 20px", background:"rgba(52,199,89,0.12)",
            border:"1px solid rgba(52,199,89,0.45)", borderRadius:6,
            color:"#34C759", cursor:"pointer", fontFamily:"monospace",
            fontSize:11, fontWeight:700, letterSpacing:"0.06em" }}>
            + ADD TO SET{editingBlock ? " (open block)" : ""}
          </button>
        </div>
      )}

      </div>

      {/* ── Zone detection banners ──────────────────────────────────────── */}
      {selectedZone === "CS" && singleResult?.csDetection && (
        <div style={{ background: singleResult.csDetection.isCS ? "rgba(48,176,199,0.12)" : "rgba(48,176,199,0.06)",
          border: "1px solid " + (singleResult.csDetection.isCS ? "rgba(48,176,199,0.5)" : "rgba(48,176,199,0.2)"),
          borderLeft: "4px solid " + (singleResult.csDetection.isCS ? "#30B0C7" : "rgba(48,176,199,0.3)"),
          borderRadius: 8, padding: "10px 14px", marginBottom: 10, fontSize: 11, lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, color: singleResult.csDetection.isCS ? "#30B0C7" : "rgba(48,176,199,0.7)", marginBottom: 4 }}>
            {singleResult.csDetection.isCS ? "✓ CS TRAINING SET" : "~ PARTIAL CS MATCH"}
          </div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 10 }}>
            <span style={{ color: singleResult.csDetection.speedOk ? "#34C759" : "rgba(255,255,255,0.3)" }}>
              Speed {singleResult.csDetection.speedOk ? "✓" : "✗"} {secToDisplay(singleResult.csDetection.repPace100)}/100m vs CSS {secToDisplay(singleResult.csDetection.cssPace)}/100m (±5%)
            </span>{" · "}
            <span style={{ color: singleResult.csDetection.restOk ? "#34C759" : "rgba(255,255,255,0.3)" }}>
              Work:rest {singleResult.csDetection.restOk ? "✓" : "✗"} {singleResult.csDetection.workRest}:1 (target ~1.5:1)
            </span>{" · "}
            <span style={{ color: singleResult.csDetection.volumeOk ? "#34C759" : "rgba(255,255,255,0.3)" }}>
              Volume {singleResult.csDetection.volumeOk ? "✓" : "✗"} {singleResult.csDetection.totalWorkMin} min (27–33 min)
            </span>
          </div>
        </div>
      )}
      {selectedZone === "CS" && !singleResult?.csDetection && (
        <div style={{ background: "rgba(48,176,199,0.05)", border: "1px solid rgba(48,176,199,0.15)",
          borderLeft: "4px solid rgba(48,176,199,0.25)", borderRadius: 8, padding: "8px 14px",
          marginBottom: 10, fontSize: 10, color: "rgba(48,176,199,0.5)" }}>
          {activeAthlete?.derivedProfile?.css ? "Enter set parameters to check against CSS pace"
            : "Load athlete times to calculate CSS — then time suggestions will appear"}
        </div>
      )}
      {selectedZone === "LP" && singleResult && (() => {
        const inRange = singleResult.speedRatio >= 0.97 && singleResult.speedRatio < 1.025;
        const restOk  = singleResult.restWorkRatio >= 1.0 && singleResult.restWorkRatio <= 1.2;
        const distOk  = parseFloat(inputs.distM) <= 100;
        const isLP    = inRange && restOk && distOk;
        return (
          <div style={{ background: isLP ? "rgba(255,149,0,0.10)" : "rgba(255,149,0,0.05)",
            border: "1px solid " + (isLP ? "rgba(255,149,0,0.45)" : "rgba(255,149,0,0.2)"),
            borderLeft: "4px solid " + (isLP ? "#FF9500" : "rgba(255,149,0,0.3)"),
            borderRadius: 8, padding: "10px 14px", marginBottom: 10, fontSize: 11, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: isLP ? "#FF9500" : "rgba(255,149,0,0.6)", marginBottom: 4 }}>
              {isLP ? "✓ LP SET" : "~ PARTIAL LP MATCH"}
            </div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 10 }}>
              <span style={{ color: inRange ? "#34C759" : "rgba(255,255,255,0.3)" }}>Pace {inRange?"✓":"✗"} {secToDisplay(singleResult.repPace100)}/100m</span>
              {" · "}
              <span style={{ color: restOk ? "#34C759" : "rgba(255,255,255,0.3)" }}>Rest {restOk?"✓":"✗"} {singleResult.restWorkRatio.toFixed(2)}:1 (need 1.0–1.2)</span>
              {" · "}
              <span style={{ color: distOk ? "#34C759" : "rgba(255,255,255,0.3)" }}>Dist {distOk?"✓":"✗"} {inputs.distM}m (25–100m)</span>
            </div>
          </div>
        );
      })()}
      {(selectedZone === "AT" || selectedZone === "A3") && singleResult && (() => {
        const zr = selectedZone === "AT" ? [1.025, 1.10] : [1.10, 1.22];
        const inR = singleResult.speedRatio >= zr[0] && singleResult.speedRatio < zr[1];
        const zc2 = selectedZone === "AT" ? "#FFCC00" : "#34C759";
        return (
          <div style={{ background: inR ? zc2+"12" : zc2+"06", border: "1px solid " + (inR ? zc2+"45" : zc2+"20"),
            borderLeft: "4px solid " + (inR ? zc2 : zc2+"40"), borderRadius: 8, padding: "8px 14px",
            marginBottom: 10, fontSize: 10, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
            <span style={{ fontWeight: 700, color: inR ? zc2 : zc2+"80", marginRight: 8 }}>
              {inR ? "✓ " + selectedZone : "✗ Outside " + selectedZone}
            </span>
            {secToDisplay(singleResult.repPace100)}/100m · rest:work {singleResult.restWorkRatio.toFixed(1)}:1
            {selectedZone === "AT" && " · target 1.8–3.3:1 work:rest"}
            {selectedZone === "A3" && " · target 6.7–∞:1 work:rest"}
          </div>
        );
      })()}

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {singleResult ? (
        <div style={{ animation: "fadeIn 0.35s ease" }}>

          {singleResult.plSuggestion && (
            <div style={{ background: "rgba(204,34,0,0.08)", border: "1px solid rgba(204,34,0,0.3)",
              borderLeft: "4px solid #CC2200", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 11, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: "rgba(204,34,0,0.9)", marginBottom: 4 }}>⚑ POSSIBLE PL TERRITORY</div>
              <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 10 }}>{singleResult.plSuggestion.note}</div>
            </div>
          )}

          {singleResult.paceValidation?.warningLevel && (
            <div style={{ background: singleResult.paceValidation.warningLevel === "impossible" ? "rgba(255,45,85,0.15)" : "rgba(255,149,0,0.12)",
              border: `1px solid ${singleResult.paceValidation.warningLevel === "impossible" ? "rgba(255,45,85,0.5)" : "rgba(255,149,0,0.4)"}`,
              borderLeft: `4px solid ${singleResult.paceValidation.warningLevel === "impossible" ? "#FF2D55" : "#FF9500"}`,
              borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 11, lineHeight: 1.6,
              color: singleResult.paceValidation.warningLevel === "impossible" ? "rgba(255,180,180,0.95)" : "rgba(255,220,150,0.95)" }}>
              {singleResult.paceValidation.warningMsg}
            </div>
          )}

          {singleResult.consistencyWarning && (
            <div style={{ background: "rgba(255,149,0,0.12)", border: "1px solid rgba(255,149,0,0.4)",
              borderLeft: "4px solid #FF9500", borderRadius: 8, padding: "12px 14px", marginBottom: 14,
              fontSize: 11, lineHeight: 1.7, color: "rgba(255,220,150,0.95)" }}>
              <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12 }}>⚠ CONSISTENCY WARNING</div>
              <div>Target {fmtTime(singleResult.workDur)} — rep {singleResult.consistencyWarning.rep} estimated ~{fmtTime(singleResult.consistencyWarning.estimatedTime)} ({singleResult.consistencyWarning.degradationPct.toFixed(1)}% slower).</div>
              <div style={{ marginTop: 6, fontSize: 10, opacity: 0.75 }}>
                Suggest rest ~{singleResult.consistencyWarning.suggestedRest}s{inputs.restType !== "a1" && " or Active A1 recovery"} · or target ~{fmtTime(singleResult.consistencyWarning.suggestedTime)}.
              </div>
            </div>
          )}

          {singleResult.phvWarning && (
            <div style={{ background: "rgba(255,149,0,0.12)", border: "1px solid rgba(255,149,0,0.35)",
              borderLeft: "4px solid #FF9500", borderRadius: 8, padding: "10px 14px", marginBottom: 14,
              fontSize: 11, color: "rgba(255,220,150,0.9)", lineHeight: 1.6 }}>
              {singleResult.phvWarning}
            </div>
          )}

          {/* Key metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
            {[
              { l: "Speed",    v: `${(singleResult.speedRatio*100).toFixed(0)}%`, s: "of 200m pace" },
              { l: "Work dur", v: fmtTime(singleResult.workDur),                  s: "per rep" },
              { l: "Rest:Work",v: `${singleResult.restWorkRatio.toFixed(1)}:1`,
                s: singleResult.restoreCheck?.atpcpRestored ? "✓ ATP-CP restores" : "✗ ATP-CP depletes" },
              { l: "Volume",   v: `${singleResult.totalVolume}m`,
                s: `${singleResult.breakdown[0]?.pct}% ${singleResult.primary?.id}` },
            ].map(m => (
              <div key={m.l} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "9px 11px" }}>
                <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", marginBottom: 3 }}>{m.l.toUpperCase()}</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{m.v}</div>
                <div style={{ fontSize: 8, color: m.s.includes("✓") ? "#34C759" : m.s.includes("✗") ? "#FF5500" : "rgba(255,255,255,0.3)" }}>{m.s}</div>
              </div>
            ))}
          </div>

          {/* Layer toggle */}
          <div style={{ display: "flex", gap: 0, marginBottom: 14, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
            {[{v:"energy",l:"⚡ Energy Systems"},{v:"zones",l:"⬡ Training Zones"},{v:"adaptations",l:"◈ Adaptations"}].map(t => (
              <button key={t.v} onClick={() => setResultView(t.v)} style={{
                flex: 1, padding: "9px 6px", border: "none", cursor: "pointer", fontFamily: "monospace",
                fontSize: 10, fontWeight: 700, background: resultView === t.v ? "rgba(255,255,255,0.12)" : "transparent",
                color: resultView === t.v ? "#fff" : "rgba(255,255,255,0.3)",
                borderRight: "1px solid rgba(255,255,255,0.08)", transition: "all 0.2s" }}>{t.l}</button>
            ))}
          </div>

          {/* LAYER 1 — ENERGY SYSTEMS */}
          {resultView === "energy" && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
                {ENERGY_SYSTEMS.map(sys => {
                  const pct = sys.id==="atpcp" ? singleResult.avgAtpcp : sys.id==="glycolytic" ? singleResult.avgGlycolytic : singleResult.avgAerobic;
                  return (
                    <div key={sys.id} style={{ background: sys.color+"18", border: `1px solid ${sys.color}40`, borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginBottom: 3 }}>{sys.label.toUpperCase()}</div>
                      <div style={{ fontSize: 24, fontWeight: 900, color: sys.color }}>{(pct*100).toFixed(0)}%</div>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                        {sys.id==="atpcp" ? (singleResult.restoreCheck?.atpcpRestored ? "replenishes between reps" : "depletes from rep 2") : sys.subLabel}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", marginBottom: 8 }}>REP-BY-REP ENERGY DRIFT</div>
                <RepChart repResults={singleResult.repResults} />
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", marginBottom: 8 }}>ENERGY SYSTEM CURVE (single rep)</div>
                <EnergyGraph result={singleResult} />
              </div>

              {/* Detail cards — mechanism, adaptations, PHV note */}
              {ENERGY_SYSTEMS.map(sys => {
                const pct = sys.id==="atpcp" ? singleResult.avgAtpcp : sys.id==="glycolytic" ? singleResult.avgGlycolytic : singleResult.avgAerobic;
                if (pct * 100 < 3) return null;
                return (
                  <div key={sys.id} style={{ background: "rgba(255,255,255,0.025)",
                    border: `1px solid ${sys.color}30`, borderLeft: `3px solid ${sys.color}`,
                    borderRadius: 8, padding: "12px 14px", marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 900, color: sys.color }}>{sys.label}</span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginLeft: 8 }}>{sys.subLabel}</span>
                      </div>
                      <span style={{ fontSize: 20, fontWeight: 900, color: sys.color }}>{(pct*100).toFixed(0)}%</span>
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, marginBottom: 8 }}>
                      {sys.mechanism}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", marginBottom: 5 }}>SPECIFIC ADAPTATIONS</div>
                        {sys.specific.map((s,i) => (
                          <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", marginBottom: 3,
                            paddingLeft: 8, borderLeft: `2px solid ${sys.color}60`, lineHeight: 1.5 }}>{s}</div>
                        ))}
                      </div>
                      <div>
                        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", marginBottom: 5 }}>GENERAL ADAPTATIONS</div>
                        {sys.general.map((s,i) => (
                          <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", marginBottom: 3,
                            paddingLeft: 8, borderLeft: "2px solid rgba(255,255,255,0.15)", lineHeight: 1.5 }}>{s}</div>
                        ))}
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)",
                      background: "rgba(255,255,255,0.03)", borderRadius: 4, padding: "5px 8px" }}>
                      <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 700 }}>PHV: </span>{sys.phvNote}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* LAYER 2 — TRAINING ZONES */}
          {resultView === "zones" && (
            <div>
              {singleResult.csDetection?.isCS ? (
                <div style={{ background: "rgba(48,176,199,0.12)", border: "1px solid rgba(48,176,199,0.5)",
                  borderLeft: "4px solid #30B0C7", borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "rgba(48,176,199,0.6)", letterSpacing: "0.1em" }}>TRAINING OBJECTIVE</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#30B0C7", marginTop: 1 }}>CS — Critical Speed Training</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 4, lineHeight: 1.6 }}>
                    Sustained work at CSS pace. Raises the critical speed threshold. 27–33 min total work at ~1.5:1 work:rest.
                  </div>
                </div>
              ) : (
                <div style={{ background: singleResult.primary.color+"1a", border: `1px solid ${singleResult.primary.color}45`,
                  borderLeft: `4px solid ${singleResult.primary.color}`, borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em" }}>PRIMARY ZONE</div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: singleResult.primary.color, marginTop: 1 }}>{singleResult.primary.name}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 4, maxWidth: 360 }}>{singleResult.primary.desc}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 32, fontWeight: 900, color: singleResult.primary.color }}>{singleResult.primary.pct}%</div>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>RPE {singleResult.primary.rpe}</div>
                    </div>
                  </div>
                </div>
              )}
              <ZoneBar breakdown={singleResult.breakdown} />
              {ZONE_GROUPS.map(grp => {
                const gz = singleResult.breakdown.filter(z => grp.members.includes(z.id) && z.pct > 0);
                const gp = gz.reduce((s,z) => s+z.pct, 0);
                if (gp === 0) return null;
                return (
                  <div key={grp.zone} style={{ background: "rgba(255,255,255,0.02)",
                    border: `1px solid ${grp.color}25`, borderLeft: `3px solid ${grp.color}`,
                    borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: grp.color }}>{grp.label}</span>
                      <span style={{ fontSize: 14, fontWeight: 900, color: grp.color }}>{gp}%</span>
                    </div>
                    {gz.map(z => (
                      <div key={z.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: z.color, flexShrink: 0 }} />
                        <div style={{ fontSize: 10, width: 170, color: "rgba(255,255,255,0.6)" }}>{z.name}</div>
                        <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ width: `${z.pct}%`, height: "100%", background: z.color, borderRadius: 2 }} />
                        </div>
                        <div style={{ fontSize: 11, width: 30, textAlign: "right", fontWeight: 700, color: z.color }}>{z.pct}%</div>
                        <div style={{ fontSize: 9, width: 70, color: "rgba(255,255,255,0.25)" }}>RPE {z.rpe}</div>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 14, marginBottom: 12, marginTop: 10 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", marginBottom: 8 }}>REP-BY-REP ENERGY DRIFT</div>
                <RepChart repResults={singleResult.repResults} />
              </div>

              {/* Zone detail writeup — shows for the primary zone */}
              {(() => {
                const zoneId = singleResult.csDetection?.isCS ? "CS" : singleResult.primary?.id;
                const wr = zoneId && ZONE_WRITEUPS[zoneId];
                if (!wr) return null;
                const zc = {HVO:"#FF2D55",LT:"#FF5500",LP:"#FF9500",AT:"#FFCC00",CS:"#30B0C7",A3:"#34C759",A2:"#30B0C7",A1:"#007AFF"}[zoneId] || "#fff";
                return (
                  <div style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${zc}30`,
                    borderLeft: `3px solid ${zc}`, borderRadius: 8, padding: "12px 14px", marginBottom: 10 }}>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 900, color: zc }}>{zoneId} — {wr.name}</span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{wr.domain}</span>
                      </div>
                      <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
                        {[["HR",wr.hr],["LA⁴",wr.la],["RPE",wr.rpe]].map(([k,v]) => (
                          <span key={k} style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>
                            <span style={{ color: "rgba(255,255,255,0.25)" }}>{k}: </span>{v}
                          </span>
                        ))}
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", lineHeight: 1.6, marginBottom: 10 }}>
                        {wr.description}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", marginBottom: 5 }}>USED FOR</div>
                          {wr.usedFor.map((s,i) => (
                            <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", marginBottom: 3,
                              paddingLeft: 8, borderLeft: `2px solid ${zc}50`, lineHeight: 1.5 }}>{s}</div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", marginBottom: 5 }}>PRIMARY ADAPTATIONS</div>
                          {wr.primary.map((s,i) => (
                            <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", marginBottom: 3,
                              paddingLeft: 8, borderLeft: "2px solid rgba(255,255,255,0.15)", lineHeight: 1.5 }}>{s}</div>
                          ))}
                          {wr.secondary && (
                            <>
                              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", letterSpacing: "0.1em", marginTop: 8, marginBottom: 4 }}>SECONDARY</div>
                              {wr.secondary.map((s,i) => (
                                <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 3,
                                  paddingLeft: 8, borderLeft: "2px solid rgba(255,255,255,0.08)", lineHeight: 1.5 }}>{s}</div>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 9, color: "rgba(255,255,255,0.3)",
                        background: "rgba(255,255,255,0.03)", borderRadius: 4, padding: "5px 8px" }}>
                        <span style={{ color: "rgba(255,255,255,0.4)", fontWeight: 700 }}>Set structure: </span>{wr.setStructure}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* LAYER 3 — ADAPTATIONS */}
          {resultView === "adaptations" && (
            <div>
              {ZONE_GROUPS.map(grp => {
                const gz = singleResult.breakdown.filter(z => grp.members.includes(z.id) && z.pct >= 5);
                if (!gz.length) return null;
                const gp = singleResult.breakdown.filter(z => grp.members.includes(z.id)).reduce((s,z) => s+z.pct, 0);
                return (
                  <div key={grp.zone} style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                      borderBottom: `1px solid ${grp.color}40`, paddingBottom: 6, marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 900, color: grp.color }}>{grp.label}</span>
                      <span style={{ fontSize: 16, fontWeight: 900, color: grp.color }}>{gp}%</span>
                    </div>
                    {gz.map(z => {
                      const adpt = grp.adaptations?.[z.id];
                      if (!adpt) return null;
                      return (
                        <div key={z.id} style={{ background: `${z.color}10`, border: `1px solid ${z.color}25`, borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: z.color }}>{z.name}</span>
                            <span style={{ fontSize: 13, fontWeight: 900, color: z.color }}>{z.pct}%</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div>
                              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", marginBottom: 5 }}>SPECIFIC ADAPTATIONS</div>
                              {adpt.specific.map((s,i) => <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", marginBottom: 3, paddingLeft: 8, borderLeft: `2px solid ${z.color}60`, lineHeight: 1.5 }}>{s}</div>)}
                            </div>
                            <div>
                              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", marginBottom: 5 }}>GENERAL ADAPTATIONS</div>
                              {adpt.general.map((s,i) => <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", marginBottom: 3, paddingLeft: 8, borderLeft: "2px solid rgba(255,255,255,0.12)", lineHeight: 1.5 }}>{s}</div>)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div style={{ background: "rgba(52,199,89,0.06)", border: "1px solid rgba(52,199,89,0.2)", borderLeft: "3px solid #34C759", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#34C759", letterSpacing: "0.1em", marginBottom: 4 }}>THE ENGINE SIZE PRINCIPLE — SWEETENHAM</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                  The aerobic base built during childhood and early adolescence has a disproportionate impact on adult performance. Time spent in A1–A2 as a young swimmer is the most important long-term investment.
                </div>
              </div>
            </div>
          )}

          {coachNote(singleResult) && (
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
              borderLeft: "3px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "10px 14px", marginBottom: 14,
              fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.7 }}>
              <span style={{ color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", fontSize: 9, textTransform: "uppercase" }}>Coaching note · </span>
              {coachNote(singleResult)}
            </div>
          )}

          <div style={{ textAlign: "center", marginTop: 8, marginBottom: 24 }}>
            <button onClick={() => {
              const win = window.open("", "_blank");
              if (!win) return;
              win.document.write(`<!DOCTYPE html><html><head><title>Zone Report</title><style>body{font-family:monospace;margin:32px;color:#111}h2{font-size:13px;text-transform:uppercase;border-bottom:1px solid #ddd;padding-bottom:4px;margin:16px 0 8px}table{width:100%;border-collapse:collapse}th{background:#111;color:#fff;padding:6px 8px;font-size:10px}@media print{body{margin:16px}}</style></head><body>
              <h1>SWIM ZONE CLASSIFIER</h1>
              <p style="font-size:11px;color:#888">${new Date().toLocaleDateString("en-GB")} · ${inputs.stroke} · ${inputs.distM}m × ${inputs.qty} · IN ${inputs.targetTime} · ON ${inputs.onTime||"—"}</p>
              <h2>Primary Zone: ${singleResult.primary.name} — ${singleResult.primary.pct}%</h2>
              <p>${singleResult.primary.desc}</p>
              <h2>Zone Breakdown</h2><table><thead><tr><th>Zone</th><th>%</th><th>RPE</th><th>Description</th></tr></thead><tbody>
              ${singleResult.breakdown.filter(z=>z.pct>0).map(z=>`<tr><td style="padding:5px 8px">${z.name}</td><td style="padding:5px 8px;font-weight:700;color:${z.color}">${z.pct}%</td><td style="padding:5px 8px">${z.rpe}</td><td style="padding:5px 8px;font-size:11px;color:#666">${z.desc}</td></tr>`).join("")}
              </tbody></table>
              <h2>Energy Systems</h2><p>ATP-CP: ${(singleResult.avgAtpcp*100).toFixed(0)}% · Glycolytic: ${(singleResult.avgGlycolytic*100).toFixed(0)}% · Aerobic: ${(singleResult.avgAerobic*100).toFixed(0)}%</p>
              ${singleResult.phvWarning ? `<div style="background:#fff3cd;border-left:4px solid #ff9500;padding:10px;margin:12px 0">${singleResult.phvWarning}</div>` : ""}
              </body></html>`);
              win.document.close(); setTimeout(() => win.print(), 400);
            }} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 8, color: "#fff", padding: "10px 28px", fontFamily: "monospace", fontSize: 12, cursor: "pointer" }}>
              ⎙ PRINT REPORT
            </button>
          </div>

        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "36px 0", color: "rgba(255,255,255,0.18)", fontSize: 11, letterSpacing: "0.1em" }}>
          ENTER SET PARAMETERS TO CLASSIFY
        </div>
      )}
    </div>
  );
}
