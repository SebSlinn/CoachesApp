// src/components/SuggestPanel.jsx
// Reverse-classifier panel: given a selected zone, shows clickable IN/ON time
// suggestions and an optional drill selector.
//
// Replaces the IIFE block at lines 162–317 of ClassifierScreenRefactor.jsx.
// Converting from IIFE-in-JSX to a proper component eliminates the class of
// rendering bugs caused by logic running inside JSX children.
//
// Props:
//   selectedZone       string | null   — active zone id e.g. 'AT', 'A2'
//   selectedSuggestion object | null   — suggestTimes() result for selectedZone
//   inputs             object          — { distM, stroke, pace200, targetTime, onTime }
//   set                fn(key, value)  — updates a single input field
//   activeAthlete      object | null   — athlete with derivedProfile.css
//   classifierDrill    string          — currently selected drill name
//   setClassifierDrill fn(name)        — updates selected drill
//   zoneColors         object          — { HVO:'#FF2D55', … }

import { DRILL_LIBRARY } from '../drills/index.js';
import { parseTime      } from '../zones/index.js';

const STROKE_MULT = { FS: 1.0, BK: 1.045, BR: 1.254, Fly: 1.051, IM: 1.082 };
const ZONE_SPEED_RATIO = { A1: 1.52, A2: 1.30, A3: 1.16 };
const AEROBIC_ZONES = ['A1', 'A2', 'A3'];

// Format seconds → "m:ss" or "ss"
function fmtSec(pSec) {
  const m = Math.floor(pSec / 60);
  const s = Math.round(pSec % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : String(s);
}

export default function SuggestPanel({
  selectedZone,
  selectedSuggestion,
  inputs,
  set,
  activeAthlete,
  classifierDrill,
  setClassifierDrill,
  zoneColors,
}) {
  // ── Empty state ────────────────────────────────────────────────────────────
  if (!selectedSuggestion) {
    return (
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
          Pick a zone and valid stroke / dist / pace to see suggestion details.
        </div>
      </div>
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const mIsCS    = selectedZone === 'CS';
  const mSg      = selectedSuggestion;
  const mCssPace = activeAthlete?.derivedProfile?.css || null;
  const mDist    = parseFloat(inputs.distM) || 100;
  const mZc      = zoneColors[selectedZone] || '#fff';

  // IN time options
  const mInOpts = [];
  if (mIsCS && mCssPace) {
    const mCssTime = Math.round(mCssPace * mDist / 100);
    for (let di = -2; di <= 2; di++) mInOpts.push(mCssTime + di);
  } else {
    const mStep = Math.max(1, Math.round((mSg.inHigh - mSg.inLow) / 4));
    for (let i = mSg.inLow; i <= mSg.inHigh + 0.5; i += mStep) {
      mInOpts.push(Math.round(i));
      if (mInOpts.length >= 5) break;
    }
  }

  // ON time options
  const mOnOptsRaw = [];
  if (mIsCS && mCssPace) {
    const mCssTime2 = Math.round(mCssPace * mDist / 100);
    const mInForOn  = parseTime(inputs.targetTime) || mCssTime2;
    [2.0, 1.8, 1.7, 1.6, 1.5].forEach(r =>
      mOnOptsRaw.push(Math.round((mInForOn + mInForOn / r) / 5) * 5)
    );
  } else {
    const mOnStep = Math.max(5, Math.round((mSg.onHigh - mSg.onLow) / 4 / 5) * 5);
    for (let j = mSg.onLow; j <= mSg.onHigh + 2; j += mOnStep) {
      mOnOptsRaw.push(Math.round(j / 5) * 5);
      if (mOnOptsRaw.length >= 5) break;
    }
  }
  const mOnOpts = [...new Set(mOnOptsRaw)].sort((a, b) => a - b);

  // Show "straight-on" label instead of ON buttons for A1 or degenerate range
  const mShowNoOn = selectedZone === 'A1' ||
    (mOnOpts.length > 0 && mOnOpts[0] === mOnOpts[mOnOpts.length - 1] && mOnOpts[0] <= (mSg.inHigh + 2));

  // ── Drill list (aerobic zones only) ───────────────────────────────────────
  let mDrills    = [];
  let mSelDrill  = null;
  if (AEROBIC_ZONES.includes(selectedZone)) {
    const mStroke = inputs.stroke;
    const mZoOrder = ['A1', 'A2', 'A3'];

    if (DRILL_LIBRARY[mStroke]) {
      DRILL_LIBRARY[mStroke].forEach(d => {
        if (d.type !== 'drill' && d.type !== 'focus') return;
        const mCeilOk = !d.zoneCeiling ||
          mZoOrder.indexOf(selectedZone) <= mZoOrder.indexOf(d.zoneCeiling);
        if (mCeilOk) mDrills.push(d);
      });
    }
    if (DRILL_LIBRARY.MULTI) {
      DRILL_LIBRARY.MULTI.forEach(d => mDrills.push(d));
    }
    mSelDrill = mDrills.find(d => d.name === classifierDrill) || null;
  }

  // Handler: drill selected → auto-calculate target time
  function handleDrillChange(pName) {
    setClassifierDrill(pName);
    if (!pName) return;
    const mChosen = mDrills.find(d => d.name === pName);
    if (!mChosen?.paceFactor) return;
    const mP200 = parseTime(inputs.pace200);
    if (!mP200) return;
    const mSr   = ZONE_SPEED_RATIO[selectedZone] || 1.30;
    const mBase = (mP200 * (STROKE_MULT[inputs.stroke] || 1.0)) / 2;
    const mRaw  = mBase * (mDist / 100) * mChosen.paceFactor * mSr;
    let mM = Math.floor(mRaw / 60);
    let mS = Math.round(mRaw % 60);
    if (mS === 60) { mM++; mS = 0; }
    set('targetTime', mM > 0 ? mM + ':' + (mS < 10 ? '0' : '') + mS : String(mS));
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const mDrillZc = { A3: '#34C759', A2: '#30B0C7', A1: '#007AFF' }[selectedZone] || '#8E8E93';

  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 10, marginBottom: 10 }}>

      {/* IN / ON time buttons */}
      <div style={{ background: mZc + '0A', border: '1px solid ' + mZc + '20', borderRadius: 6, padding: '8px 10px', marginBottom: mDrills.length > 0 ? 10 : 0 }}>

        {/* IN row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 9, color: mZc, fontWeight: 700, letterSpacing: '0.08em', width: 24 }}>IN</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {mInOpts.map(sec => {
              const mStr    = fmtSec(sec);
              const mActive = inputs.targetTime === mStr;
              return (
                <button key={sec} onClick={() => set('targetTime', mStr)}
                  style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
                    border: '1px solid ' + (mActive ? mZc : mZc + '55'),
                    background: mActive ? mZc + '30' : mZc + '10',
                    color: mActive ? mZc : mZc + 'bb' }}>
                  {mStr}
                </button>
              );
            })}
          </div>
        </div>

        {/* ON row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: mZc + '99', fontWeight: 700, letterSpacing: '0.08em', width: 24 }}>ON</span>
          {mShowNoOn ? (
            <span style={{ fontSize: 10, color: mZc + '77', fontStyle: 'italic' }}>
              {selectedZone === 'A1' ? 'straight-on (continuous)' : 'straight-on or short rest'}
            </span>
          ) : (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {mOnOpts.map(sec => {
                const mStr    = fmtSec(sec);
                const mActive = inputs.onTime === mStr;
                return (
                  <button key={sec} onClick={() => set('onTime', mStr)}
                    style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
                      border: '1px solid ' + (mActive ? mZc : mZc + '33'),
                      background: mActive ? mZc + '20' : 'transparent',
                      color: mActive ? mZc : mZc + '77' }}>
                    {mStr}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Drill selector — aerobic zones only */}
      {mDrills.length > 0 && (
        <div style={{ padding: '6px 8px', background: mDrillZc + '08', border: '1px solid ' + mDrillZc + '20', borderRadius: 5 }}>
          <div style={{ fontSize: 8, color: mDrillZc + '99', letterSpacing: '0.08em', marginBottom: 4 }}>
            DRILLS / FOCUS — {inputs.stroke}
          </div>
          <select value={classifierDrill} onChange={e => handleDrillChange(e.target.value)}
            style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid ' + mDrillZc + '30', borderRadius: 4, color: '#fff', padding: '4px 6px', fontFamily: 'monospace', fontSize: 10, outline: 'none', cursor: 'pointer' }}>
            <option value=''>— select drill —</option>
            {mDrills.map(d => (
              <option key={d.name} value={d.name}>
                {d.name}{d.zoneCeiling ? ' [≤' + d.zoneCeiling + ']' : ''}
              </option>
            ))}
          </select>
          {mSelDrill?.objective && mSelDrill.objective !== 'detail_pending' && (
            <div style={{ marginTop: 4, fontSize: 9, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', lineHeight: 1.4 }}>
              {mSelDrill.objective}
            </div>
          )}
          {mSelDrill?.coachingNotes && mSelDrill.coachingNotes !== '' && mSelDrill.coachingNotes !== 'detail_pending' && (
            <div style={{ marginTop: 2, fontSize: 9, color: 'rgba(255,255,255,0.25)', lineHeight: 1.4 }}>
              Coach: {mSelDrill.coachingNotes}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
