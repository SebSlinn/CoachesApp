// screens/classifier/SuggestionPanel.jsx
// For the zone the coach picked: clickable IN and ON times, the HR target, and (A1–A3) a drill picker.
import { parseTime, suggestTimes, hrTargetRange, STROKE_MULT, TYPES } from '../../zones/index.js';
import { DRILL_LIBRARY } from '../../drills/index.js';
import { useZoneScheme } from '../../context/ZoneSchemeContext.jsx';
import { T, FONT } from '../../styles/theme.js';
import { ui } from '../../styles/ui.js';
import { withAlpha } from '../../zones/schemes.js';

const AEROBIC = ['A1', 'A2', 'A3'];

/** 75 → "1:15", 45 → "45". */
function fmtOpt(pSec) {
  const m = Math.floor(pSec / 60);
  const s = Math.round(pSec % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : String(s);
}

/** suggestTimes() for one zone, or null without stroke/dist/200 pace. */
function buildSuggestion(pZone, pInputs, pAthlete) {
  if (!pZone || !pInputs.distM || !pInputs.stroke || !pInputs.pace200) return null;
  try {
    const mP200 = parseTime(pInputs.pace200);
    if (!mP200) return null;
    const mCtx = { athleteType: pInputs.athleteType || pAthlete?.athleteType || null, times: pAthlete?.times || {} };
    return suggestTimes(pZone, pInputs.distM, pInputs.stroke, mP200, pAthlete?.derivedProfile?.css, parseTime(pInputs.goal200) || null, mCtx);
  } catch { return null; }
}

/** IN options: CSS ±2 s for CS, otherwise up to five steps across the suggested range. */
function inOptions(pZone, pSg, pCss, pDist) {
  if (pZone === 'CS' && pCss) {
    const mT = Math.round(pCss * pDist / 100);
    return [-2, -1, 0, 1, 2].map(d => mT + d);
  }
  const mOut = [];
  const mStep = Math.max(1, Math.round((pSg.inHigh - pSg.inLow) / 4));
  for (let s = pSg.inLow; s <= pSg.inHigh + 0.5 && mOut.length < 5; s += mStep) mOut.push(Math.round(s));
  return mOut;
}

/** ON options, ascending (least rest first). */
function onOptions(pZone, pSg, pCss, pDist, pTargetTime) {
  const mRaw = [];
  if (pZone === 'CS' && pCss) {
    const mIn = parseTime(pTargetTime) || Math.round(pCss * pDist / 100);
    [2.0, 1.8, 1.7, 1.6, 1.5].forEach(r => mRaw.push(Math.round((mIn + mIn / r) / 5) * 5));
  } else if (pSg.onOptions) {
    mRaw.push(...pSg.onOptions);              // the type fixes its send-offs (LT: 3:00–5:00)
  } else {
    const mStep = Math.max(5, Math.round((pSg.onHigh - pSg.onLow) / 4 / 5) * 5);
    for (let s = pSg.onLow; s <= pSg.onHigh + 2 && mRaw.length < 5; s += mStep) mRaw.push(Math.round(s / 5) * 5);
  }
  return [...new Set(mRaw)].sort((a, b) => a - b);
}

function TimeRow({ label, color, options, current, onPick, bold }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
      <span style={{ fontSize: 9, color: bold ? color : T.text3, fontWeight: 700, letterSpacing: '0.08em', width: 24 }}>{label}</span>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {options.map(sec => {
          const mStr = fmtOpt(sec);
          return (
            <button key={sec} onClick={() => onPick(mStr)}
              style={{ ...ui.zoneButton(color, current === mStr), padding: '4px 10px', borderRadius: 4, fontSize: 12 }}>
              {mStr}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DrillPicker({ zone, inputs, set, color, classifierDrill, setClassifierDrill }) {
  const mStroke = inputs.stroke;
  const mDrills = [];
  (DRILL_LIBRARY[mStroke] || []).forEach(d => {
    if (d.type !== 'drill' && d.type !== 'focus') return;
    if (!d.zoneCeiling || AEROBIC.indexOf(zone) <= AEROBIC.indexOf(d.zoneCeiling)) mDrills.push(d);
  });
  (DRILL_LIBRARY.MULTI || []).forEach(d => mDrills.push(d));
  if (!mDrills.length) return null;
  const mSel = mDrills.find(d => d.name === classifierDrill);

  function pick(pName) {
    setClassifierDrill(pName);
    const mChosen = mDrills.find(d => d.name === pName);
    const mP200 = parseTime(inputs.pace200);
    if (!mChosen?.paceFactor || !mP200) return;
    // Drill pace = this zone's pace × the drill's pace factor.
    const mBase100 = (mP200 * (STROKE_MULT[mStroke] || 1)) / 2;
    const mSec = mBase100 * ((parseFloat(inputs.distM) || 100) / 100) * mChosen.paceFactor * (TYPES[zone]?.speedRatio || 1.30);
    let m = Math.floor(mSec / 60), s = Math.round(mSec % 60);
    if (s === 60) { m++; s = 0; }
    set('targetTime', m > 0 ? m + ':' + String(s).padStart(2, '0') : String(s));
  }

  return (
    <div style={{ marginTop: 6, padding: '6px 8px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 5 }}>
      <div style={{ ...ui.caption, fontSize: 8, marginBottom: 4 }}>Drills / focus — {mStroke}</div>
      <select value={classifierDrill} onChange={e => pick(e.target.value)}
        style={{ ...ui.input, width: '100%', padding: '4px 6px', fontSize: 10, cursor: 'pointer', border: `1px solid ${withAlpha(color, 0.3)}` }}>
        <option value=''>— select drill —</option>
        {mDrills.map(d => <option key={d.name} value={d.name}>{d.name}{d.zoneCeiling ? ' [≤' + d.zoneCeiling + ']' : ''}</option>)}
      </select>
      {mSel?.objective && mSel.objective !== 'detail_pending' && (
        <div style={{ marginTop: 4, fontSize: 9, color: T.text3, fontStyle: 'italic', lineHeight: 1.4 }}>{mSel.objective}</div>
      )}
      {mSel?.coachingNotes && mSel.coachingNotes !== 'detail_pending' && (
        <div style={{ marginTop: 2, fontSize: 9, color: T.text4, lineHeight: 1.4 }}>Coach: {mSel.coachingNotes}</div>
      )}
    </div>
  );
}

export default function SuggestionPanel({ inputs, set, selectedZone, activeAthlete, classifierDrill, setClassifierDrill }) {
  const { color: zoneColor } = useZoneScheme();
  const mSg = buildSuggestion(selectedZone, inputs, activeAthlete);

  if (!mSg) {
    return (
      <div style={{ ...ui.card, padding: 10, marginBottom: 10, fontSize: 11, color: T.text3 }}>
        Pick a zone and valid stroke/dist/pace to see suggestion details.
      </div>
    );
  }

  const mZc   = zoneColor(selectedZone);
  const mCss  = activeAthlete?.derivedProfile?.css;
  const mDist = parseFloat(inputs.distM) || 100;
  const mIn   = inOptions(selectedZone, mSg, mCss, mDist);
  const mOn   = onOptions(selectedZone, mSg, mCss, mDist, inputs.targetTime);
  const mStraightOn = selectedZone === 'A1' || (mOn.length > 0 && mOn[0] === mOn[mOn.length - 1] && mOn[0] <= mSg.inHigh + 2);
  const mHr = hrTargetRange(selectedZone, activeAthlete?.maxHr);

  return (
    <div style={{ ...ui.card, padding: 10, marginBottom: 10 }}>
      <div style={{ ...ui.accentCard(mZc, 'faint'), padding: '8px 10px' }}>
        <TimeRow label="IN" color={mZc} options={mIn} current={inputs.targetTime} onPick={v => set('targetTime', v)} bold />
        {mStraightOn ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: T.text3, fontWeight: 700, letterSpacing: '0.08em', width: 24 }}>ON</span>
            <span style={{ fontSize: 10, color: T.text3, fontStyle: 'italic' }}>
              {selectedZone === 'A1' ? 'straight-on (continuous)' : 'straight-on or short rest'}
            </span>
          </div>
        ) : (
          <TimeRow label="ON" color={mZc} options={mOn} current={inputs.onTime} onPick={v => set('onTime', v)} />
        )}
        {mHr && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <span style={{ fontSize: 9, color: T.text3, fontWeight: 700, letterSpacing: '0.08em', width: 24 }}>HR</span>
            <span style={{ fontSize: 11, color: mZc, fontWeight: 700, fontFamily: FONT.mono }}>
              {mHr.lo == null ? 'below ' + mHr.hi : mHr.lo + '–' + mHr.hi} bpm
            </span>
            <span style={{ fontSize: 9, color: T.text4 }}>
              max {activeAthlete.maxHr}{activeAthlete.maxHrEstimated ? ' (est. 220 − age)' : ''}
            </span>
          </div>
        )}
      </div>
      {AEROBIC.includes(selectedZone) && (
        <DrillPicker zone={selectedZone} inputs={inputs} set={set} color={mZc}
          classifierDrill={classifierDrill} setClassifierDrill={setClassifierDrill} />
      )}
    </div>
  );
}
