


import { supabase } from "../supabaseClient";

supabase.from('users').select('count').then(({ data, error }) => {
  if (error) {
    console.error('Supabase connection FAILED:', error.message)
  } else {
    console.log('Supabase connection SUCCESS')
  }
})

// App.jsx — Main application shell. Shared state lives here.
import { useState, useEffect, useRef } from 'react';

import {
  STROKE_MULT, REST_TYPE_OPTS, ATHLETE_TYPE_OPTS,
  ENERGY_SYSTEMS, ZONE_GROUPS, ZONES,
  parseTime, fmtTime, secToDisplay,
  validatePace,
  glycoCapacity, phvZoneCaps, repEnergy, paceImpairment, consistencyCheck,
  classifySet, suggestTimes,
} from '../zones/index.js';

import { flattenBlock, classifySequence } from '../session/index.js';

import {
  STALE_MONTHS, VALID_DISTS, STROKE_NAMES,
  parseDateToAge, splitTimeToken, parseTimeToSec, deriveAthleteType,
} from '../athlete/index.js';

import { DRILL_LIBRARY } from '../drills/index.js';

import EnergyGraph   from '../components/EnergyGraph.jsx';
import ZoneBar       from '../components/ZoneBar.jsx';
import RepChart      from '../components/RepChart.jsx';
import SbLineView    from '../components/SbLineView.jsx';
import SbBlockView   from '../components/SbBlockView.jsx';
import SbLineEditor  from '../components/SbLineEditor.jsx';
import SbBlockEditor from '../components/SbBlockEditor.jsx';
import { ClassifierScreenRefactor } from '../screens/ClassifierScreenRefactor.jsx';

export default function App() {
  const [tab, setTab] = useState("classifier");
  const [poolDisplay, setPoolDisplay] = useState("25SC"); // 50LC | 25SC | 25Y
  const [selectedElement, setSelectedElement] = useState(null);
  const [seqResult, setSeqResult] = useState(null);
  const [useRefactorClassifier, setUseRefactorClassifier] = useState(false);

  // ── Classifier state ────────────────────────────────────────────────────────
  const [inputs, setInputs] = useState({
    distM: "100", qty: "10", targetTime: "1:10", onTime: "", restSec: "20",
    pace200: "2:12", stroke: "FS", phvStatus: "post",
    restType: "stationary", athleteType: "allround",
  });
  const [selectedZone, setSelectedZone] = useState(null);
  const [classifierDrill, setClassifierDrill] = useState("");
  const [singleResult, setSingleResult] = useState(null);
  const [resultView, setResultView] = useState("zones");

  function set(k, v) { setInputs(p => ({ ...p, [k]: v })); }

  // ── Athlete Setup state ─────────────────────────────────────────────────────
  const [rawPaste, setRawPaste]       = useState("");
  const [showCsv, setShowCsv]         = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [athleteName, setAthleteName] = useState("");
  const [seNumber, setSeNumber]       = useState("");
  const [clubName, setClubName]       = useState("");
  const [athleteTimes, setAthleteTimes] = useState({});
  const [parseLog, setParseLog]       = useState([]);
  const [activeAthlete, setActiveAthlete] = useState(null);
  const [derivedProfile, setDerivedProfile] = useState(null);

  // ── Set Builder state ───────────────────────────────────────────────────────
  const [lineSelectMode, setLineSelectMode] = useState(null); // blockId or null
  const [selectedLines, setSelectedLines] = useState({});    // {lineId: true}

  const [session, setSession] = useState({
    title: "",
    groups: [
      { id: "g1", label: "Warm Up",  blocks: [] },
      { id: "g2", label: "Main Set", blocks: [] },
    ]
  });
  const [activeGroup, setActiveGroup]   = useState("g1");
  const [editingBlock, setEditingBlock] = useState(null);
  const [editingInnerBlock, setEditingInnerBlock] = useState(null);

  const sharedClassifierProps = {
    inputs,
    set,
    selectedZone,
    setSelectedZone,
    classifierDrill,
    setClassifierDrill,
    singleResult,
    setSingleResult,
    seqResult,
    setSeqResult,
    resultView,
    setResultView,
    activeAthlete,
    setActiveAthlete,
    derivedProfile,
    poolDisplay,
    setPoolDisplay,
    session,
    setSession,
    onExitRefactor: () => setUseRefactorClassifier(false),
  };

  // ── Set Builder factories ───────────────────────────────────────────────────
  function sbId() { return "x" + Date.now() + Math.random().toString(36).slice(2,6); }
  function sbNewLine(defaults) {
    return { id: sbId(), qty: "1", distM: "", stroke: "FS", modifier: "Full",
             intensity: "A2", targetTime: "", onTime: "", note: "", type: "swim",
             poolType: poolDisplay, ...defaults };
  }
  function sbNewBlock(defaults) {
    return { id: sbId(), repeats: "1", label: "", children: [], ...defaults };
  }

  // ── Set Builder session mutations ───────────────────────────────────────────
  function sbAddGroup() {
    const id = sbId();
    setSession(s => ({ ...s, groups: [...s.groups, { id, label: "Set", blocks: [] }] }));
    setActiveGroup(id);
  }
  function sbUpdateGroup(id, key, val) {
    setSession(s => ({ ...s, groups: s.groups.map(g => g.id === id ? { ...g, [key]: val } : g) }));
  }
  function sbDeleteGroup(id) {
    setSession(s => ({ ...s, groups: s.groups.filter(g => g.id !== id) }));
    setActiveGroup("g1");
  }
  function sbCommitBlock(block) {
    setSession(s => ({ ...s, groups: s.groups.map(g =>
      g.id === activeGroup ? { ...g, blocks: [...g.blocks, block] } : g
    )}));
    setEditingBlock(null);
  }
  function sbReplaceBlock(block) {
    setSession(s => ({ ...s, groups: s.groups.map(g =>
      g.id === activeGroup
        ? { ...g, blocks: g.blocks.map(b => b.id === block.id ? block : b) }
        : g
    )}));
    setEditingBlock(null);
  }
  function sbDeleteBlock(groupId, blockId) {
    setSession(s => ({ ...s, groups: s.groups.map(g =>
      g.id === groupId ? { ...g, blocks: g.blocks.filter(b => b.id !== blockId) } : g
    )}));
  }
  function sbMoveBlock(groupId, blockId, dir) {
    setSession(s => ({ ...s, groups: s.groups.map(g => {
      if (g.id !== groupId) return g;
      const arr = [...g.blocks];
      const i = arr.findIndex(b => b.id === blockId);
      if (i < 0) return g;
      const j = i + dir;
      if (j < 0 || j >= arr.length) return g;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...g, blocks: arr };
    })}));
  }
  function sbAddChild(block, child)  { return { ...block, children: [...block.children, child] }; }
  function sbDeleteChild(block, id)  { return { ...block, children: block.children.filter(c => c.id !== id) }; }
  function sbUpdateChild(block, id, updater) {
    return { ...block, children: block.children.map(c =>
      c.id === id ? (typeof updater === "function" ? updater(c) : { ...c, ...updater }) : c
    )};
  }
  function sbBracketLines(groupId, blockId, lineIds) {
    // Wrap selected lines in a new inner block
    setSession(function(s) {
      return { ...s, groups: s.groups.map(function(g) {
        if (g.id !== groupId) return g;
        return { ...g, blocks: g.blocks.map(function(b) {
          if (b.id !== blockId) return b;
          var newInner = sbNewBlock({ repeats: "2", children: lineIds.map(function(lid) {
            return b.children.find(function(c) { return c.id === lid; });
          }).filter(Boolean) });
          var remaining = b.children.filter(function(c) {
            return !lineIds.includes(c.id);
          });
          // Insert the new inner block at the position of the first selected line
          var firstIdx = b.children.findIndex(function(c) { return c.id === lineIds[0]; });
          var newChildren = [
            ...remaining.slice(0, firstIdx),
            newInner,
            ...remaining.slice(firstIdx),
          ];
          return { ...b, children: newChildren };
        })};
      })};
    });
    setLineSelectMode(null);
    setSelectedLines({});
  }

  function sbMoveChild(block, id, dir) {
    const arr = [...block.children];
    const i = arr.findIndex(c => c.id === id);
    const j = i + dir;
    if (j < 0 || j >= arr.length) return block;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...block, children: arr };
  }

  // ── Set Builder calculations ────────────────────────────────────────────────
  function sbParseSec(str) {
    if (str === null || str === undefined || str === "") return null;
    str = String(str).trim();
    if (str.indexOf(":") > -1) {
      const p = str.split(":");
      return parseFloat(p[0]) * 60 + parseFloat(p[1]);
    }
    return parseFloat(str) || null;
  }
  function sbFmtTime(sec) {
    if (sec === null || sec === undefined || isNaN(sec)) return "";
    sec = parseFloat(sec);
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }
  function sbFmtDur(sec) {
    if (!sec || isNaN(sec)) return "--";
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return h + ":" + String(m).padStart(2,"0") + ":" + String(s).padStart(2,"0");
    return m + ":" + String(s).padStart(2, "0");
  }
  function sbLineTime(line) {
    const on = sbParseSec(line.onTime);
    const inn = sbParseSec(line.targetTime);
    const singleTime = on || inn || 0;
    const qty = parseFloat(line.qty) || 1;
    return singleTime * qty;
  }
  function sbLineRest(line) {
    const on = sbParseSec(line.onTime);
    const inn = sbParseSec(line.targetTime);
    if (on && inn && on > inn) return on - inn;
    return 0;
  }
  function sbChildTime(child) {
    if (child.children !== undefined) return sbBlockTotalTime(child);
    return sbLineTime(child);
  }
  function sbBlockInnerTime(block) {
    if (!block.children || block.children.length === 0) return 0;
    const last = block.children[block.children.length - 1];
    const lastIsLine = last.children === undefined;
    if (lastIsLine && sbParseSec(last.onTime)) {
      const prev = block.children.slice(0, -1).reduce((s, c) => s + sbChildTime(c), 0);
      return prev + sbLineTime(last);   // sbLineTime accounts for line.qty
    }
    return block.children.reduce((s, c) => s + sbChildTime(c), 0);
  }
  function sbBlockTotalTime(block) {
    return sbBlockInnerTime(block) * (parseFloat(block.repeats) || 1);
  }
  function sbBlockVolume(block) {
    const lineVol = (block.children || []).reduce((s, c) => {
      if (c.children !== undefined) return s + sbBlockVolume(c);
      if (c.type !== "swim") return s;
      return s + (parseFloat(c.qty) || 1) * (parseFloat(c.distM) || 0);
    }, 0);
    return lineVol * (parseFloat(block.repeats) || 1);
  }
  function sbGroupVolume(group) { return (group.blocks || []).reduce((s, b) => s + sbBlockVolume(b), 0); }
  function sbSessionVolume()    { return session.groups.reduce((s, g) => s + sbGroupVolume(g), 0); }
  function sbGroupTime(group)   { return (group.blocks || []).reduce((s, b) => s + sbBlockTotalTime(b), 0); }
  const SB_ZONE_COLOR = {
    HVO:"#FF2D55", LT:"#FF5500", LP:"#FF9500", AT:"#FFCC00",
    A3:"#34C759", CS:"#30B0C7", A2:"#30B0C7", A1:"#007AFF",
    Drill:"#8E8E93", Skills:"#BF5AF2",
  };
  function sbZoneColor(z) { return SB_ZONE_COLOR[z] || "rgba(255,255,255,0.3)"; }

  function getPace200ByStroke() {
    var m={};
    if(activeAthlete&&activeAthlete.times){["FS","BK","BR","Fly","IM"].forEach(function(s){var t=activeAthlete.times["200_"+s];if(t)m[s]=t.lcEq;});}
    var p=parseTime(inputs.pace200); if(p&&!m[inputs.stroke])m[inputs.stroke]=p; if(!m["FS"]&&p)m["FS"]=p; return m;
  }

  // ── Athlete Setup: SwimmingResults.org parser ──────────────────────────────
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

  useEffect(function() {
    if (Object.keys(athleteTimes).length === 0) return;
    var dp = deriveAthleteType(athleteTimes);
    setDerivedProfile(dp);
    var t200 = athleteTimes["200_" + inputs.stroke];
    if (t200) set("pace200", t200.display);
  }, [athleteTimes]);

  useEffect(function() {
    if(!selectedElement){setSeqResult(null);return;}
    var pm=getPace200ByStroke();
    var lm=(REST_TYPE_OPTS.find(function(o){return o.v===inputs.restType;})||{clearMult:1}).clearMult*(ATHLETE_TYPE_OPTS.find(function(o){return o.v===inputs.athleteType;})||{clearMult:1}).clearMult;
    var seq=[];
    session.groups.forEach(function(g){
      if(selectedElement.type==="group"&&g.id===selectedElement.id){g.blocks.forEach(function(b){flattenBlock(b,pm,inputs.phvStatus).forEach(function(s){seq.push(s);});});}
      else{g.blocks.forEach(function(b){
        if(selectedElement.type==="block"&&b.id===selectedElement.id)seq=flattenBlock(b,pm,inputs.phvStatus);
        (b.children||[]).forEach(function(c){if(c.children!==undefined&&selectedElement.type==="block"&&c.id===selectedElement.id)seq=flattenBlock(c,pm,inputs.phvStatus);});
      });}
    });
    if(seq.length===0){setSeqResult(null);return;}
    var _cssVal = activeAthlete && activeAthlete.derivedProfile && activeAthlete.derivedProfile.css;
  setSeqResult(classifySequence(seq,inputs.phvStatus,lm,_cssVal));
  },[selectedElement,session,inputs.athleteType,inputs.restType,inputs.phvStatus,activeAthlete]);

  // ── Classifier useEffect ────────────────────────────────────────────────────
  useEffect(() => {
    const distVal    = parseFloat(inputs.distM);
    const qtyVal     = parseFloat(inputs.qty);
    const timeVal    = parseTime(inputs.targetTime);
    const onVal2     = inputs.onTime ? parseTime(inputs.onTime) : null;
    const restVal    = onVal2 !== null ? Math.max(0, onVal2 - timeVal)
                     : parseFloat(inputs.restSec);
    const pace200Val = parseTime(inputs.pace200);
    const hasRestInfo = inputs.onTime || inputs.restSec !== "";
    if (!distVal || !qtyVal || !timeVal || isNaN(restVal) || !hasRestInfo || !pace200Val) return;
    const restTypeMult    = REST_TYPE_OPTS.find(o => o.v === inputs.restType)?.clearMult ?? 1.0;
    const athleteTypeMult = ATHLETE_TYPE_OPTS.find(o => o.v === inputs.athleteType)?.clearMult ?? 1.0;
    const lactateClearMult = restTypeMult * athleteTypeMult;
    const r = classifySet({
      distM: distVal, qty: qtyVal, targetTimeSec: timeVal, restSec: restVal,
      pace200Sec: pace200Val, stroke: inputs.stroke, phvStatus: inputs.phvStatus, lactateClearMult,
    });
    let csDetection = null;
    const cssVal = activeAthlete && activeAthlete.derivedProfile && activeAthlete.derivedProfile.css;
    if (cssVal && r && r.repPace100 && r.workDur && r.restWorkRatio) {
      const cssPace  = cssVal;
      const csLow    = cssPace * 0.95;
      const csHigh   = cssPace * 1.05;
      const totalWork = r.workDur * qtyVal;
      const speedOk  = r.repPace100 >= csLow && r.repPace100 <= csHigh;
      const restOk   = r.restWorkRatio >= (1/2.2) && r.restWorkRatio <= (1/1.2);
      const volumeOk = totalWork >= 1620 && totalWork <= 1980;
      const distOk   = distVal >= 50 && distVal <= 250;
      const matchCount = [speedOk, restOk, volumeOk, distOk].filter(Boolean).length;
      csDetection = {
        isCS: matchCount === 4, partial: matchCount === 3,
        speedOk, restOk, volumeOk, distOk, cssPace, repPace100: r.repPace100,
        totalWorkMin: (totalWork/60).toFixed(1),
        workRest: r.restWorkRatio > 0 ? (1/r.restWorkRatio).toFixed(2) : "0",
      };
    }
    let plSuggestion = null;
    if (r && r.speedRatio && r.speedRatio < 0.95) {
      const totalVol = distVal * qtyVal;
      const inVolRange = totalVol >= 300 && totalVol <= 600;
      plSuggestion = {
        speedOk: true, volumeOk: inVolRange, totalVol,
        note: inVolRange
          ? "Speed and volume suggest PL territory. PL requires 10-15 min active recovery between reps — use the multi-line set builder to include the swimdown component for accurate classification."
          : "Speed suggests PL territory but total volume (" + totalVol + "m) is outside typical PL range (300-600m). PL also requires long active recovery.",
      };
    }
    setSingleResult({ ...r, csDetection, plSuggestion });
  }, [inputs, activeAthlete]);

  // ── Shared style shortcuts ──────────────────────────────────────────────────
  const lb = {
    fontSize: 10, letterSpacing: "0.11em", textTransform: "uppercase",
    color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginBottom: 4, display: "block",
  };
  const inp = {
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6, color: "#fff", padding: "8px 11px", width: "100%",
    fontFamily: "monospace", fontSize: 14, outline: "none", boxSizing: "border-box",
  };

  // Pool display conversion
  var POOL_MULT = { "50LC":1.0, "25SC":0.9667, "25Y":0.9119 };
  var POOL_LABEL = { "50LC":"50m LC", "25SC":"25m SC", "25y":"25y" };
  // Pool conversion lookup (via LC as intermediate)
  var POOL_TO_LC   = { "50LC":1.0, "25SC":1.0344, "25Y":1.0966 };
  var POOL_FROM_LC = { "50LC":1.0, "25SC":0.9667, "25Y":0.9119 };

  function convertTime(secStr, fromPool, toPool) {
    fromPool = fromPool || "50LC";
    toPool   = toPool   || poolDisplay;
    if (!secStr || fromPool === toPool) return secStr;
    var sec = parseTime(String(secStr));
    if (!sec || isNaN(sec)) return secStr;
    // Convert: fromPool → LC → toPool
    var lcSec = sec * (POOL_TO_LC[fromPool] || 1.0);
    var converted = lcSec * (POOL_FROM_LC[toPool] || 1.0);
    var m = Math.floor(converted / 60);
    var s = converted % 60;
    var sStr = s.toFixed(1);
    if (sStr.endsWith(".0")) sStr = sStr.slice(0, -2);
    if (m > 0) return m + ":" + (parseFloat(sStr) < 10 ? "0" : "") + sStr;
    return sStr;
  }

  // Convert a line's time for display (uses line.poolType as source)
  function displayTime(secStr, line) {
    var fromPool = (line && line.poolType) || "50LC";
    return convertTime(secStr, fromPool, poolDisplay);
  }

  function coachNote(r) {
    if (!r) return "";
    const { speedRatio, workDur, restWorkRatio, restoreCheck, lastRep, avgAtpcp, avgGlycolytic } = r;
    const notes = [];
    if (!restoreCheck.atpcpRestored && avgAtpcp * 100 < 5)
      notes.push("ATP-CP virtually absent after rep 1 (rest:work " + restWorkRatio.toFixed(1) + ":1, needs 6:1). Set is glycolytic/aerobic from rep 2.");
    if (restoreCheck.atpcpRestored)
      notes.push("Rest is sufficient (" + restWorkRatio.toFixed(1) + ":1 ≥ 6:1) — ATP-CP partially replenishes between reps.");
    if (workDur > 90 && speedRatio < 0.95)
      notes.push("Rep duration " + workDur.toFixed(0) + "s — glycolytic system under sustained stress.");
    if (lastRep && lastRep.aerobic > 0.65)
      notes.push("By the last rep, aerobic contribution is ~" + (lastRep.aerobic * 100).toFixed(0) + "%.");
    return notes.join(" ");
  }

  // ── JSON session export/import ───────────────────────────────────────────────
  function generateJson() {
    var exportObj = {
      _format: "SwimZone-v1",
      exportedAt: new Date().toISOString(),
      athlete: activeAthlete ? {
        name: activeAthlete.name || "",
        seNumber: activeAthlete.seNumber || "",
        club: activeAthlete.club || "",
        athleteType: inputs.athleteType,
        phvStatus: inputs.phvStatus,
        times: activeAthlete.times || {},
        derivedProfile: activeAthlete.derivedProfile || null,
        pace200: inputs.pace200,
        stroke: inputs.stroke,
      } : null,
      session: session,
    };
    return JSON.stringify(exportObj, null, 2);
  }

  function importJson(text) {
    try {
      var obj = JSON.parse(text);
      if (!obj._format || !obj._format.startsWith("SwimZone")) {
        return "Not a SwimZone session file";
      }
      if (obj.session) {
        setSession(obj.session);
        setActiveGroup(obj.session.groups && obj.session.groups[0] ? obj.session.groups[0].id : "g1");
      }
      if (obj.athlete) {
        if (obj.athlete.athleteType) set("athleteType", obj.athlete.athleteType);
        if (obj.athlete.phvStatus) set("phvStatus", obj.athlete.phvStatus);
        if (obj.athlete.pace200) set("pace200", obj.athlete.pace200);
        if (obj.athlete.stroke) set("stroke", obj.athlete.stroke);
        if (obj.athlete.times && Object.keys(obj.athlete.times).length > 0) {
          setAthleteTimes(obj.athlete.times);
          setAthleteName(obj.athlete.name || "");
          setSeNumber(obj.athlete.seNumber || "");
          setClubName(obj.athlete.club || "");
          setActiveAthlete({
            times: obj.athlete.times,
            derivedProfile: obj.athlete.derivedProfile || null,
            name: obj.athlete.name || "",
            seNumber: obj.athlete.seNumber || "",
            club: obj.athlete.club || "",
            athleteType: obj.athlete.athleteType || "allround",
            phvStatus: obj.athlete.phvStatus || "post",
          });
        }
      }
      return null; // success
    } catch(e) {
      return "Invalid JSON: " + e.message;
    }
  }

  // ── Styled HTML set export ────────────────────────────────────────────────────
  function generateSetHtml() {
    var ZONE_COLORS = { HVO:"#FF2D55",LT:"#FF5500",LP:"#FF9500",AT:"#FFCC00",
      CS:"#30B0C7",A3:"#34C759",A2:"#30B0C7",A1:"#007AFF",Drill:"#8E8E93",Skills:"#BF5AF2" };
    var POOL_MULT = { "50LC":1.0, "25SC":0.9667, "25Y":0.9119 };
    var POOL_NAME = { "50LC":"50m LC", "25SC":"25m SC", "25Y":"25 yard" };
    var mult = POOL_MULT[poolDisplay] || 1.0;

    var POOL_TO_LC2   = { "50LC":1.0, "25SC":1.0344, "25Y":1.0966 };
    var POOL_FROM_LC2 = { "50LC":1.0, "25SC":0.9667, "25Y":0.9119 };
    function cvtTime(secStr, fromPool) {
      fromPool = fromPool || "50LC";
      if (!secStr || fromPool === poolDisplay) return secStr || "";
      var tc = String(secStr).indexOf(":");
      var sec = tc > -1 ? parseInt(secStr)*60+parseFloat(secStr.slice(tc+1)) : parseFloat(secStr)||0;
      if (!sec) return secStr || "";
      var lcSec = sec * (POOL_TO_LC2[fromPool]||1.0);
      var converted = lcSec * (POOL_FROM_LC2[poolDisplay]||1.0);
      var m = Math.floor(converted/60); var s = converted%60;
      var sStr = s.toFixed(1); if(sStr.endsWith(".0")) sStr=sStr.slice(0,-2);
      return m>0 ? m+":"+(parseFloat(sStr)<10?"0":"")+sStr : sStr;
    }

    function zoneTag(z) {
      if (!z) return "";
      var c = ZONE_COLORS[z] || "#888";
      return '<span style="background:'+c+'22;border:1px solid '+c+'66;color:'+c+
        ';padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;'+
        'font-family:monospace;margin-left:6px;">'+z+'</span>';
    }

    function renderLines(children, depth) {
      var html = "";
      var pad = depth * 20;
      children.forEach(function(child) {
        if (child.children !== undefined) {
          // Inner bracket
          var reps = parseFloat(child.repeats)||1;
          var vol = sbBlockVolume(child);
          var time = sbBlockTotalTime(child);
          html += '<tr><td colspan="5" style="padding:4px 8px 2px '+(pad+8)+'px;">';
          html += '<span style="color:#FFCC00;font-weight:900;font-size:14px;font-family:monospace;">'+
            child.repeats+'&times;</span>';
          if (child.label) html += ' <span style="color:#aaa;font-style:italic;font-size:11px;">'+child.label+'</span>';
          html += ' <span style="color:#888;font-size:10px;">'+Math.round(vol)+'m &middot; '+sbFmtDur(time)+'</span>';
          html += '</td></tr>';
          html += renderLines(child.children, depth+1);
        } else if (child.type === "swim") {
          var qty = parseFloat(child.qty)||1;
          var zBg = child.intensity ? (ZONE_COLORS[child.intensity]||"#888")+"11" : "transparent";
          var zBorder = child.intensity ? "border-left:3px solid "+( ZONE_COLORS[child.intensity]||"#ccc")+";" : "border-left:3px solid #eee;";
          html += '<tr style="'+zBorder+'">';
          html += '<td style="padding:5px 8px 5px '+(pad+16)+'px;font-family:monospace;font-size:12px;">';
          if (qty > 1) html += '<span style="color:#888;">'+child.qty+'&times; </span>';
          html += '<strong>'+child.distM+'m '+child.stroke+'</strong>';
          if (child.modifier && child.modifier !== "Full") html += ' <span style="color:#888;font-size:11px;">'+child.modifier+'</span>';
          if (child.note) html += ' <span style="color:#666;font-style:italic;font-size:10px;">'+child.note+'</span>';
          html += '</td>';
          html += '<td style="padding:5px 12px;font-family:monospace;font-size:12px;white-space:nowrap;">';
          if (child.targetTime) html += 'IN <strong>'+cvtTime(child.targetTime, child.poolType)+'</strong>';
          html += '</td>';
          html += '<td style="padding:5px 12px;font-family:monospace;font-size:12px;color:#888;white-space:nowrap;">';
          if (child.onTime) html += 'ON '+cvtTime(child.onTime, child.poolType);
          html += '</td>';
          html += '<td style="padding:5px 8px;font-size:11px;font-family:monospace;color:#888;">';
          if (child.onTime && child.targetTime) {
            var tc1 = String(child.targetTime).indexOf(":");
            var tc2 = String(child.onTime).indexOf(":");
            var wk = tc1>-1 ? parseInt(child.targetTime)*60+parseFloat(child.targetTime.slice(tc1+1)) : parseFloat(child.targetTime)||0;
            var on = tc2>-1 ? parseInt(child.onTime)*60+parseFloat(child.onTime.slice(tc2+1)) : parseFloat(child.onTime)||0;
            var rest = Math.max(0, on-wk);
            if (rest > 0) html += Math.round(rest)+'s rest';
          }
          html += '</td>';
          html += '<td style="padding:5px 8px;">'+zoneTag(child.intensity)+'</td>';
          html += '</tr>';
        } else if (child.type === "rest") {
          html += '<tr><td colspan="5" style="padding:3px 8px 3px '+(pad+16)+'px;'+
            'color:#cc8800;font-style:italic;font-size:11px;border-left:3px solid #cc880033;">'+
            '&mdash; '+(child.note||"Rest")+(child.onTime?" "+cvtTime(child.onTime):"")+'</td></tr>';
        } else if (child.type === "note") {
          html += '<tr><td colspan="5" style="padding:3px 8px 3px '+(pad+16)+'px;'+
            'color:#999;font-style:italic;font-size:11px;">&#x2605; '+child.note+'</td></tr>';
        }
      });
      return html;
    }

    var now = new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
    var athleteStr = activeAthlete ? (activeAthlete.name||"") +
      (activeAthlete.seNumber ? " ("+activeAthlete.seNumber+")" : "") +
      (activeAthlete.club ? " &middot; "+activeAthlete.club : "") : "";
    var cssStr = activeAthlete && activeAthlete.derivedProfile && activeAthlete.derivedProfile.css
      ? " &middot; CSS "+secToDisplay(activeAthlete.derivedProfile.css)+"/100m" : "";
    var poolStr = POOL_NAME[poolDisplay] || "50m LC";

    var groupsHtml = "";
    session.groups.forEach(function(g) {
      if (sbGroupVolume(g) === 0) return;
      groupsHtml += '<tr><td colspan="5" style="padding:10px 8px 4px;background:#f0f0f0;'+
        'font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;'+
        'border-top:2px solid #ccc;color:#333;">'+
        g.label +
        '<span style="float:right;font-weight:400;color:#666;">'+
        Math.round(sbGroupVolume(g))+'m &middot; '+sbFmtDur(sbGroupTime(g))+
        '</span></td></tr>';
      g.blocks.forEach(function(b) {
        var reps = parseFloat(b.repeats)||1;
        var vol = sbBlockVolume(b);
        var time = sbBlockTotalTime(b);
        if (reps > 1 || b.label) {
          groupsHtml += '<tr><td colspan="5" style="padding:6px 8px 2px 8px;'+
            'background:#fff8e6;border-left:4px solid #FFCC00;">';
          groupsHtml += '<span style="color:#cc8800;font-weight:900;font-size:16px;font-family:monospace;">'+
            b.repeats+'&times;</span>';
          if (b.label) groupsHtml += ' <span style="color:#997700;font-style:italic;">'+b.label+'</span>';
          groupsHtml += ' <span style="color:#aaa;font-size:10px;">'+Math.round(vol)+'m &middot; '+sbFmtDur(time)+'</span>';
          groupsHtml += '</td></tr>';
        }
        groupsHtml += renderLines(b.children, reps > 1 || b.label ? 1 : 0);
      });
    });

    return '<!DOCTYPE html><html><head><meta charset="utf-8">'+
      '<title>'+(session.title||"Session")+'</title><style>'+
      'body{font-family:Arial,sans-serif;margin:32px;color:#111;font-size:13px}'+
      'h1{font-size:20px;margin:0 0 2px}'+
      'table{width:100%;border-collapse:collapse;margin-bottom:8px}'+
      'tr:nth-child(even){background:#fafafa}'+
      'tr:hover{background:#f5f5f5}'+
      '@media print{body{margin:16px}.no-print{display:none}}'+
      '</style></head><body>'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">'+
      '<div>'+
      '<h1>'+(session.title||"Untitled Session")+'</h1>'+
      '<div style="font-size:11px;color:#888;">'+now+' &middot; '+poolStr+
      (athleteStr ? ' &middot; '+athleteStr+cssStr : '')+'</div>'+
      '</div>'+
      '<div style="text-align:right;font-size:11px;color:#888;">'+
      '<div>'+Math.round(sbSessionVolume())+'m total</div>'+
      '<div>'+sbFmtDur(session.groups.reduce(function(s,g){return s+sbGroupTime(g);},0))+'</div>'+
      '</div></div>'+
      '<table>'+groupsHtml+'</table>'+
      '<div style="margin-top:16px;font-size:9px;color:#bbb;border-top:1px solid #eee;padding-top:6px">'+
      'Generated by Swim Zone Classifier &middot; Sweetenham model &middot; '+poolStr+
      '</div></body></html>';
  }

  function generateCsv() {
    var rows = ["Group,Block,Repeats,Line,Qty,Dist,Stroke,Target,ON,Rest,Zone,Note"];
    session.groups.forEach(function(g) {
      g.blocks.forEach(function(b, bi) {
        function addLines(block, prefix) {
          (block.children||[]).forEach(function(c, ci) {
            if (c.children !== undefined) {
              addLines(c, prefix + "(" + (block.repeats||1) + "x)");
            } else if (c.type === "swim") {
              var on = c.onTime || "";
              var tgt = c.targetTime || "";
              var tc = String(tgt).indexOf(":");
              var w = tc>-1 ? parseInt(tgt)*60+parseFloat(tgt.slice(tc+1)) : parseFloat(tgt)||0;
              var oc = String(on).indexOf(":");
              var o2 = oc>-1 ? parseInt(on)*60+parseFloat(on.slice(oc+1)) : parseFloat(on)||w;
              var rest = Math.max(0, o2 - w);
              rows.push([
                g.label, (bi+1), block.repeats||1, (ci+1),
                c.qty||1, c.distM||"", c.stroke||"FS",
                tgt, on, Math.round(rest)+"s",
                c.intensity||"", (c.note||"").replace(/,/g,"")
              ].join(","));
            } else if (c.type === "rest") {
              rows.push([g.label,(bi+1),block.repeats||1,(ci+1),"","","","",c.onTime||"","","REST",(c.note||"").replace(/,/g,"")].join(","));
            }
          });
        }
        addLines(b, "");
      });
    });
    return rows.join("\n");
  }

  // ── Zone → Times suggestion engine ──────────────────────────────────────────
  function suggestTimes(zone, distM, stroke, pace200Sec, cssValue) {
    if (!pace200Sec || !distM || !zone) return null;
    var SMULT = { FS:1.0, BK:1.045, BR:1.254, Fly:1.051, IM:1.082 };
    var mult = SMULT[stroke] || 1.0;
    var base100 = (pace200Sec * mult) / 2; // seconds per 100m at 200PB pace
    var dist = parseFloat(distM);

    // Zone speedRatio ranges → IN time range
    var cssRef2 = cssValue || null;
    var mult2   = { FS:1.0, BK:1.045, BR:1.254, Fly:1.051, IM:1.082 }[stroke] || 1.0;
    var b100    = (pace200Sec * mult2) / 2;
    var cssSR   = cssRef2 ? cssRef2 / b100 : null;
    var srRanges = {
      HVO: [0.82, 0.93],
      LT:  [0.93, 0.97],
      LP:  [0.97, 1.025],
      AT:  [1.025, 1.10],
      CS:  cssSR ? [cssSR * 0.95, cssSR * 1.05] : [1.025, 1.10],
      A3:  [1.10, 1.22],
      A2:  [1.22, 1.38],
      A1:  [1.38, 1.65],
    };
    // Work:rest ratios by zone (rest/work)
    var restRatios = {
      HVO: [6.0, 10.0],
      LT:  [3.0, 5.0],
      LP:  [1.0, 1.2],
      AT:  [0.30, 0.55],   // 30-55s rest on 100m AT rep
      CS:  [0.45, 0.70],
      A3:  [0.0, 0.15],    // 0-15s rest — can go straight on at A3
      A2:  [0.0, 0.08],    // straight-on to 5s rest
      A1:  [0.0, 0.0],     // continuous — ON = IN (straight-on)
    };

    var range = srRanges[zone];
    var restRange = restRatios[zone];
    if (!range) return null;

    // Calculate IN time range (round to nearest second)
    var inLow  = Math.round((range[0] * base100 / 100) * dist);
    var inHigh = Math.round((range[1] * base100 / 100) * dist);
    if (inLow >= inHigh) inHigh = inLow + 2;

    // Calculate ON time range (IN + rest, round to nearest 5s)
    function roundTo5(sec) { return Math.round(sec / 5) * 5; }
    function fmtSug(sec) {
      var m = Math.floor(sec / 60);
      var s = Math.round(sec % 60);
      return m > 0 ? m + ":" + String(s).padStart(2,"0") : String(s);
    }

    var onLow  = roundTo5(inLow  + inLow  * restRange[0]);
    var onHigh = roundTo5(inHigh + inHigh * restRange[1]);
    if (onLow === onHigh) onHigh = onLow + 5;

    return {
      inLow, inHigh,
      onLow, onHigh,
      inLowStr:  fmtSug(inLow),
      inHighStr: fmtSug(inHigh),
      onLowStr:  fmtSug(onLow),
      onHighStr: fmtSug(onHigh),
      inMidStr:  fmtSug(Math.round((inLow + inHigh) / 2)),
      onMidStr:  fmtSug(roundTo5((onLow + onHigh) / 2)),
    };
  }

  // Suggestion for current classifier inputs
  var classifierSuggestion = null;
  if (inputs.distM && inputs.stroke && inputs.pace200) {
    var p200s = parseTime(inputs.pace200);
    // Suggest for nearest zone based on current target if set, else for all zones
    classifierSuggestion = {};
    ["HVO","LT","LP","AT","CS","A3","A2","A1"].forEach(function(z) {
      var _css = activeAthlete && activeAthlete.derivedProfile && activeAthlete.derivedProfile.css;
      classifierSuggestion[z] = suggestTimes(z, inputs.distM, inputs.stroke, p200s, _css);
    });
  }

  const restTypeOpt    = REST_TYPE_OPTS.find(o => o.v === inputs.restType);
  const athleteTypeOpt = ATHLETE_TYPE_OPTS.find(o => o.v === inputs.athleteType);

  return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", color: "#fff",
      fontFamily: "monospace", padding: "16px 12px" }}>

      {/* Header */}
      <div style={{ maxWidth: 620, margin: "0 auto 0 auto" }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", letterSpacing: "0.15em",
            marginBottom: 2 }}>ELLESMERE PORT ASC</div>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: "0.04em" }}>
            SWIM ZONE CLASSIFIER
          </div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 2,
            letterSpacing: "0.08em" }}>SWEETENHAM ENERGY ZONE MODEL · v5</div>
        </div>
      </div>

      <div style={{ maxWidth: 620, margin: "0 auto" }}>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 0, marginBottom: 16,
          border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, overflow: "hidden" }}>
          {[{ v: "classifier", l: "Classifier" },
            { v: "setup",      l: "Athlete Setup" },
            { v: "builder",    l: "Set Builder" }].map(t => (
            <button key={t.v} onClick={() => setTab(t.v)} style={{
              flex: 1, padding: "9px 0", cursor: "pointer", border: "none",
              background: tab === t.v ? "rgba(255,255,255,0.10)" : "transparent",
              color: tab === t.v ? "#fff" : "rgba(255,255,255,0.35)",
              fontFamily: "monospace", fontSize: 11, fontWeight: tab === t.v ? 700 : 400,
              letterSpacing: "0.06em",
            }}>{t.l}</button>
          ))}
        </div>

        {/* Pool display toggle */}
        <div style={{ display:"flex", gap:3, alignItems:"center", marginBottom:10 }}>
          <span style={{ fontSize:9, color:"rgba(255,255,255,0.25)", letterSpacing:"0.08em", marginRight:2 }}>POOL:</span>
          {[["50LC","50m LC"],["25SC","25m SC"],["25Y","25 yard"]].map(function(p) { return (
            <button key={p[0]} onClick={function(){setPoolDisplay(p[0]);}}
              style={{ padding:"3px 10px", borderRadius:4, cursor:"pointer",
                fontFamily:"monospace", fontSize:9, fontWeight:700, border:"1px solid",
                borderColor: poolDisplay===p[0]?"rgba(48,176,199,0.5)":"rgba(255,255,255,0.08)",
                background: poolDisplay===p[0]?"rgba(48,176,199,0.12)":"transparent",
                color: poolDisplay===p[0]?"#30B0C7":"rgba(255,255,255,0.28)" }}>
              {p[1]}
            </button>
          ); })}
          {poolDisplay !== "50LC" && (
            <span style={{ fontSize:8, color:"rgba(48,176,199,0.5)", marginLeft:4 }}>
              display only · model in LC metres
            </span>
          )}
        </div>

        {/* ══ SETUP TAB ══════════════════════════════════════════════════════ */}
        {tab === "setup" && (
          <div>
            {/* Athlete type toggle */}
            <div style={{ background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <label style={lb}>Athlete type <span style={{ opacity: 0.4, fontWeight: 400 }}>— affects lactate clearance rate</span></label>
              <div style={{ display: "flex", gap: 6 }}>
                {ATHLETE_TYPE_OPTS.map(opt => (
                  <button key={opt.v} onClick={() => set("athleteType", opt.v)} style={{
                    flex: 1, padding: "8px 10px", borderRadius: 7, cursor: "pointer",
                    border: "1px solid " + (inputs.athleteType === opt.v ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.08)"),
                    background: inputs.athleteType === opt.v ? "rgba(255,255,255,0.10)" : "transparent",
                    color: inputs.athleteType === opt.v ? "#fff" : "rgba(255,255,255,0.3)",
                    fontFamily: "monospace", textAlign: "left",
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>{opt.l}</div>
                    <div style={{ fontSize: 9, marginTop: 2, opacity: 0.6 }}>{opt.sub}</div>
                  </button>
                ))}
              </div>
              {derivedProfile && derivedProfile.type && (
                <div style={{ marginTop: 8, fontSize: 10, color: "rgba(52,199,89,0.7)" }}>
                  Auto-detected: {derivedProfile.label} ({derivedProfile.aiPct}% drop/doubling) — override above if needed
                </div>
              )}
            </div>

            {/* PHV Status toggle */}
            <div style={{ background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <label style={lb}>Athlete maturation (PHV status)</label>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { v: "pre",        l: "Pre-PHV",        sub: "Lactate system undeveloped" },
                  { v: "developing", l: "Early Post-PHV", sub: "Lactate system maturing" },
                  { v: "post",       l: "Post-PHV",       sub: "Full glycolytic capacity" },
                ].map(opt => (
                  <button key={opt.v} onClick={() => set("phvStatus", opt.v)} style={{
                    flex: 1, padding: "8px 10px", borderRadius: 7, cursor: "pointer",
                    border: "1px solid " + (inputs.phvStatus === opt.v ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.08)"),
                    background: inputs.phvStatus === opt.v ? "rgba(255,255,255,0.12)" : "transparent",
                    color: inputs.phvStatus === opt.v ? "#fff" : "rgba(255,255,255,0.3)",
                    fontFamily: "monospace", textAlign: "left",
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>{opt.l}</div>
                    <div style={{ fontSize: 9, marginTop: 2, opacity: 0.6 }}>{opt.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Athlete identity */}
            <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)",
              borderRadius:10, padding:14, marginBottom:12 }}>
              <label style={lb}>Athlete details</label>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <div style={{ flex:2, minWidth:140 }}>
                  <label style={{ ...lb, marginBottom:2 }}>Name</label>
                  <input style={{ ...inp, fontSize:13, padding:"5px 8px" }}
                    value={athleteName} onChange={e => setAthleteName(e.target.value)}
                    placeholder="Athlete name" />
                </div>
                <div style={{ flex:1, minWidth:90 }}>
                  <label style={{ ...lb, marginBottom:2 }}>SE Number</label>
                  <input style={{ ...inp, fontSize:13, padding:"5px 8px" }}
                    value={seNumber} onChange={e => setSeNumber(e.target.value)}
                    placeholder="1234567" />
                </div>
                <div style={{ flex:2, minWidth:140 }}>
                  <label style={{ ...lb, marginBottom:2 }}>Club</label>
                  <input style={{ ...inp, fontSize:13, padding:"5px 8px" }}
                    value={clubName} onChange={e => setClubName(e.target.value)}
                    placeholder="Club name" />
                </div>
              </div>
            </div>

            {/* Manual time entry */}
            <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, padding:14, marginBottom:12 }}>
              <label style={lb}>Manual time entry</label>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:4, marginBottom:8 }}>
                <div></div>
                <div style={{ fontSize:9,color:"rgba(255,255,255,0.35)",textAlign:"center",fontFamily:"monospace",letterSpacing:"0.06em",paddingBottom:3,borderBottom:"1px solid rgba(255,255,255,0.06)" }}>FS</div>
                <div style={{ fontSize:9,color:"rgba(255,255,255,0.35)",textAlign:"center",fontFamily:"monospace",letterSpacing:"0.06em",paddingBottom:3,borderBottom:"1px solid rgba(255,255,255,0.06)" }}>BK</div>
                <div style={{ fontSize:9,color:"rgba(255,255,255,0.35)",textAlign:"center",fontFamily:"monospace",letterSpacing:"0.06em",paddingBottom:3,borderBottom:"1px solid rgba(255,255,255,0.06)" }}>BR</div>
                <div style={{ fontSize:9,color:"rgba(255,255,255,0.35)",textAlign:"center",fontFamily:"monospace",letterSpacing:"0.06em",paddingBottom:3,borderBottom:"1px solid rgba(255,255,255,0.06)" }}>Fly</div>
                <div style={{ fontSize:9,color:"rgba(255,255,255,0.35)",textAlign:"center",fontFamily:"monospace",letterSpacing:"0.06em",paddingBottom:3,borderBottom:"1px solid rgba(255,255,255,0.06)" }}>IM</div>
                <div style={{ fontSize:10,color:"rgba(255,255,255,0.5)",fontFamily:"monospace",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700 }}>50m</div>
                <input placeholder="—" value={athleteTimes["50_FS"] ? athleteTimes["50_FS"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["50_FS"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "50_FS":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:50,code:"FS",stroke:"FS",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["50_BK"] ? athleteTimes["50_BK"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["50_BK"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "50_BK":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:50,code:"BK",stroke:"BK",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["50_BR"] ? athleteTimes["50_BR"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["50_BR"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "50_BR":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:50,code:"BR",stroke:"BR",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["50_Fly"] ? athleteTimes["50_Fly"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["50_Fly"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "50_Fly":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:50,code:"Fly",stroke:"Fly",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["50_IM"] ? athleteTimes["50_IM"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["50_IM"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "50_IM":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:50,code:"IM",stroke:"IM",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <div style={{ fontSize:10,color:"rgba(255,255,255,0.5)",fontFamily:"monospace",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700 }}>100m</div>
                <input placeholder="—" value={athleteTimes["100_FS"] ? athleteTimes["100_FS"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["100_FS"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "100_FS":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:100,code:"FS",stroke:"FS",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["100_BK"] ? athleteTimes["100_BK"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["100_BK"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "100_BK":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:100,code:"BK",stroke:"BK",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["100_BR"] ? athleteTimes["100_BR"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["100_BR"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "100_BR":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:100,code:"BR",stroke:"BR",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["100_Fly"] ? athleteTimes["100_Fly"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["100_Fly"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "100_Fly":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:100,code:"Fly",stroke:"Fly",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["100_IM"] ? athleteTimes["100_IM"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["100_IM"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "100_IM":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:100,code:"IM",stroke:"IM",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <div style={{ fontSize:10,color:"rgba(255,255,255,0.5)",fontFamily:"monospace",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700 }}>200m</div>
                <input placeholder="—" value={athleteTimes["200_FS"] ? athleteTimes["200_FS"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["200_FS"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "200_FS":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:200,code:"FS",stroke:"FS",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["200_BK"] ? athleteTimes["200_BK"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["200_BK"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "200_BK":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:200,code:"BK",stroke:"BK",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["200_BR"] ? athleteTimes["200_BR"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["200_BR"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "200_BR":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:200,code:"BR",stroke:"BR",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["200_Fly"] ? athleteTimes["200_Fly"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["200_Fly"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "200_Fly":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:200,code:"Fly",stroke:"Fly",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["200_IM"] ? athleteTimes["200_IM"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["200_IM"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "200_IM":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:200,code:"IM",stroke:"IM",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <div style={{ fontSize:10,color:"rgba(255,255,255,0.5)",fontFamily:"monospace",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700 }}>400m</div>
                <input placeholder="—" value={athleteTimes["400_FS"] ? athleteTimes["400_FS"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["400_FS"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "400_FS":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:400,code:"FS",stroke:"FS",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["400_BK"] ? athleteTimes["400_BK"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["400_BK"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "400_BK":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:400,code:"BK",stroke:"BK",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["400_BR"] ? athleteTimes["400_BR"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["400_BR"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "400_BR":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:400,code:"BR",stroke:"BR",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["400_Fly"] ? athleteTimes["400_Fly"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["400_Fly"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "400_Fly":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:400,code:"Fly",stroke:"Fly",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["400_IM"] ? athleteTimes["400_IM"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["400_IM"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "400_IM":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:400,code:"IM",stroke:"IM",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <div style={{ fontSize:10,color:"rgba(255,255,255,0.5)",fontFamily:"monospace",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700 }}>800m</div>
                <input placeholder="—" value={athleteTimes["800_FS"] ? athleteTimes["800_FS"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["800_FS"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "800_FS":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:800,code:"FS",stroke:"FS",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["800_BK"] ? athleteTimes["800_BK"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["800_BK"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "800_BK":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:800,code:"BK",stroke:"BK",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["800_BR"] ? athleteTimes["800_BR"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["800_BR"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "800_BR":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:800,code:"BR",stroke:"BR",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["800_Fly"] ? athleteTimes["800_Fly"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["800_Fly"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "800_Fly":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:800,code:"Fly",stroke:"Fly",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["800_IM"] ? athleteTimes["800_IM"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["800_IM"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "800_IM":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:800,code:"IM",stroke:"IM",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <div style={{ fontSize:10,color:"rgba(255,255,255,0.5)",fontFamily:"monospace",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700 }}>1500m</div>
                <input placeholder="—" value={athleteTimes["1500_FS"] ? athleteTimes["1500_FS"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["1500_FS"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "1500_FS":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:1500,code:"FS",stroke:"FS",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["1500_BK"] ? athleteTimes["1500_BK"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["1500_BK"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "1500_BK":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:1500,code:"BK",stroke:"BK",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["1500_BR"] ? athleteTimes["1500_BR"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["1500_BR"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "1500_BR":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:1500,code:"BR",stroke:"BR",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["1500_Fly"] ? athleteTimes["1500_Fly"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["1500_Fly"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "1500_Fly":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:1500,code:"Fly",stroke:"Fly",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
                <input placeholder="—" value={athleteTimes["1500_IM"] ? athleteTimes["1500_IM"].display : ""}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { setAthleteTimes(function(p) { const n=Object.assign({},p); delete n["1500_IM"]; return n; }); }
                    else { const parsed = parseTime(val); if (parsed) { setAthleteTimes(function(p) { return Object.assign({},p,{ "1500_IM":{sec:parsed,lcEq:parsed,display:val,pool:"LC",dist:1500,code:"IM",stroke:"IM",date:"",monthsOld:0,stale:false} }); }); } }
                  }}
                  style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:4,color:"#fff",padding:"3px 4px",fontFamily:"monospace",fontSize:11,outline:"none",textAlign:"center",width:"100%",boxSizing:"border-box" }} />
              </div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.25)", marginBottom:8 }}>Enter times as m:ss or ss.cc · pace200 auto-fills as you type</div>
              {Object.keys(athleteTimes).length > 0 && (
                <button onClick={() => {
                  const dp2 = derivedProfile;
                  const newAthlete = { times:athleteTimes, parsedAt:new Date().toLocaleTimeString(),
                    derivedProfile:dp2, athleteType:inputs.athleteType, phvStatus:inputs.phvStatus,
                    name:athleteName, seNumber:seNumber, club:clubName };
                  setActiveAthlete(newAthlete);
                  if (dp2 && dp2.type) set("athleteType", dp2.type);
                  setTab("classifier");
                }} style={{ padding:"6px 16px", background:"rgba(52,199,89,0.12)",
                  border:"1px solid rgba(52,199,89,0.4)", borderRadius:5,
                  color:"#34C759", cursor:"pointer", fontFamily:"monospace", fontSize:9, fontWeight:700 }}>
                  USE THESE TIMES
                </button>
              )}
            </div>
            {/* Paste import */}
            <div style={{ background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <label style={lb}>Import times from SwimmingResults.org</label>
              <textarea value={rawPaste} onChange={e => setRawPaste(e.target.value)}
                placeholder={"Paste the full page text from a SwimmingResults.org individual times page..."}
                rows={5}
                style={{ width: "100%", background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6,
                  color: "rgba(255,255,255,0.7)", padding: "10px", fontFamily: "monospace",
                  fontSize: 11, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
              <button onClick={handleParse} style={{
                marginTop: 8, padding: "8px 18px", background: "rgba(48,176,199,0.12)",
                border: "1px solid rgba(48,176,199,0.4)", borderRadius: 6,
                color: "#30B0C7", cursor: "pointer", fontFamily: "monospace",
                fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
              }}>PARSE &amp; IMPORT TIMES</button>
            </div>

            {/* Parsed times table */}
            {Object.keys(athleteTimes).length > 0 && (
              <div style={{ background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10,
                padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)",
                  letterSpacing: "0.08em", marginBottom: 8 }}>
                  IMPORTED TIMES — {Object.keys(athleteTimes).length} events
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: "rgba(255,255,255,0.3)" }}>
                      <th style={{ textAlign: "left",  padding: "4px 0", fontWeight: 400 }}>Event</th>
                      <th style={{ textAlign: "right", padding: "4px 0", fontWeight: 400 }}>Time</th>
                      <th style={{ textAlign: "right", padding: "4px 0", fontWeight: 400 }}>Pool</th>
                      <th style={{ textAlign: "right", padding: "4px 0", fontWeight: 400 }}>LC equiv</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(athleteTimes)
                      .sort((a, b) => a.code.localeCompare(b.code) || a.dist - b.dist)
                      .map(t => (
                        <tr key={t.dist + "_" + t.code}
                          style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "5px 0", color: "#fff" }}>{t.dist}m {t.stroke}</td>
                          <td style={{ padding: "5px 0", textAlign: "right",
                            color: t.stale ? "rgba(255,255,255,0.35)" : "#fff", fontWeight: 700 }}>
                            {t.display}
                            {t.stale && <span style={{ marginLeft: 5, fontSize: 9, color: "#FF9500" }}>stale</span>}
                          </td>
                          <td style={{ padding: "5px 0", textAlign: "right",
                            color: t.pool === "LC" ? "rgba(48,176,199,0.8)" : "rgba(255,204,0,0.8)" }}>{t.pool}</td>
                          <td style={{ padding: "5px 0", textAlign: "right",
                            color: t.pool === "SC" ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.2)",
                            fontSize: 10 }}>{t.pool === "SC" ? secToDisplay(t.lcEq) : "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Parse log */}
            {parseLog.length > 0 && (
              <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)",
                  letterSpacing: "0.08em", marginBottom: 6 }}>PARSE LOG</div>
                {parseLog.map((l, i) => (
                  <div key={i} style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>{l}</div>
                ))}
              </div>
            )}

            {/* Derived profile card */}
            {derivedProfile && (
              <div style={{ background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)",
                  letterSpacing: "0.08em", marginBottom: 8 }}>AUTO-DETECTED ATHLETE PROFILE</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{derivedProfile.label}</span>
                  {derivedProfile.mult && (
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                      clearance x{derivedProfile.mult.toFixed(2)}
                    </span>
                  )}
                  {derivedProfile.confidence && derivedProfile.confidence !== "none" && (
                    <span style={{ fontSize: 9, padding: "2px 6px",
                      background: derivedProfile.confidence === "high" ? "rgba(52,199,89,0.15)" : "rgba(255,204,0,0.15)",
                      border: "1px solid " + (derivedProfile.confidence === "high" ? "rgba(52,199,89,0.4)" : "rgba(255,204,0,0.4)"),
                      borderRadius: 4,
                      color: derivedProfile.confidence === "high" ? "#34C759" : "#FFCC00" }}>
                      {derivedProfile.confidence} confidence
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 2 }}>
                  {derivedProfile.reasoning}
                </div>
                {derivedProfile.aiPct && (
                  <div style={{ marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                    Drop-off: {derivedProfile.aiPct}% per doubling (200m+) · &lt;3% Endurance · 3-6% All-Round · &gt;6% Sprint
                  </div>
                )}
                {derivedProfile.staleUsed && (
                  <div style={{ marginTop: 4, fontSize: 10,
                    color: "rgba(255,149,0,0.7)", background: "rgba(255,149,0,0.06)",
                    borderRadius: 4, padding: "4px 8px" }}>
                    ⚠ Some times used in this profile are over 13 months old. Profile may not reflect current fitness — update with recent times when available.
                  </div>
                )}
                {derivedProfile.css && (
                  <div style={{ marginTop: 4, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                    CSS: {secToDisplay(derivedProfile.css)}/100m (from {derivedProfile.cssMethod})
                  </div>
                )}
              </div>
            )}

            {/* No profile warning */}
            {Object.keys(athleteTimes).length > 0 && !derivedProfile && (
              <div style={{ background: "rgba(255,204,0,0.08)",
                border: "1px solid rgba(255,204,0,0.2)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "rgba(255,204,0,0.8)" }}>
                  No freestyle 200m + 400m times found — athlete type cannot be auto-detected.
                  Set manually using the toggle above.
                </div>
              </div>
            )}

            {/* Athlete JSON export/import */}
            <div style={{ background:"rgba(255,255,255,0.025)",
              border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, padding:14, marginBottom:12 }}>
              <label style={lb}>Save / Load Athlete Profile</label>
              <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                <button onClick={function(){
                  var obj = JSON.stringify({
                    _format:"SwimZone-Athlete-v1",
                    name:athleteName, seNumber:seNumber, club:clubName,
                    times:athleteTimes, derivedProfile:derivedProfile,
                    athleteType:inputs.athleteType, phvStatus:inputs.phvStatus,
                  }, null, 2);
                  var el = document.getElementById("athlete-json-area");
                  if (el) { el.value = obj; el.select(); }
                }} style={{ padding:"5px 14px", background:"rgba(52,199,89,0.08)",
                  border:"1px solid rgba(52,199,89,0.25)", borderRadius:5,
                  color:"rgba(52,199,89,0.7)", cursor:"pointer",
                  fontFamily:"monospace", fontSize:9, fontWeight:700 }}>
                  EXPORT ATHLETE JSON
                </button>
                <button onClick={function(){
                  var el = document.getElementById("athlete-json-area");
                  if (!el || !el.value.trim()) return;
                  try {
                    var obj = JSON.parse(el.value);
                    if (!obj._format || !obj._format.startsWith("SwimZone-Athlete")) {
                      alert("Not a SwimZone athlete file"); return;
                    }
                    if (obj.name) setAthleteName(obj.name);
                    if (obj.seNumber) setSeNumber(obj.seNumber);
                    if (obj.club) setClubName(obj.club);
                    if (obj.times) setAthleteTimes(obj.times);
                    if (obj.derivedProfile) setDerivedProfile(obj.derivedProfile);
                    if (obj.athleteType) set("athleteType", obj.athleteType);
                    if (obj.phvStatus) set("phvStatus", obj.phvStatus);
                    el.value = "";
                  } catch(e) { alert("Invalid JSON: "+e.message); }
                }} style={{ padding:"5px 14px", background:"rgba(48,176,199,0.08)",
                  border:"1px solid rgba(48,176,199,0.25)", borderRadius:5,
                  color:"rgba(48,176,199,0.6)", cursor:"pointer",
                  fontFamily:"monospace", fontSize:9, fontWeight:700 }}>
                  IMPORT ATHLETE JSON
                </button>
              </div>
              <textarea id="athlete-json-area" rows={4}
                placeholder="Athlete JSON appears here after export · paste here to import"
                onClick={function(e){e.target.select();}}
                style={{ width:"100%", background:"rgba(255,255,255,0.03)",
                  border:"1px solid rgba(255,255,255,0.07)", borderRadius:6,
                  color:"rgba(255,255,255,0.5)", fontFamily:"monospace",
                  fontSize:9, padding:8, resize:"vertical",
                  boxSizing:"border-box", outline:"none" }} />
            </div>

            {/* Make active button */}
            {Object.keys(athleteTimes).length > 0 && (
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
                <button onClick={() => {
                  const dp2 = derivedProfile || (activeAthlete && activeAthlete.derivedProfile);
                  setActiveAthlete({ times: athleteTimes, parsedAt: new Date().toLocaleTimeString(), derivedProfile: dp2, name: athleteName, seNumber: seNumber, club: clubName });
                  if (dp2 && dp2.type) set("athleteType", dp2.type);
                  const t200 = athleteTimes["200_" + inputs.stroke];
                  if (t200) set("pace200", t200.display);
                  setTab("classifier");
                }} style={{
                  padding: "9px 20px", background: "rgba(52,199,89,0.15)",
                  border: "1px solid rgba(52,199,89,0.5)", borderRadius: 6,
                  color: "#34C759", fontFamily: "monospace", fontSize: 11,
                  fontWeight: 700, cursor: "pointer", letterSpacing: "0.06em",
                }}>MAKE THIS THE ACTIVE ATHLETE</button>
                {activeAthlete && (
                  <span style={{ fontSize: 10, color: "rgba(52,199,89,0.6)" }}>
                    (replaces current active athlete)
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "builder" && (
          <div>
            {/* Session title + totals */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input value={session.title}
                onChange={e => setSession(s => ({ ...s, title: e.target.value }))}
                placeholder="Session title…"
                style={{ flex: 1, background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.09)", borderRadius: 6,
                  color: "#fff", padding: "7px 11px", fontFamily: "monospace",
                  fontSize: 12, outline: "none" }} />
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>
                {Math.round(sbSessionVolume())}m &middot; {sbFmtDur(session.groups.reduce((s,g)=>s+sbGroupTime(g),0))}
              </div>
            </div>

            {/* Pool toggle (repeated in builder for visibility) */}
            <div style={{ display:"flex", gap:3, alignItems:"center", marginBottom:8 }}>
              <span style={{ fontSize:9, color:"rgba(255,255,255,0.3)", marginRight:2 }}>POOL:</span>
              {[["50LC","50m LC"],["25SC","25m SC"],["25Y","25 yard"]].map(function(p) { return (
                <button key={p[0]} onClick={function(){setPoolDisplay(p[0]);}}
                  style={{ padding:"3px 9px", borderRadius:4, cursor:"pointer",
                    fontFamily:"monospace", fontSize:9, fontWeight:700, border:"1px solid",
                    borderColor: poolDisplay===p[0]?"rgba(48,176,199,0.5)":"rgba(255,255,255,0.08)",
                    background: poolDisplay===p[0]?"rgba(48,176,199,0.12)":"transparent",
                    color: poolDisplay===p[0]?"#30B0C7":"rgba(255,255,255,0.28)" }}>
                  {p[1]}
                </button>
              ); })}
            </div>

            {/* Group tabs */}
            <div style={{ display: "flex", gap: 5, marginBottom: 10, flexWrap: "wrap" }}>
              {session.groups.map(g => (
                <button key={g.id} onClick={() => setActiveGroup(g.id)} style={{
                  padding: "5px 12px", borderRadius: 6, cursor: "pointer",
                  fontFamily: "monospace", fontSize: 10, fontWeight: 700,
                  border: "1px solid",
                  borderColor: activeGroup === g.id ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.1)",
                  background: activeGroup === g.id ? "rgba(255,255,255,0.10)" : "transparent",
                  color: activeGroup === g.id ? "#fff" : "rgba(255,255,255,0.35)",
                }}>
                  {g.label}{sbGroupVolume(g) > 0 ? " (" + Math.round(sbGroupVolume(g)) + "m)" : ""}
                </button>
              ))}
              <button onClick={sbAddGroup} style={{
                padding: "5px 10px", borderRadius: 6, cursor: "pointer",
                fontFamily: "monospace", fontSize: 10,
                border: "1px dashed rgba(255,255,255,0.15)",
                background: "transparent", color: "rgba(255,255,255,0.3)",
              }}>+ Group</button>
            </div>

            {/* Active group */}
            {session.groups.filter(g => g.id === activeGroup).map(group => (
              <div key={group.id}>
                {/* Group label row */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <input value={group.label}
                    onChange={e => sbUpdateGroup(group.id, "label", e.target.value)}
                    style={{ flex: 1, background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6,
                      color: "#fff", padding: "6px 10px", fontFamily: "monospace",
                      fontSize: 13, fontWeight: 700, outline: "none" }} />
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>
                    {Math.round(sbGroupVolume(group))}m &middot; {sbFmtDur(sbGroupTime(group))}
                  </span>
                  {session.groups.length > 1 && (
                    <button onClick={() => sbDeleteGroup(group.id)} style={{
                      padding: "3px 7px", background: "rgba(255,45,85,0.08)",
                      border: "1px solid rgba(255,45,85,0.25)", borderRadius: 4,
                      color: "rgba(255,45,85,0.6)", cursor: "pointer", fontSize: 10,
                    }}>✕</button>
                  )}
                </div>

                {/* Committed blocks */}
                {group.blocks.map((block, bi) => (
                  <SbBlockView key={block.id} block={block}
                    onEdit={() => setEditingBlock({ ...block, _mode: "edit" })}
                    onDelete={() => sbDeleteBlock(group.id, block.id)}
                    onMoveUp={() => sbMoveBlock(group.id, block.id, -1)}
                    onMoveDown={() => sbMoveBlock(group.id, block.id, 1)}
                    isFirst={bi === 0} isLast={bi === group.blocks.length - 1}
                    sbZoneColor={sbZoneColor} sbFmtDur={sbFmtDur}
                    sbBlockVolume={sbBlockVolume} sbBlockTotalTime={sbBlockTotalTime}
                    sbLineRest={sbLineRest}
                    pace200Map={getPace200ByStroke()} phvStatus={inputs.phvStatus}
                    isSelected={selectedElement && selectedElement.id === block.id}
                    onSelect={() => setSelectedElement({type:"block", id:block.id})}
                    onToggleSelect={() => {
                      if (lineSelectMode === block.id) {
                        setLineSelectMode(null); setSelectedLines({});
                      } else {
                        setLineSelectMode(block.id); setSelectedLines({});
                      }
                    }}
                    selectMode={lineSelectMode === block.id}
                    selectedLines={lineSelectMode === block.id ? selectedLines : {}}
                    onBracket={function(action, lineId) {
                      if (action === "select") {
                        setSelectedLines(function(prev) { var n={...prev}; n[lineId]=true; return n; });
                      } else if (action === "deselect") {
                        setSelectedLines(function(prev) { var n={...prev}; delete n[lineId]; return n; });
                      } else if (action === "bracket") {
                        sbBracketLines(group.id, block.id, Object.keys(selectedLines));
                      }
                    }}
                    convertTime={convertTime}
                  />
                ))}

                {/* Add block button */}
                {!editingBlock && (
                  <button onClick={() => setEditingBlock(sbNewBlock())} style={{
                    width: "100%", padding: "9px", marginTop: 4,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px dashed rgba(255,255,255,0.10)", borderRadius: 8,
                    color: "rgba(255,255,255,0.25)", cursor: "pointer",
                    fontFamily: "monospace", fontSize: 10, letterSpacing: "0.06em",
                  }}>+ ADD BLOCK</button>
                )}
              </div>
            ))}

            {/* Block editor */}
            {editingBlock && (
              <SbBlockEditor
                block={editingBlock}
                onChange={setEditingBlock}
                onCommit={() => {
                  if (editingBlock._mode === "edit") sbReplaceBlock(editingBlock);
                  else sbCommitBlock(editingBlock);
                }}
                onCancel={() => setEditingBlock(null)}
                sbNewLine={sbNewLine}
                sbNewBlock={sbNewBlock}
                sbAddChild={sbAddChild}
                sbDeleteChild={sbDeleteChild}
                sbUpdateChild={sbUpdateChild}
                sbMoveChild={sbMoveChild}
                sbParseSec={sbParseSec}
                sbFmtDur={sbFmtDur}
                sbZoneColor={sbZoneColor}
                sbLineRest={sbLineRest}
                sbBlockVolume={sbBlockVolume}
                sbBlockTotalTime={sbBlockTotalTime}
                pace200Map={getPace200ByStroke()}
              />
            )}

            {/* Export panel — all buttons always visible */}
            <div style={{ marginTop:8, display:"flex", gap:6, flexWrap:"wrap" }}>
              <button onClick={function(){setShowCsv(function(v){return v==="import"?false:"import";});}}
                style={{ padding:"5px 14px", background:"rgba(48,176,199,0.06)",
                  border:"1px solid rgba(48,176,199,0.2)", borderRadius:5,
                  color:"rgba(48,176,199,0.6)", cursor:"pointer",
                  fontFamily:"monospace", fontSize:9, fontWeight:700 }}>
                {showCsv==="import" ? "HIDE IMPORT" : "⬇ IMPORT SESSION"}
              </button>
              <button onClick={function(){setShowPrintPreview(function(v){return !v;});}}
                style={{ padding:"5px 14px", background:"rgba(255,255,255,0.07)",
                  border:"1px solid rgba(255,255,255,0.18)", borderRadius:5,
                  color:"rgba(255,255,255,0.7)", cursor:"pointer",
                  fontFamily:"monospace", fontSize:9, fontWeight:700 }}>
                {showPrintPreview ? "HIDE PREVIEW" : "⎙ PRINT PREVIEW"}
              </button>
              <button onClick={() => setShowCsv(function(v){return v ? false : "json";})}
                style={{ padding:"5px 14px", background:"rgba(255,255,255,0.04)",
                  border:"1px solid rgba(255,255,255,0.10)", borderRadius:5,
                  color:"rgba(255,255,255,0.4)", cursor:"pointer",
                  fontFamily:"monospace", fontSize:9, fontWeight:700 }}>
                {showCsv ? "HIDE" : "JSON / CSV"}
              </button>
            </div>
            {showCsv === "import" && (
              <div style={{ marginTop:6, background:"rgba(0,0,0,0.3)",
                border:"1px solid rgba(48,176,199,0.15)", borderRadius:8, padding:12 }}>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.25)", marginBottom:4 }}>
                  Paste SwimZone JSON to load a saved session:
                </div>
                <textarea placeholder="Paste session JSON here…"
                  rows={4} id="json-import-area"
                  style={{ width:"100%", background:"rgba(255,255,255,0.04)",
                    border:"1px solid rgba(255,255,255,0.08)", borderRadius:6,
                    color:"rgba(255,255,255,0.6)", fontFamily:"monospace",
                    fontSize:9, padding:8, resize:"vertical",
                    boxSizing:"border-box", outline:"none", marginBottom:6 }} />
                <button onClick={function() {
                  var el = document.getElementById("json-import-area");
                  if (!el || !el.value.trim()) return;
                  var err = importJson(el.value);
                  if (err) alert("Import error: "+err);
                  else { el.value = ""; setShowCsv(false); }
                }} style={{ padding:"5px 14px", background:"rgba(48,176,199,0.12)",
                  border:"1px solid rgba(48,176,199,0.4)", borderRadius:5,
                  color:"#30B0C7", cursor:"pointer", fontFamily:"monospace",
                  fontSize:9, fontWeight:700 }}>LOAD SESSION</button>
              </div>
            )}
            {showPrintPreview && sbSessionVolume() > 0 && (
              <div style={{ marginTop:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", marginBottom:6 }}>
                  <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)",
                    letterSpacing:"0.08em" }}>
                    PRINT PREVIEW — right-click iframe → Print, or copy HTML below
                  </div>
                  <button onClick={function(){
                    var el = document.getElementById("print-html-src");
                    if (el) { el.select(); document.execCommand("copy"); }
                  }} style={{ padding:"3px 10px", background:"rgba(255,255,255,0.06)",
                    border:"1px solid rgba(255,255,255,0.15)", borderRadius:4,
                    color:"rgba(255,255,255,0.5)", cursor:"pointer",
                    fontFamily:"monospace", fontSize:9 }}>
                    COPY HTML
                  </button>
                </div>
                <iframe
                  srcDoc={generateSetHtml()}
                  style={{ width:"100%", height:480, border:"1px solid rgba(255,255,255,0.15)",
                    borderRadius:6, background:"#fff" }}
                  title="Print preview"
                />
                <textarea id="print-html-src" readOnly
                  value={generateSetHtml()}
                  rows={3}
                  onClick={function(e){e.target.select();}}
                  style={{ marginTop:6, width:"100%",
                    background:"rgba(0,0,0,0.3)",
                    border:"1px solid rgba(255,255,255,0.06)", borderRadius:6,
                    color:"rgba(255,255,255,0.35)", fontFamily:"monospace",
                    fontSize:8, padding:6, resize:"vertical",
                    boxSizing:"border-box", outline:"none" }} />
                <div style={{ fontSize:8, color:"rgba(255,255,255,0.2)", marginTop:3 }}>
                  To print: right-click the preview → Print · Or copy HTML and open in a browser tab
                </div>
              </div>
            )}

            {showCsv && showCsv !== "import" && (
              <div style={{ marginTop:8, background:"rgba(0,0,0,0.3)",
                border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, padding:12 }}>
                <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                  {[["json","SESSION JSON (import/export)"],["csv","FLAT CSV (spreadsheet)"]].map(function(t) {
                    return (
                      <button key={t[0]} onClick={function(){setShowCsv(t[0]);}}
                        style={{ padding:"3px 10px", borderRadius:4, cursor:"pointer",
                          fontFamily:"monospace", fontSize:9, fontWeight:700, border:"1px solid",
                          borderColor: showCsv===t[0]?"rgba(255,255,255,0.4)":"rgba(255,255,255,0.1)",
                          background: showCsv===t[0]?"rgba(255,255,255,0.1)":"transparent",
                          color: showCsv===t[0]?"#fff":"rgba(255,255,255,0.35)" }}>
                        {t[1]}
                      </button>
                    );
                  })}
                </div>
                {showCsv === "json" && (
                  <div>
                    <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)",
                      letterSpacing:"0.08em", marginBottom:4 }}>
                      EXPORT: click to select all and copy · IMPORT: paste JSON below and click LOAD
                    </div>
                    <textarea value={generateJson()} readOnly
                      onClick={function(e){e.target.select();}} rows={6}
                      style={{ width:"100%", background:"rgba(255,255,255,0.03)",
                        border:"1px solid rgba(255,255,255,0.06)", borderRadius:6,
                        color:"rgba(255,255,255,0.6)", fontFamily:"monospace",
                        fontSize:9, padding:8, resize:"vertical",
                        boxSizing:"border-box", outline:"none", marginBottom:6 }} />

                  </div>
                )}
                {showCsv === "csv" && (
                  <div>
                    <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)",
                      letterSpacing:"0.08em", marginBottom:4 }}>
                      FLAT CSV — click to select all, paste into spreadsheet
                    </div>
                    <textarea value={generateCsv()} readOnly
                      onClick={function(e){e.target.select();}} rows={8}
                      style={{ width:"100%", background:"rgba(255,255,255,0.03)",
                        border:"1px solid rgba(255,255,255,0.06)", borderRadius:6,
                        color:"rgba(255,255,255,0.6)", fontFamily:"monospace",
                        fontSize:9, padding:8, resize:"vertical",
                        boxSizing:"border-box", outline:"none" }} />
                  </div>
                )}
              </div>
            )}

            {/* Session summary footer */}
            {sbSessionVolume() > 0 && (
              <div style={{ marginTop: 16, padding: "10px 14px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)",
                    letterSpacing: "0.1em" }}>SESSION TOTAL</span>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {session.groups.filter(g => sbGroupVolume(g) > 0).map(g => (
                      <span key={g.id} style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                        {g.label}: {Math.round(sbGroupVolume(g))}m &middot; {sbFmtDur(sbGroupTime(g))}
                      </span>
                    ))}
                    <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>
                      {Math.round(sbSessionVolume())}m &middot; {sbFmtDur(session.groups.reduce((s,g)=>s+sbGroupTime(g),0))}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}


        {tab === "classifier" && useRefactorClassifier && (
          <ClassifierScreenRefactor {...sharedClassifierProps} />
        )}
        {tab === "classifier" && !useRefactorClassifier && (
          <div>
            <div style={{ marginBottom: 10 }}>
              <button onClick={() => setUseRefactorClassifier(true)}
                style={{ padding: "5px 10px", marginBottom: 8, fontSize: 11, borderRadius: 5,
                  border: "1px solid rgba(255,255,255,0.2)", cursor: "pointer", background: "rgba(48,176,199,0.12)", color: "#fff" }}>
                Use Refactor Classifier Screen
              </button>
            </div>

        {/* Active athlete banner */}
        {activeAthlete && (
          <div style={{ background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.25)",
            borderRadius: 8, padding: "8px 14px", marginBottom: 12,
            display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, color: "rgba(52,199,89,0.9)", letterSpacing: "0.06em" }}>
              {activeAthlete.name ? activeAthlete.name : "ACTIVE ATHLETE"} {activeAthlete.seNumber ? "(" + activeAthlete.seNumber + ")" : ""} — {Object.keys(activeAthlete.times).length} events loaded
            </span>
            <span style={{ fontSize: 9, color: "rgba(52,199,89,0.5)" }}>
              {ATHLETE_TYPE_OPTS.find(o => o.v === inputs.athleteType)?.l || "All-Round"}
              {" · "}
              {{ pre: "Pre-PHV", developing: "Early Post-PHV", post: "Post-PHV" }[inputs.phvStatus]}
              {activeAthlete.derivedProfile && activeAthlete.derivedProfile.aiPct
                ? " · " + activeAthlete.derivedProfile.aiPct + "% drop/doubling"
                : ""}
              {activeAthlete.derivedProfile && activeAthlete.derivedProfile.css
                ? " · CSS " + secToDisplay(activeAthlete.derivedProfile.css) + "/100m (" + activeAthlete.derivedProfile.cssMethod + ")"
                : ""}
            </span>
          </div>
        )}

        {/* Inputs */}
        <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)",
          borderRadius:10, padding:"10px 14px", marginBottom:14 }}>

          {/* Row 1: numeric inputs */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"flex-end", marginBottom:8 }}>
            <div>
              <label style={lb}>Stroke</label>
              <select style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)",
                borderRadius:5, color:"#fff", padding:"5px 6px", fontFamily:"monospace", fontSize:13, outline:"none" }}
                value={inputs.stroke}
                onChange={e => {
                  const s = e.target.value; set("stroke", s);
                  if (activeAthlete) { const t = activeAthlete.times["200_"+s]; if(t) set("pace200",t.display); }
                }}>
                <option value="FS">FS</option>
                <option value="BK">BK</option>
                <option value="BR">BR</option>
                <option value="Fly">Fly</option>
                <option value="IM">IM</option>
              </select>
            </div>
            <div style={{ width:68 }}>
              <label style={lb}>Dist m</label>
              <div style={{ display:"flex", gap:0 }}>
                <input style={{ ...inp, padding:"5px 6px", fontSize:13,
                  borderRadius:"5px 0 0 5px", width:"100%", textAlign:"right" }}
                  value={inputs.distM}
                  onChange={e => set("distM", e.target.value)}
                  onKeyDown={e => {
                    var DISTS = [25,50,75,100,150,200,300,400,800,1500];
                    var cur = parseFloat(inputs.distM) || 100;
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      var next = DISTS.find(function(d){return d > cur;}) || DISTS[DISTS.length-1];
                      set("distM", String(next));
                    } else if (e.key === "ArrowDown") {
                      e.preventDefault();
                      var prev = [...DISTS].reverse().find(function(d){return d < cur;}) || DISTS[0];
                      set("distM", String(prev));
                    }
                  }} />
                <div style={{ display:"flex", flexDirection:"column" }}>
                  <button onClick={() => {
                    var DISTS = [25,50,75,100,150,200,300,400,800,1500];
                    var cur = parseFloat(inputs.distM)||100;
                    var next = DISTS.find(function(d){return d>cur;})||DISTS[DISTS.length-1];
                    set("distM",String(next));
                  }} style={{ padding:"0 5px", height:"50%", background:"rgba(255,255,255,0.07)",
                    border:"1px solid rgba(255,255,255,0.1)", borderLeft:"none",
                    borderRadius:"0 5px 0 0", color:"rgba(255,255,255,0.5)",
                    cursor:"pointer", fontSize:9, lineHeight:1 }}>▲</button>
                  <button onClick={() => {
                    var DISTS = [25,50,75,100,150,200,300,400,800,1500];
                    var cur = parseFloat(inputs.distM)||100;
                    var prev = [...DISTS].reverse().find(function(d){return d<cur;})||DISTS[0];
                    set("distM",String(prev));
                  }} style={{ padding:"0 5px", height:"50%", background:"rgba(255,255,255,0.07)",
                    border:"1px solid rgba(255,255,255,0.1)", borderLeft:"none", borderTop:"none",
                    borderRadius:"0 0 5px 0", color:"rgba(255,255,255,0.5)",
                    cursor:"pointer", fontSize:9, lineHeight:1 }}>▼</button>
                </div>
              </div>
            </div>
            <div style={{ width:44 }}><label style={lb}>Qty</label>
              <input style={{ ...inp, padding:"5px 6px", fontSize:13 }} type="number" value={inputs.qty} onChange={e => set("qty", e.target.value)} /></div>
            <div style={{ width:70 }}><label style={lb}>Target (IN)</label>
              <input style={{ ...inp, padding:"5px 6px", fontSize:13 }} value={inputs.targetTime} onChange={e => set("targetTime", e.target.value)} /></div>
            <div style={{ width:70 }}>
              <label style={lb}>ON
                {inputs.onTime && inputs.targetTime && parseTime(inputs.onTime) && parseTime(inputs.targetTime) && (
                  <span style={{ color:"rgba(255,255,255,0.3)", fontWeight:400, marginLeft:4 }}>
                    {Math.round(Math.max(0,parseTime(inputs.onTime)-parseTime(inputs.targetTime)))}s rest
                  </span>
                )}
              </label>
              <input style={{ ...inp, padding:"5px 6px", fontSize:13 }} placeholder="1:30" value={inputs.onTime} onChange={e => set("onTime", e.target.value)} />
            </div>
            <div style={{ width:78 }}><label style={lb}>200 PB</label>
              <input style={{ ...inp, padding:"5px 6px", fontSize:13 }} value={inputs.pace200} onChange={e => set("pace200", e.target.value)} /></div>
          </div>

          {/* Row 2: Zone picker */}
          <div style={{ display:"flex", gap:4, marginBottom:6 }}>
            {["HVO","LT","LP","AT","CS","A3","A2","A1"].map(function(z) {
              var ZC = { HVO:"#FF2D55",LT:"#FF5500",LP:"#FF9500",AT:"#FFCC00",CS:"#30B0C7",A3:"#34C759",A2:"#30B0C7",A1:"#007AFF" };
              var zc = ZC[z];
              var active = selectedZone === z;
              return (
                <button key={z} onClick={function(){setSelectedZone(active ? null : z); setClassifierDrill("");}}
                  style={{ flex:1, padding:"5px 2px", borderRadius:5, cursor:"pointer",
                    fontFamily:"monospace", fontSize:11, fontWeight:700, border:"1px solid",
                    borderColor: active ? zc : zc+"55",
                    background: active ? zc+"25" : zc+"0A",
                    color: active ? zc : zc+"99",
                    transition:"all 0.15s" }}>
                  {z}
                </button>
              );
            })}
          </div>


          {/* Row 3: Time options for selected zone */}
          {selectedZone && classifierSuggestion && classifierSuggestion[selectedZone] && (function() {
            var sg = classifierSuggestion[selectedZone];
            var ZC = { HVO:"#FF2D55",LT:"#FF5500",LP:"#FF9500",AT:"#FFCC00",CS:"#30B0C7",A3:"#34C759",A2:"#30B0C7",A1:"#007AFF" };
            var zc = ZC[selectedZone] || "#fff";
            // For CS: generate options centred on CSS pace
            var cssPaceSec = activeAthlete && activeAthlete.derivedProfile && activeAthlete.derivedProfile.css;
            var isCS = selectedZone === "CS";
            // Generate IN options
            var inOpts = [];
            if (isCS && cssPaceSec) {
              var dist3 = parseFloat(inputs.distM) || 100;
              var cssTime = Math.round(cssPaceSec * dist3 / 100);
              // 5 options: -2, -1, 0, +1, +2 seconds from CSS time
              for (var di = -2; di <= 2; di++) inOpts.push(cssTime + di);
            } else {
              var inStep = Math.max(1, Math.round((sg.inHigh - sg.inLow) / 4));
              for (var i2 = sg.inLow; i2 <= sg.inHigh + 0.5; i2 += inStep) {
                inOpts.push(Math.round(i2));
                if (inOpts.length >= 5) break;
              }
            }
            // Generate ON options
            var onOpts = [];
            if (isCS && cssPaceSec) {
              var dist3b = parseFloat(inputs.distM) || 100;
              var cssTime2 = Math.round(cssPaceSec * dist3b / 100);
              // Use selected IN time if set, otherwise use CSS time
              var inForOn2 = parseTime(inputs.targetTime) || cssTime2;
              // CS work:rest 1.5:1 to 2:1 → rest = IN/ratio, ON = IN + rest
              var onRatios = [1.5, 1.6, 1.7, 1.8, 2.0]; // work:rest ratios
              onOpts = onRatios.map(function(r) {
                return Math.round((inForOn2 + inForOn2 / r) / 5) * 5;
              });
            } else {
              var onStep = Math.max(5, Math.round((sg.onHigh - sg.onLow) / 4 / 5) * 5);
              for (var j2 = sg.onLow; j2 <= sg.onHigh + 2; j2 += onStep) {
                onOpts.push(Math.round(j2 / 5) * 5);
                if (onOpts.length >= 5) break;
              }
            }
            function fmtOpt(sec) {
              var m = Math.floor(sec/60); var s = sec%60;
              return m > 0 ? m+":"+(s<10?"0":"")+s : String(s);
            }
            return (
              <div style={{ background:zc+"0A", border:"1px solid "+zc+"25",
                borderRadius:6, padding:"8px 10px" }}>
                <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
                  <span style={{ fontSize:9, color:zc, fontWeight:700,
                    letterSpacing:"0.08em", width:20 }}>IN</span>
                  <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                    {inOpts.map(function(sec) {
                      var str = fmtOpt(sec);
                      var active2 = inputs.targetTime === str;
                      return (
                        <button key={sec} onClick={function(){set("targetTime", str);}}
                          style={{ padding:"4px 10px", borderRadius:4, cursor:"pointer",
                            fontFamily:"monospace", fontSize:12, fontWeight:700,
                            border:"1px solid "+(active2 ? zc : zc+"55"),
                            background: active2 ? zc+"30" : zc+"10",
                            color: active2 ? zc : zc+"bb" }}>
                          {str}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <span style={{ fontSize:9, color:zc+"99", fontWeight:700,
                    letterSpacing:"0.08em", width:20 }}>ON</span>
                  {(selectedZone === "A1" || (onOpts.length > 0 && onOpts[0] === onOpts[onOpts.length-1] && onOpts[0] <= (sg.inHigh+2))) ? (
                    <span style={{ fontSize:10, color:zc+"77", fontStyle:"italic" }}>
                      {selectedZone === "A1" ? "straight-on (continuous)" : "straight-on or short rest"}
                    </span>
                  ) : (
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                      {onOpts.map(function(sec) {
                        var str = fmtOpt(sec);
                        var active3 = inputs.onTime === str;
                        return (
                          <button key={sec} onClick={function(){set("onTime", str);}}
                            style={{ padding:"4px 10px", borderRadius:4, cursor:"pointer",
                              fontFamily:"monospace", fontSize:12, fontWeight:700,
                              border:"1px solid "+(active3 ? zc : zc+"33"),
                              background: active3 ? zc+"20" : "transparent",
                              color: active3 ? zc : zc+"77" }}>
                            {str}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Drill quick-pick — shown for aerobic zones */}
          {selectedZone && (selectedZone === "A1" || selectedZone === "A2" || selectedZone === "A3") && (function() {
            var DL2 = DRILL_LIBRARY;
            var available2 = [];
            var ds = inputs.stroke;
            if (DL2[ds]) DL2[ds].forEach(function(d) {
              if (d.type !== "drill" && d.type !== "focus") return;
              var ceilOk = !d.zoneCeiling;
              if (!ceilOk) {
                var zo = ["A1","A2","A3"]; 
                ceilOk = zo.indexOf(selectedZone) <= zo.indexOf(d.zoneCeiling);
              }
              if (ceilOk) available2.push(d);
            });
            if (DL2["MULTI"]) DL2["MULTI"].forEach(function(d) { available2.push(d); });
            if (available2.length === 0) return null;
            var ZC6 = { A3:"#34C759", A2:"#30B0C7", A1:"#007AFF" };
            var zc6 = ZC6[selectedZone] || "#8E8E93";
            // Find selected drill details
            var selD = available2.find(function(d){return d.name===classifierDrill;});
            return (
              <div style={{ marginTop:6, padding:"6px 8px",
                background:zc6+"08", border:"1px solid "+zc6+"20", borderRadius:5 }}>
                <div style={{ fontSize:8, color:zc6+"99", letterSpacing:"0.08em",
                  marginBottom:4 }}>DRILLS / FOCUS — {ds}</div>
                <select value={classifierDrill}
                  onChange={function(e) {
                    var name = e.target.value;
                    setClassifierDrill(name);
                    if (!name) return;
                    var chosen = available2.find(function(d){return d.name===name;});
                    if (!chosen || !chosen.paceFactor) return;
                    var SMULT6 = { FS:1.0, BK:1.045, BR:1.254, Fly:1.051, IM:1.082 };
                    var p6 = parseTime(inputs.pace200);
                    if (!p6) return;
                    var zoneSR6 = { A1:1.52, A2:1.30, A3:1.16 };
                    var sr6 = zoneSR6[selectedZone] || 1.30;
                    var dist6 = parseFloat(inputs.distM) || 100;
                    var base6 = (p6 * (SMULT6[ds]||1.0)) / 2;
                    var rawSec6 = base6 * (dist6/100) * chosen.paceFactor * sr6;
                    var m6 = Math.floor(rawSec6/60);
                    var s6 = Math.round(rawSec6 % 60);
                    if (s6 === 60) { m6++; s6 = 0; }
                    set("targetTime", m6 > 0 ? m6+":"+(s6<10?"0":"")+s6 : String(s6));
                  }}
                  style={{ width:"100%", background:"rgba(255,255,255,0.07)",
                    border:"1px solid "+zc6+"30", borderRadius:4,
                    color:"#fff", padding:"4px 6px", fontFamily:"monospace",
                    fontSize:10, outline:"none", cursor:"pointer" }}>
                  <option value="">— select drill —</option>
                  {available2.map(function(d) {
                    var ceiling = d.zoneCeiling ? " [≤"+d.zoneCeiling+"]" : "";
                    return <option key={d.name} value={d.name}>{d.name}{ceiling}</option>;
                  })}
                </select>
                {selD && selD.objective && selD.objective !== "detail_pending" && (
                  <div style={{ marginTop:4, fontSize:9, color:"rgba(255,255,255,0.4)",
                    fontStyle:"italic", lineHeight:1.4 }}>{selD.objective}</div>
                )}
                {selD && selD.coachingNotes && selD.coachingNotes !== "" && selD.coachingNotes !== "detail_pending" && (
                  <div style={{ marginTop:2, fontSize:9, color:"rgba(255,255,255,0.25)",
                    lineHeight:1.4 }}>Coach: {selD.coachingNotes}</div>
                )}
              </div>
            );
          })()}

          {/* Row 4: Rest type (moved to end) */}
          <div style={{ display:"flex", gap:4, alignItems:"center", marginTop:6 }}>
            <span style={{ fontSize:9, color:"rgba(255,255,255,0.25)",
              letterSpacing:"0.08em", marginRight:2 }}>REST TYPE:</span>
            {REST_TYPE_OPTS.map(function(opt) { return (
              <button key={opt.v} onClick={function(){set("restType", opt.v);}} style={{
                padding:"3px 10px", borderRadius:4, cursor:"pointer",
                fontFamily:"monospace", fontSize:9, fontWeight:700, border:"1px solid",
                borderColor: inputs.restType===opt.v ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.08)",
                background: inputs.restType===opt.v ? "rgba(255,255,255,0.1)" : "transparent",
                color: inputs.restType===opt.v ? "#fff" : "rgba(255,255,255,0.35)",
              }}>{opt.l}</button>
            ); })}
          </div>

        </div>

        {/* Add to Set */}
        {inputs.distM && inputs.targetTime && (
          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:8 }}>
            <button onClick={() => {
              var inSec = parseTime(inputs.targetTime)||0;
              var onStr = inputs.onTime || (inSec > 0 ? String(Math.round(inSec+(parseFloat(inputs.restSec)||0))) : "");
              var newLine = sbNewLine({
                dist:inputs.distM, stroke:inputs.stroke, qty:inputs.qty,
                targetTime:inputs.targetTime, onTime:onStr,
                intensity:selectedZone||(singleResult&&singleResult.primary?singleResult.primary.id:"A2"),
                note:classifierDrill||"",
                modifier:classifierDrill?"Drill":"Full",
                poolType:poolDisplay,
              });
              if (editingBlock) {
                setEditingBlock(function(b){return b?{...b,children:[...b.children,newLine]}:b;});
              } else {
                sbCommitBlock(sbNewBlock({children:[newLine]}));
              }
              setClassifierDrill("");
            }} style={{ padding:"7px 20px", background:"rgba(52,199,89,0.12)",
              border:"1px solid rgba(52,199,89,0.45)", borderRadius:6,
              color:"#34C759", cursor:"pointer", fontFamily:"monospace",
              fontSize:11, fontWeight:700, letterSpacing:"0.06em" }}>
              + ADD TO SET{editingBlock ? " (open block)" : ""}
            </button>
          </div>
        )}

        {/* Zone selection banners */}
        {selectedZone === "CS" && singleResult && singleResult.csDetection && (
          <div style={{
            background: singleResult.csDetection.isCS ? "rgba(48,176,199,0.12)" : "rgba(48,176,199,0.06)",
            border: "1px solid " + (singleResult.csDetection.isCS ? "rgba(48,176,199,0.5)" : "rgba(48,176,199,0.2)"),
            borderLeft: "4px solid " + (singleResult.csDetection.isCS ? "#30B0C7" : "rgba(48,176,199,0.3)"),
            borderRadius:8, padding:"10px 14px", marginBottom:10, fontSize:11, lineHeight:1.7,
          }}>
            <div style={{ fontWeight:700, color:singleResult.csDetection.isCS?"#30B0C7":"rgba(48,176,199,0.7)", marginBottom:4 }}>
              {singleResult.csDetection.isCS ? "✓ CS TRAINING SET" : "~ PARTIAL CS MATCH"}
            </div>
            <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10 }}>
              <span style={{ color:singleResult.csDetection.speedOk?"#34C759":"rgba(255,255,255,0.3)" }}>
                Speed {singleResult.csDetection.speedOk?"✓":"✗"} {secToDisplay(singleResult.csDetection.repPace100)}/100m vs CSS {secToDisplay(singleResult.csDetection.cssPace)}/100m (±5%)
              </span>{" · "}
              <span style={{ color:singleResult.csDetection.restOk?"#34C759":"rgba(255,255,255,0.3)" }}>
                Work:rest {singleResult.csDetection.restOk?"✓":"✗"} {singleResult.csDetection.workRest}:1 (target ~1.5:1)
              </span>{" · "}
              <span style={{ color:singleResult.csDetection.volumeOk?"#34C759":"rgba(255,255,255,0.3)" }}>
                Volume {singleResult.csDetection.volumeOk?"✓":"✗"} {singleResult.csDetection.totalWorkMin} min (27–33 min)
              </span>{" · "}
              <span style={{ color:singleResult.csDetection.distOk?"#34C759":"rgba(255,255,255,0.3)" }}>
                Dist {singleResult.csDetection.distOk?"✓":"✗"} {inputs.distM}m (50–250m)
              </span>
            </div>
          </div>
        )}
        {selectedZone === "CS" && (!singleResult || !singleResult.csDetection) && (
          <div style={{ background:"rgba(48,176,199,0.05)", border:"1px solid rgba(48,176,199,0.15)",
            borderLeft:"4px solid rgba(48,176,199,0.25)", borderRadius:8, padding:"8px 14px",
            marginBottom:10, fontSize:10, color:"rgba(48,176,199,0.5)" }}>
            {activeAthlete && activeAthlete.derivedProfile && activeAthlete.derivedProfile.css
              ? "Enter set parameters above to check against CSS pace"
              : "Load athlete times to calculate CSS — then time suggestions will appear"}
          </div>
        )}
        {selectedZone === "LP" && singleResult && (function() {
          var r = singleResult;
          var inRange = r.speedRatio >= 0.97 && r.speedRatio < 1.025;
          var restOk  = r.restWorkRatio >= 0.9;
          var distOk  = parseFloat(inputs.distM) <= 100;
          var matchCount = [inRange, restOk, distOk].filter(Boolean).length;
          var isLP = matchCount === 3;
          return (
            <div style={{ background:isLP?"rgba(255,149,0,0.10)":"rgba(255,149,0,0.05)",
              border:"1px solid "+(isLP?"rgba(255,149,0,0.45)":"rgba(255,149,0,0.2)"),
              borderLeft:"4px solid "+(isLP?"#FF9500":"rgba(255,149,0,0.3)"),
              borderRadius:8, padding:"10px 14px", marginBottom:10, fontSize:11, lineHeight:1.7 }}>
              <div style={{ fontWeight:700, color:isLP?"#FF9500":"rgba(255,149,0,0.6)", marginBottom:4 }}>
                {isLP ? "✓ LP SET" : "~ PARTIAL LP MATCH"}
              </div>
              <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10 }}>
                <span style={{ color:inRange?"#34C759":"rgba(255,255,255,0.3)" }}>
                  Pace {inRange?"✓":"✗"} {secToDisplay(r.repPace100)}/100m (target 200PB/2 = {secToDisplay(parseTime(inputs.pace200)||66)}/100m)
                </span>{" · "}
                <span style={{ color:restOk?"#34C759":"rgba(255,255,255,0.3)" }}>
                  Rest {restOk?"✓":"✗"} {r.restWorkRatio.toFixed(2)}:1 work:rest (need ≥1:1)
                </span>{" · "}
                <span style={{ color:distOk?"#34C759":"rgba(255,255,255,0.3)" }}>
                  Dist {distOk?"✓":"✗"} {inputs.distM}m (LP = 25–100m)
                </span>
              </div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", marginTop:4 }}>
                Total LP volume: {r.totalVolume}m · Target 500–1200m across the full set
              </div>
            </div>
          );
        })()}
        {(selectedZone === "AT" || selectedZone === "A3") && singleResult && (function() {
          var r = singleResult;
          var zoneRange = selectedZone === "AT" ? [1.025, 1.10] : [1.10, 1.22];
          var inRange2 = r.speedRatio >= zoneRange[0] && r.speedRatio < zoneRange[1];
          var zc2 = selectedZone === "AT" ? "#FFCC00" : "#34C759";
          return (
            <div style={{ background:inRange2?zc2+"12":zc2+"06",
              border:"1px solid "+(inRange2?zc2+"45":zc2+"20"),
              borderLeft:"4px solid "+(inRange2?zc2:zc2+"40"),
              borderRadius:8, padding:"8px 14px", marginBottom:10, fontSize:10,
              color:"rgba(255,255,255,0.6)", lineHeight:1.6 }}>
              <span style={{ fontWeight:700, color:inRange2?zc2:zc2+"80", marginRight:8 }}>
                {inRange2 ? "✓ " + selectedZone : "✗ Outside " + selectedZone}
              </span>
              {secToDisplay(r.repPace100)}/100m · rest:work {r.restWorkRatio.toFixed(1)}:1
              {selectedZone === "AT" && " · target 1.5–2:1 work:rest"}
              {selectedZone === "A3" && " · target 0.25–0.5:1 rest:work"}
            </div>
          );
        })()}

                {(seqResult||singleResult) ? (
          <div style={{ animation: "fadeIn 0.35s ease" }}>
            {seqResult && (
              <div style={{ background:"rgba(48,176,199,0.08)", border:"1px solid rgba(48,176,199,0.25)", borderRadius:8, padding:"8px 14px", marginBottom:12, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:10, color:"rgba(48,176,199,0.9)", letterSpacing:"0.06em" }}>BRACKET ANALYSIS — {seqResult.sequenceLength} components · {Math.round(seqResult.totalVolume)}m</span>
                <button onClick={() => { setSelectedElement(null); setSeqResult(null); }} style={{ fontSize:9, padding:"2px 10px", background:"transparent", border:"1px solid rgba(48,176,199,0.3)", borderRadius:4, color:"#30B0C7", cursor:"pointer", fontFamily:"monospace" }}>clear</button>
              </div>
            )}

            {/* CS Training detection callout */}
            {selectedZone !== "CS" && (seqResult||singleResult).csDetection && ((seqResult||singleResult).csDetection.isCS || (seqResult||singleResult).csDetection.partial) && (
              <div style={{
                background: (seqResult||singleResult).csDetection.isCS ? "rgba(48,176,199,0.12)" : "rgba(48,176,199,0.06)",
                border: "1px solid " + ((seqResult||singleResult).csDetection.isCS ? "rgba(48,176,199,0.5)" : "rgba(48,176,199,0.2)"),
                borderLeft: "4px solid " + ((seqResult||singleResult).csDetection.isCS ? "#30B0C7" : "rgba(48,176,199,0.4)"),
                borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 11, lineHeight: 1.7,
              }}>
                <div style={{ fontWeight: 700, color: (seqResult||singleResult).csDetection.isCS ? "#30B0C7" : "rgba(48,176,199,0.7)", marginBottom: 4 }}>
                  {(seqResult||singleResult).csDetection.isCS ? "✓ CS TRAINING SET" : "~ PARTIAL CS MATCH"}
                </div>
                <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 10 }}>
                  <span style={{ color: (seqResult||singleResult).csDetection.speedOk ? "#34C759" : "rgba(255,255,255,0.3)" }}>
                    Speed {(seqResult||singleResult).csDetection.speedOk ? "✓" : "✗"} {secToDisplay((seqResult||singleResult).csDetection.repPace100)}/100m
                    {" vs CSS "}{secToDisplay((seqResult||singleResult).csDetection.cssPace)}/100m (±5%)
                  </span>
                  {"  ·  "}
                  <span style={{ color: (seqResult||singleResult).csDetection.restOk ? "#34C759" : "rgba(255,255,255,0.3)" }}>
                    Work:rest {(seqResult||singleResult).csDetection.restOk ? "✓" : "✗"} {(seqResult||singleResult).csDetection.workRest}:1 (target ~1.5:1)
                  </span>
                  {"  ·  "}
                  <span style={{ color: (seqResult||singleResult).csDetection.volumeOk ? "#34C759" : "rgba(255,255,255,0.3)" }}>
                    Volume {(seqResult||singleResult).csDetection.volumeOk ? "✓" : "✗"} {(seqResult||singleResult).csDetection.totalWorkMin} min work (target 27–33 min)
                  </span>
                  {"  ·  "}
                  <span style={{ color: (seqResult||singleResult).csDetection.distOk ? "#34C759" : "rgba(255,255,255,0.3)" }}>
                    Rep dist {(seqResult||singleResult).csDetection.distOk ? "✓" : "✗"} {inputs.distM}m (50–250m)
                  </span>
                </div>
              </div>
            )}

            {/* PL suggestion note */}
            {(seqResult||singleResult).plSuggestion && (
              <div style={{
                background: "rgba(204,34,0,0.08)",
                border: "1px solid rgba(204,34,0,0.3)",
                borderLeft: "4px solid #CC2200",
                borderRadius: 8, padding: "10px 14px", marginBottom: 14,
                fontSize: 11, lineHeight: 1.7,
              }}>
                <div style={{ fontWeight: 700, color: "rgba(204,34,0,0.9)", marginBottom: 4 }}>
                  ⚑ POSSIBLE PL TERRITORY — CONFIRMATION NEEDED
                </div>
                <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 10 }}>
                  {(seqResult||singleResult).plSuggestion.note}
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                  PL target pace = race pace for twice the rep distance.
                  For {inputs.distM}m reps, target is ~{parseInt(inputs.distM) <= 100 ? "200m" : parseInt(inputs.distM) <= 200 ? "400m" : "800m"} PB pace.
                  Rest: 10–15 min active (A1 swimdown 500–1500m).
                </div>
              </div>
            )}

            {/* Pace validation warning */}
            {(seqResult||singleResult).paceValidation?.warningLevel && (
              <div style={{
                background: (seqResult||singleResult).paceValidation.warningLevel === "impossible"
                  ? "rgba(255,45,85,0.15)" : "rgba(255,149,0,0.12)",
                border: `1px solid ${(seqResult||singleResult).paceValidation.warningLevel === "impossible" ? "rgba(255,45,85,0.5)" : "rgba(255,149,0,0.4)"}`,
                borderLeft: `4px solid ${(seqResult||singleResult).paceValidation.warningLevel === "impossible" ? "#FF2D55" : "#FF9500"}`,
                borderRadius: 8, padding: "10px 14px", marginBottom: 14,
                fontSize: 11, lineHeight: 1.6,
                color: (seqResult||singleResult).paceValidation.warningLevel === "impossible"
                  ? "rgba(255,180,180,0.95)" : "rgba(255,220,150,0.95)",
              }}>
                {(seqResult||singleResult).paceValidation.warningMsg}
              </div>
            )}

            {/* Consistency warning */}
            {(seqResult||singleResult).consistencyWarning && (
              <div style={{
                background: "rgba(255,149,0,0.12)",
                border: "1px solid rgba(255,149,0,0.4)",
                borderLeft: "4px solid #FF9500",
                borderRadius: 8, padding: "12px 14px", marginBottom: 14,
                fontSize: 11, lineHeight: 1.7,
                color: "rgba(255,220,150,0.95)",
              }}>
                <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12 }}>
                  ⚠ CONSISTENCY WARNING
                </div>
                <div>
                  Target time of {fmtTime((seqResult||singleResult).workDur)} is at or near maximum sustainable pace.
                  With {parseFloat(inputs.restSec)}s {restTypeOpt?.l?.toLowerCase()} rest,
                  rep {(seqResult||singleResult).consistencyWarning.rep} is estimated to be
                  ~{fmtTime((seqResult||singleResult).consistencyWarning.estimatedTime)} ({(seqResult||singleResult).consistencyWarning.degradationPct.toFixed(1)}% slower).
                  {(seqResult||singleResult).consistencyWarning.worstTime > (seqResult||singleResult).workDur * 1.03 &&
                    ` Worst rep estimated ~${fmtTime((seqResult||singleResult).consistencyWarning.worstTime)}.`}
                </div>
                <div style={{ marginTop: 6, fontSize: 10, opacity: 0.75 }}>
                  For consistent times: increase rest to ~{(seqResult||singleResult).consistencyWarning.suggestedRest}s
                  {inputs.restType !== "a1" && " or switch to Active A1 recovery (68% faster lactate clearance)"}
                  {" "}· or adjust target to ~{fmtTime((seqResult||singleResult).consistencyWarning.suggestedTime)} for achievable consistency.
                </div>
              </div>
            )}

            {/* Key metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
              {[
                { l: "Speed",    v: `${((seqResult||singleResult).speedRatio * 100).toFixed(0)}%`, s: "of 200m pace" },
                { l: "Work dur", v: fmtTime((seqResult||singleResult).workDur), s: "per rep" },
                { l: "Rest:Work",v: `${(seqResult||singleResult).restWorkRatio.toFixed(1)}:1`,
                  s: (seqResult||singleResult).restoreCheck.atpcpRestored ? "✓ ATP-CP restores" : "✗ ATP-CP depletes" },
                { l: "Volume",   v: `${(seqResult||singleResult).totalVolume}m`, s: `${(seqResult||singleResult).breakdown[0].pct}% ${(seqResult||singleResult).primary.id}` },
              ].map(m => (
                <div key={m.l} style={{ background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "9px 11px" }}>
                  <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", marginBottom: 3 }}>
                    {m.l.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{m.v}</div>
                  <div style={{ fontSize: 8, color: m.s.includes("✓") ? "#34C759" : m.s.includes("✗") ? "#FF5500" : "rgba(255,255,255,0.3)" }}>
                    {m.s}
                  </div>
                </div>
              ))}
            </div>

            {/* PHV warning */}
            {(seqResult||singleResult).phvWarning && (
              <div style={{
                background: "rgba(255,149,0,0.12)", border: "1px solid rgba(255,149,0,0.35)",
                borderLeft: "4px solid #FF9500", borderRadius: 8,
                padding: "10px 14px", marginBottom: 14,
                fontSize: 11, color: "rgba(255,220,150,0.9)", lineHeight: 1.6,
              }}>
                {(seqResult||singleResult).phvWarning}
              </div>
            )}

            {/* ── Layer toggle ── */}
            <div style={{ display: "flex", gap: 0, marginBottom: 14, borderRadius: 8, overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.1)" }}>
              {[
                { v: "energy",      l: "⚡ Energy Systems" },
                { v: "zones",       l: " Training Zones" },
                { v: "adaptations", l: " Adaptations"    },
              ].map(tab => (
                <button key={tab.v} onClick={() => setResultView(tab.v)} style={{
                  flex: 1, padding: "9px 6px", border: "none", cursor: "pointer", fontFamily: "monospace",
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
                  background: resultView === tab.v ? "rgba(255,255,255,0.12)" : "transparent",
                  color: resultView === tab.v ? "#fff" : "rgba(255,255,255,0.3)",
                  borderRight: "1px solid rgba(255,255,255,0.08)",
                  transition: "all 0.2s",
                }}>{tab.l}</button>
              ))}
            </div>

            {/* ══════════════════════════════════════════
                LAYER 1 — ENERGY SYSTEMS
            ══════════════════════════════════════════ */}
            {resultView === "energy" && (<div>
              {/* Three system cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
                {ENERGY_SYSTEMS.map(sys => {
                  const pct = sys.id === "atpcp" ? (seqResult||singleResult).avgAtpcp
                            : sys.id === "glycolytic" ? (seqResult||singleResult).avgGlycolytic
                            : (seqResult||singleResult).avgAerobic;
                  const note = sys.id === "atpcp"
                    ? ((seqResult||singleResult).restoreCheck.atpcpRestored ? "replenishes between reps" : "depletes from rep 2")
                    : sys.subLabel;
                  return (
                    <div key={sys.id} style={{ background: sys.color + "18",
                      border: `1px solid ${sys.color}40`, borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginBottom: 3 }}>
                        {sys.label.toUpperCase()}
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 900, color: sys.color }}>{(pct*100).toFixed(0)}%</div>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{note}</div>
                    </div>
                  );
                })}
              </div>

              {/* Rep-by-rep chart */}
              <div style={{ background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", marginBottom: 8 }}>
                  REP-BY-REP ENERGY DRIFT
                </div>
                <RepChart repResults={(seqResult||singleResult).repResults} />
                <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
                  {[["ATP-CP","#FF2D55"],["Glycolytic","#FFCC00"],["Aerobic","#34C759"]].map(([l,c]) => (
                    <div key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 8, height: 8, background: c, borderRadius: 2 }} />
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>{l}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Energy system curve */}
              <div style={{ background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", marginBottom: 8 }}>
                  ENERGY SYSTEM CURVE (single rep)
                </div>
                <EnergyGraph result={seqResult||singleResult} />
              </div>

              {/* System detail cards */}
              {ENERGY_SYSTEMS.map(sys => {
                const pct = sys.id === "atpcp" ? (seqResult||singleResult).avgAtpcp
                          : sys.id === "glycolytic" ? (seqResult||singleResult).avgGlycolytic
                          : (seqResult||singleResult).avgAerobic;
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
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", marginBottom: 5 }}>SPECIFIC ADAPTATIONS</div>
                        {sys.specific.map((s,i) => (
                          <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", marginBottom: 3, paddingLeft: 8, borderLeft: `2px solid ${sys.color}60` }}>{s}</div>
                        ))}
                      </div>
                      <div>
                        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", marginBottom: 5 }}>GENERAL ADAPTATIONS</div>
                        {sys.general.map((s,i) => (
                          <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", marginBottom: 3, paddingLeft: 8, borderLeft: "2px solid rgba(255,255,255,0.15)" }}>{s}</div>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 9, color: "rgba(255,255,255,0.3)",
                      background: "rgba(255,255,255,0.03)", borderRadius: 4, padding: "5px 8px" }}>
                      PHV: {sys.phvNote}
                    </div>
                  </div>
                );
              })}
            </div>)}

            {/* ══════════════════════════════════════════
                LAYER 2 — TRAINING ZONES
            ══════════════════════════════════════════ */}
            {resultView === "zones" && (<div>

              {/* ── CS Training objective banner ── */}
              {(seqResult||singleResult).csDetection && (seqResult||singleResult).csDetection.isCS ? (
                <div style={{ background: "rgba(48,176,199,0.12)",
                  border: "1px solid rgba(48,176,199,0.5)",
                  borderLeft: "4px solid #30B0C7",
                  borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 10, color: "rgba(48,176,199,0.6)", letterSpacing: "0.1em" }}>TRAINING OBJECTIVE</div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: "#30B0C7", marginTop: 1 }}>
                        CS — Critical Speed Training
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 4, maxWidth: 400, lineHeight: 1.6 }}>
                        Sustained work at CSS pace. Raises the critical speed threshold — the highest pace at which lactate production equals clearance. Demands 27–33 min of total work at ~1.5:1 work:rest.
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                      <div style={{ fontSize: 10, color: "rgba(48,176,199,0.5)", marginBottom: 2 }}>CSS</div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: "#30B0C7" }}>
                        {secToDisplay((seqResult||singleResult).csDetection.cssPace)}/100m
                      </div>
                    </div>
                  </div>
                  {/* CS specific adaptations inline */}
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 8, color: "rgba(48,176,199,0.5)", letterSpacing: "0.1em", marginBottom: 4 }}>SPECIFIC ADAPTATIONS</div>
                      {["Raises Critical Speed threshold","Increased cardiac output at sustained intensity","Improved lactate clearance at threshold pace","Mitochondrial development in intermediate fibres","Blood lactate steady state at higher speeds"].map((s,i) => (
                        <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", marginBottom: 3,
                          paddingLeft: 8, borderLeft: "2px solid rgba(48,176,199,0.4)", lineHeight: 1.5 }}>{s}</div>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontSize: 8, color: "rgba(48,176,199,0.5)", letterSpacing: "0.1em", marginBottom: 4 }}>TRAINING BENEFITS</div>
                      {["Mental durability — 30 min of sustained hard work","Pacing discipline across many reps","Aerobic economy at race-relevant speeds","Foundation for all race distances 200m+"].map((s,i) => (
                        <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", marginBottom: 3,
                          paddingLeft: 8, borderLeft: "2px solid rgba(255,255,255,0.12)", lineHeight: 1.5 }}>{s}</div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Normal primary zone callout */
                <div style={{ background: (seqResult||singleResult).primary.color + "1a",
                  border: "1px solid " + (seqResult||singleResult).primary.color + "45",
                  borderLeft: "4px solid " + (seqResult||singleResult).primary.color,
                  borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em" }}>PRIMARY ZONE</div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: (seqResult||singleResult).primary.color, marginTop: 1 }}>
                        {(seqResult||singleResult).primary.name}
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 4, maxWidth: 360 }}>
                        {(seqResult||singleResult).primary.desc}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 32, fontWeight: 900, color: (seqResult||singleResult).primary.color }}>{(seqResult||singleResult).primary.pct}%</div>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>RPE {(seqResult||singleResult).primary.rpe}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Zone bar — relabelled when CS */}
              {(seqResult||singleResult).csDetection && (seqResult||singleResult).csDetection.isCS && (
                <div style={{ fontSize: 9, color: "rgba(48,176,199,0.5)", letterSpacing: "0.08em",
                  marginBottom: 4, marginTop: 4 }}>
                  PHYSIOLOGICAL CONTRIBUTION WITHIN THIS CS SET
                </div>
              )}
              <ZoneBar breakdown={(seqResult||singleResult).breakdown} />

              {/* Zone groups */}
              {ZONE_GROUPS.map(grp => {
                const groupZones = (seqResult||singleResult).breakdown.filter(z => grp.members.includes(z.id) && z.pct > 0);
                const groupPct = groupZones.reduce((s, z) => s + z.pct, 0);
                if (groupPct === 0) return null;
                return (
                  <div key={grp.zone} style={{ background: "rgba(255,255,255,0.02)",
                    border: `1px solid ${grp.color}25`, borderLeft: `3px solid ${grp.color}`,
                    borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: grp.color }}>{grp.label}</span>
                      <span style={{ fontSize: 14, fontWeight: 900, color: grp.color }}>{groupPct}%</span>
                    </div>
                    {groupZones.map(z => (
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

              {/* Rep-by-rep chart */}
              <div style={{ background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 14, marginBottom: 12, marginTop: 10 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", marginBottom: 8 }}>
                  REP-BY-REP ENERGY DRIFT
                </div>
                <RepChart repResults={(seqResult||singleResult).repResults} />
                <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
                  {[["ATP-CP","#FF2D55"],["Glycolytic","#FFCC00"],["Aerobic","#34C759"]].map(([l,c]) => (
                    <div key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 8, height: 8, background: c, borderRadius: 2 }} />
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>{l}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>)}

            {/* ══════════════════════════════════════════
                LAYER 3 — ADAPTATIONS
            ══════════════════════════════════════════ */}
            {resultView === "adaptations" && (<div>

              {/* CS objective card leads when this is a CS set */}
              {(seqResult||singleResult).csDetection && (seqResult||singleResult).csDetection.isCS && (
                <div style={{ background: "rgba(48,176,199,0.10)",
                  border: "1px solid rgba(48,176,199,0.4)",
                  borderLeft: "4px solid #30B0C7",
                  borderRadius: 10, padding: "12px 16px", marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: "rgba(48,176,199,0.6)", letterSpacing: "0.1em", marginBottom: 4 }}>
                    PRIMARY TRAINING OBJECTIVE
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: "#30B0C7", marginBottom: 8 }}>
                    CS — Critical Speed Training
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 8, color: "rgba(48,176,199,0.5)", letterSpacing: "0.1em", marginBottom: 4 }}>SPECIFIC ADAPTATIONS</div>
                      {["Raises Critical Speed threshold — pace sustainable indefinitely","Increased cardiac output at high sustained intensity","Improved lactate clearance at threshold pace","Mitochondrial development in intermediate fibres","Blood lactate steady state at progressively higher speeds"].map((s,i) => (
                        <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", marginBottom: 4,
                          paddingLeft: 8, borderLeft: "2px solid rgba(48,176,199,0.4)", lineHeight: 1.5 }}>{s}</div>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontSize: 8, color: "rgba(48,176,199,0.5)", letterSpacing: "0.1em", marginBottom: 4 }}>TRAINING BENEFITS</div>
                      {["Mental durability — 30 minutes of sustained hard work","Pacing discipline across many reps","Aerobic economy at race-relevant speeds","Foundation for all race distances 200m+"].map((s,i) => (
                        <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", marginBottom: 4,
                          paddingLeft: 8, borderLeft: "2px solid rgba(255,255,255,0.12)", lineHeight: 1.5 }}>{s}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.6,
                marginBottom: 14, padding: "8px 12px", background: "rgba(255,255,255,0.03)",
                borderRadius: 6, borderLeft: "3px solid rgba(255,255,255,0.1)" }}>
                {(seqResult||singleResult).csDetection && (seqResult||singleResult).csDetection.isCS
                  ? "Zone adaptations below are the physiological substrate of this CS set — they describe what is happening at the cellular level during the set, not the primary training objective."
                  : "Showing adaptations for zones contributing >5% of this set. Zones are ordered by contribution — highest first."
                }
              </div>

              {ZONE_GROUPS.map(grp => {
                const groupZones = (seqResult||singleResult).breakdown.filter(z => grp.members.includes(z.id) && z.pct >= 5);
                if (groupZones.length === 0) return null;
                const groupPct = (seqResult||singleResult).breakdown.filter(z => grp.members.includes(z.id)).reduce((s,z) => s+z.pct, 0);
                return (
                  <div key={grp.zone} style={{ marginBottom: 16 }}>
                    {/* Group header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                      borderBottom: `1px solid ${grp.color}40`, paddingBottom: 6, marginBottom: 10 }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 900, color: grp.color }}>{grp.label}</span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginLeft: 8 }}>{grp.system}</span>
                      </div>
                      <span style={{ fontSize: 16, fontWeight: 900, color: grp.color }}>{groupPct}%</span>
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginBottom: 8, fontStyle: "italic" }}>
                      {grp.muscle}
                    </div>

                    {groupZones.map(z => {
                      const adpt = grp.adaptations[z.id];
                      if (!adpt) return null;
                      return (
                        <div key={z.id} style={{ background: `${z.color}10`,
                          border: `1px solid ${z.color}25`, borderRadius: 8,
                          padding: "10px 14px", marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: z.color }}>{z.name}</span>
                            <span style={{ fontSize: 13, fontWeight: 900, color: z.color }}>{z.pct}%</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div>
                              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", marginBottom: 5 }}>SPECIFIC ADAPTATIONS</div>
                              {adpt.specific.map((s,i) => (
                                <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", marginBottom: 3,
                                  paddingLeft: 8, borderLeft: `2px solid ${z.color}60`, lineHeight: 1.5 }}>{s}</div>
                              ))}
                            </div>
                            <div>
                              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", marginBottom: 5 }}>GENERAL ADAPTATIONS</div>
                              {adpt.general.map((s,i) => (
                                <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", marginBottom: 3,
                                  paddingLeft: 8, borderLeft: "2px solid rgba(255,255,255,0.12)", lineHeight: 1.5 }}>{s}</div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* PHV note for this group */}
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.28)",
                      background: "rgba(255,255,255,0.03)", borderRadius: 4,
                      padding: "5px 8px", marginTop: 2 }}>
                      PHV: {grp.phvNote}
                    </div>
                  </div>
                );
              })}

              {/* Engine size principle */}
              <div style={{ background: "rgba(52,199,89,0.06)", border: "1px solid rgba(52,199,89,0.2)",
                borderLeft: "3px solid #34C759", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#34C759", letterSpacing: "0.1em", marginBottom: 4 }}>
                  THE ENGINE SIZE PRINCIPLE — SWEETENHAM
                </div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                  The aerobic base built during childhood and early adolescence has a disproportionate impact on adult performance.
                  Mitochondrial and cardiovascular adaptations accumulated before and through PHV appear to set a ceiling on adult
                  aerobic capacity that cannot be fully recovered if this window is missed. Time spent in A1–A2 as a young swimmer
                  is not easy mileage — it is the most important long-term investment in the athlete's development.
                </div>
              </div>
            </div>)}

            {/* Coaching note — shown on all layers */}
            {coachNote(seqResult||singleResult) && (
              <div style={{ background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)", borderLeft: "3px solid rgba(255,255,255,0.15)",
                borderRadius: 8, padding: "10px 14px", marginBottom: 14,
                fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.7 }}>
                <span style={{ color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em",
                  fontSize: 9, textTransform: "uppercase" }}>Coaching note · </span>
                {coachNote(seqResult||singleResult)}
              </div>
            )}

            {/* Print button */}
            <div style={{ textAlign: "center", marginTop: 8, marginBottom: 24 }}>
              <button onClick={() => {
                const now = new Date().toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
                const phvLabel   = { pre: "Pre-PHV", developing: "Early Post-PHV", post: "Post-PHV" };
                const strokeLabel = { FS:"Freestyle", BK:"Backstroke", BR:"Breaststroke", Fly:"Butterfly", IM:"IM" };
                const restLabel     = { stationary:"Stationary", a1:"Active A1", a2plus:"Active A2+" };
                const athleteLabel  = { sprint:"Sprint", allround:"All-Round", endurance:"Endurance" };
                const zoneRows = (seqResult||singleResult).breakdown.filter(z => z.pct > 0).map(z =>
                  `<tr><td style="padding:5px 8px"><span style="display:inline-block;width:10px;height:10px;background:${z.color};border-radius:50%;margin-right:6px"></span>${z.name}</td>
                   <td style="padding:5px 8px;text-align:center;font-weight:700;color:${z.color}">${z.pct}%</td>
                   <td style="padding:5px 8px;color:#555">RPE ${z.rpe}</td>
                   <td style="padding:5px 8px;font-size:11px;color:#666">${z.desc}</td></tr>`
                ).join("");
                const repRows = (seqResult||singleResult).repResults.map(r =>
                  `<tr><td style="text-align:center">${r.rep}</td>
                   <td style="text-align:center;color:#FF2D55">${(r.atpcp*100).toFixed(0)}%</td>
                   <td style="text-align:center;color:#cc8800">${(r.glycolytic*100).toFixed(0)}%</td>
                   <td style="text-align:center;color:#1a8a3c">${(r.aerobic*100).toFixed(0)}%</td>
                   <td style="text-align:center">${(r.atpcpStore*100).toFixed(0)}%</td></tr>`
                ).join("");
                const paceWarnHtml = (seqResult||singleResult).paceValidation?.warningLevel
                  ? `<div style="background:${(seqResult||singleResult).paceValidation.warningLevel==='impossible'?'#fde8ec':'#fff3cd'};border-left:4px solid ${(seqResult||singleResult).paceValidation.warningLevel==='impossible'?'#FF2D55':'#ff9500'};padding:10px 14px;margin-bottom:16px;font-size:12px;border-radius:4px">${(seqResult||singleResult).paceValidation.warningMsg}</div>` : "";
                const consistencyHtml = (seqResult||singleResult).consistencyWarning
                  ? `<div style="background:#fff3cd;border-left:4px solid #ff9500;padding:10px 14px;margin-bottom:16px;font-size:12px;border-radius:4px">
                      <strong>⚠ Consistency Warning:</strong> Target time ${fmtTime((seqResult||singleResult).workDur)} — rep ${(seqResult||singleResult).consistencyWarning.rep} estimated ~${fmtTime((seqResult||singleResult).consistencyWarning.estimatedTime)} (${(seqResult||singleResult).consistencyWarning.degradationPct.toFixed(1)}% slower).
                      Suggest increasing rest to ~${(seqResult||singleResult).consistencyWarning.suggestedRest}s${inputs.restType!=='a1'?' or switching to Active A1 recovery':''}, or adjust target to ~${fmtTime((seqResult||singleResult).consistencyWarning.suggestedTime)}.
                     </div>` : "";
                const phvWarnHtml = (seqResult||singleResult).phvWarning
                  ? `<div style="background:#fff3cd;border-left:4px solid #ff9500;padding:10px 14px;margin-bottom:16px;font-size:12px;border-radius:4px">${(seqResult||singleResult).phvWarning}</div>` : "";
                const coachHtml = coachNote(seqResult||singleResult)
                  ? `<div style="background:#f8f8f8;border-left:3px solid #ccc;padding:10px 14px;font-size:12px;border-radius:4px;margin-top:16px"><strong>Coaching note:</strong> ${coachNote(seqResult||singleResult)}</div>` : "";

                const html = `<!DOCTYPE html><html><head><title>Swim Zone Report</title>
                <style>
                  body{font-family:'Courier New',monospace;margin:32px;color:#111;font-size:13px}
                  h1{font-size:20px;margin:0 0 2px;font-family:Georgia,serif}
                  h2{font-size:13px;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid #ddd;padding-bottom:4px}
                  table{width:100%;border-collapse:collapse;margin-bottom:16px}
                  th{background:#111;color:#fff;padding:6px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;text-align:center}
                  .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
                  .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
                  .card{border:1px solid #ddd;border-radius:6px;padding:10px 12px}
                  .card-label{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#888;margin-bottom:4px}
                  .card-val{font-size:18px;font-weight:700}
                  .card-sub{font-size:9px;color:#888}
                  .primary{border-left:5px solid ${(seqResult||singleResult).primary.color};padding:12px 16px;margin-bottom:16px;background:#fafafa;border-radius:4px}
                  @media print{body{margin:20px}}
                </style></head><body>
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
                  <div><h1>SWIM ZONE CLASSIFIER REPORT</h1>
                    <div style="font-size:10px;color:#888;letter-spacing:.07em">Sweetenham model · Generated ${now}</div></div>
                  <div style="text-align:right;font-size:11px;color:#555">
                    <div>${strokeLabel[inputs.stroke]} · ${phvLabel[inputs.phvStatus]} · ${athleteLabel[inputs.athleteType]}</div>
                    <div>200m PB: ${inputs.pace200}</div></div>
                </div>
                <h2>Set Parameters</h2>
                <div class="grid4">
                  <div class="card"><div class="card-label">Distance</div><div class="card-val">${inputs.distM}m</div><div class="card-sub">per rep</div></div>
                  <div class="card"><div class="card-label">Repetitions</div><div class="card-val">${inputs.qty}</div><div class="card-sub">reps</div></div>
                  <div class="card"><div class="card-label">Target Time</div><div class="card-val">${inputs.targetTime}</div><div class="card-sub">per rep</div></div>
                  <div class="card"><div class="card-label">Rest</div><div class="card-val">${inputs.restSec}s</div><div class="card-sub">${restLabel[inputs.restType]}</div></div>
                </div>
                ${paceWarnHtml}${consistencyHtml}
                <h2>Energy System Analysis</h2>
                <div class="grid3">
                  <div class="card"><div class="card-label">ATP-CP (avg)</div><div class="card-val" style="color:#FF2D55">${((seqResult||singleResult).avgAtpcp*100).toFixed(0)}%</div><div class="card-sub">${(seqResult||singleResult).restoreCheck.atpcpRestored?"replenishes between reps":"depletes from rep 2"}</div></div>
                  <div class="card"><div class="card-label">Glycolytic (avg)</div><div class="card-val" style="color:#cc8800">${((seqResult||singleResult).avgGlycolytic*100).toFixed(0)}%</div><div class="card-sub">lactic system</div></div>
                  <div class="card"><div class="card-label">Aerobic (avg)</div><div class="card-val" style="color:#1a8a3c">${((seqResult||singleResult).avgAerobic*100).toFixed(0)}%</div><div class="card-sub">aerobic system</div></div>
                </div>
                ${phvWarnHtml}
                <h2>Primary Zone</h2>
                <div class="primary">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <div><div style="font-size:18px;font-weight:900;color:${(seqResult||singleResult).primary.color}">${(seqResult||singleResult).primary.name}</div>
                      <div style="font-size:11px;color:#555;margin-top:4px">${(seqResult||singleResult).primary.desc}</div></div>
                    <div style="font-size:32px;font-weight:900;color:${(seqResult||singleResult).primary.color}">${(seqResult||singleResult).primary.pct}%</div>
                  </div>
                </div>
                <h2>Full Zone Breakdown</h2>
                <table><thead><tr><th style="text-align:left">Zone</th><th>%</th><th>RPE</th><th style="text-align:left">Description</th></tr></thead>
                <tbody>${zoneRows}</tbody></table>
                <h2>Rep-by-Rep Energy Drift</h2>
                <table><thead><tr><th>Rep</th><th>ATP-CP</th><th>Glycolytic</th><th>Aerobic</th><th>ATP-CP Store</th></tr></thead>
                <tbody>${repRows}</tbody></table>
                ${coachHtml}
                <div style="margin-top:24px;font-size:9px;color:#bbb;border-top:1px solid #eee;padding-top:8px">
                  Swim Zone Classifier · Sweetenham model · ${now} · Speed ${((seqResult||singleResult).speedRatio*100).toFixed(0)}% of 200m pace · Rest:Work ${(seqResult||singleResult).restWorkRatio.toFixed(1)}:1 · Rest: ${restLabel[inputs.restType]} · Athlete: ${athleteLabel[inputs.athleteType]} · Volume: ${(seqResult||singleResult).totalVolume}m
                </div></body></html>`;

                const win = window.open("", "_blank");
                win.document.write(html);
                win.document.close();
                win.focus();
                setTimeout(() => win.print(), 400);
              }} style={{
                background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 8, color: "#fff", padding: "10px 28px",
                fontFamily: "monospace", fontSize: 12, cursor: "pointer", letterSpacing: "0.1em",
              }}>
                ⎙ PRINT REPORT
              </button>
            </div>

          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "36px 0",
            color: "rgba(255,255,255,0.18)", fontSize: 11, letterSpacing: "0.1em" }}>
            ENTER SET PARAMETERS TO CLASSIFY
          </div>
        )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }
        input:focus, select:focus { border-color: rgba(255,255,255,0.3) !important; }
        option { background: #1a1a28; }
        @media print {
          body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
