// src/pages/AthleteSetup.jsx
// Athlete setup page — UI and local state only.
// All parse / build / export / import logic lives in services/athleteService.js.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { secToDisplay } from '../zones/helpers.js';
import { ATHLETE_TYPE_OPTS } from '../zones/constants.js';
import { deriveAthleteType, parseTimeToSec } from '../athlete/parse.js';
import {
  parseSwimmingResultsText,
  buildAthleteObject,
  exportAthleteJson,
  importAthleteJson,
} from '../services/athleteService.js';
import { storage, KEYS } from '../lib/storage.js';

export default function AthleteSetup() {
  const navigate = useNavigate();

  const [rawPaste,       setRawPaste]       = useState('');
  const [athleteName,    setAthleteName]    = useState('');
  const [seNumber,       setSeNumber]       = useState('');
  const [clubName,       setClubName]       = useState('');
  const [athleteType,    setAthleteType]    = useState('allround');
  const [phvStatus,      setPhvStatus]      = useState('post');
  const [athleteTimes,   setAthleteTimes]   = useState({});
  const [parseLog,       setParseLog]       = useState([]);
  const [derivedProfile, setDerivedProfile] = useState(null);

  // ── Load from localStorage on mount ─────────────────────────────────────
  useEffect(() => {
    const mData = storage.get(KEYS.ATHLETE);
    if (!mData) return;
    const mTimes = mData.times || {};
    setAthleteName(mData.name        || '');
    setSeNumber(mData.seNumber       || '');
    setClubName(mData.club           || '');
    setAthleteType(mData.athleteType || 'allround');
    setPhvStatus(mData.phvStatus     || 'post');
    setAthleteTimes(mTimes);
    setDerivedProfile(mData.derivedProfile || deriveAthleteType(mTimes) || null);
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleParse() {
    const mResult = parseSwimmingResultsText(rawPaste);
    setAthleteTimes(mResult.times);
    setParseLog(mResult.log);
    setDerivedProfile(deriveAthleteType(mResult.times));
    if (mResult.name)     setAthleteName(mResult.name);
    if (mResult.seNumber) setSeNumber(mResult.seNumber);
    if (mResult.club)     setClubName(mResult.club);
  }

  function handleSave() {
    const mAthlete = buildAthleteObject({
      name: athleteName, seNumber, club: clubName,
      times: athleteTimes, athleteType, phvStatus, derivedProfile,
    });
    setDerivedProfile(mAthlete.derivedProfile);
    storage.set(KEYS.ATHLETE, mAthlete);
    alert('Athlete saved!');
  }

  function handleExportJson() {
    const mJson = exportAthleteJson({
      name: athleteName, seNumber, club: clubName,
      times: athleteTimes, derivedProfile, athleteType, phvStatus,
    });
    const mEl = document.getElementById('athlete-json-area');
    if (mEl) { mEl.value = mJson; mEl.select(); }
  }

  function handleImportJson() {
    const mEl = document.getElementById('athlete-json-area');
    if (!mEl?.value?.trim()) return;
    try {
      const mFields = importAthleteJson(mEl.value);
      setAthleteName(mFields.name);
      setSeNumber(mFields.seNumber);
      setClubName(mFields.club);
      setAthleteTimes(mFields.times);
      setDerivedProfile(mFields.derivedProfile);
      setAthleteType(mFields.athleteType);
      setPhvStatus(mFields.phvStatus);
      mEl.value = '';
    } catch (e) {
      alert(e.message);
    }
  }

  // ── Manual time-grid cell ────────────────────────────────────────────────
  function makeTimeCell(pKey, pDist, pCode, pStrokeName) {
    return (
      <input
        key={pKey}
        placeholder="—"
        value={athleteTimes[pKey] ? athleteTimes[pKey].display : ''}
        onChange={e => {
          const mVal = e.target.value.trim();
          if (!mVal) {
            setAthleteTimes(p => { const n = { ...p }; delete n[pKey]; return n; });
          } else {
            const mSec = parseTimeToSec(mVal);
            if (mSec) {
              setAthleteTimes(p => ({
                ...p,
                [pKey]: {
                  sec: mSec, lcEq: mSec, display: mVal, pool: 'LC',
                  dist: pDist, code: pCode, stroke: pStrokeName,
                  date: '', monthsOld: 0, stale: false,
                },
              }));
            }
          }
        }}
        style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 4, color: '#fff', padding: '3px 4px', fontFamily: 'monospace',
          fontSize: 11, outline: 'none', textAlign: 'center', width: '100%', boxSizing: 'border-box',
        }}
      />
    );
  }

  const mStrokeDefs = [
    { code: 'FS',  name: 'Freestyle'         },
    { code: 'BK',  name: 'Backstroke'        },
    { code: 'BR',  name: 'Breaststroke'      },
    { code: 'Fly', name: 'Butterfly'         },
    { code: 'IM',  name: 'Individual Medley' },
  ];
  const mDistDefs = [50, 100, 200, 400, 800, 1500];

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#1a1a2e', color: '#fff', fontFamily: 'monospace', padding: '16px 12px' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.15em', marginBottom: 2 }}>ELLESMERE PORT ASC</div>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.04em' }}>ATHLETE SETUP</div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 2, letterSpacing: '0.08em' }}>SWEETENHAM ENERGY ZONE MODEL · v5</div>
        </div>

        <button onClick={() => navigate('/classifier')} style={{ padding: '6px 10px', fontSize: 11, borderRadius: 5, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(48,176,199,0.12)', color: '#fff', cursor: 'pointer', marginBottom: 16 }}>
          Back to Classifier
        </button>

        {/* Identity */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' }}>Athlete details</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'Name',      value: athleteName, setter: setAthleteName, placeholder: 'Athlete name', flex: 2 },
              { label: 'SE Number', value: seNumber,    setter: setSeNumber,    placeholder: '1234567',      flex: 1 },
              { label: 'Club',      value: clubName,    setter: setClubName,    placeholder: 'Club name',    flex: 2 },
            ].map(f => (
              <div key={f.label} style={{ flex: f.flex, minWidth: 90 }}>
                <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2, display: 'block' }}>{f.label}</label>
                <input value={f.value} onChange={e => f.setter(e.target.value)} placeholder={f.placeholder}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#fff', padding: '8px 11px', width: '100%', fontFamily: 'monospace', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            ))}
          </div>
        </div>

        {/* Athlete type */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' }}>
            Athlete type <span style={{ opacity: 0.4, fontWeight: 400 }}>— affects lactate clearance rate</span>
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            {ATHLETE_TYPE_OPTS.map(opt => (
              <button key={opt.v} onClick={() => setAthleteType(opt.v)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace',
                  border: '1px solid ' + (athleteType === opt.v ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.08)'),
                  background: athleteType === opt.v ? 'rgba(255,255,255,0.10)' : 'transparent',
                  color: athleteType === opt.v ? '#fff' : 'rgba(255,255,255,0.3)' }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{opt.l}</div>
                <div style={{ fontSize: 9, marginTop: 2, opacity: 0.6 }}>{opt.sub}</div>
              </button>
            ))}
          </div>
          {derivedProfile?.type && (
            <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(52,199,89,0.7)' }}>
              Auto-detected: {derivedProfile.label} ({derivedProfile.aiPct}% drop/doubling) — override above if needed
            </div>
          )}
        </div>

        {/* PHV status */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' }}>Athlete maturation (PHV status)</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { v: 'pre',        l: 'Pre-PHV',        sub: 'Lactate system undeveloped' },
              { v: 'developing', l: 'Early Post-PHV', sub: 'Lactate system maturing'    },
              { v: 'post',       l: 'Post-PHV',       sub: 'Full glycolytic capacity'   },
            ].map(opt => (
              <button key={opt.v} onClick={() => setPhvStatus(opt.v)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 7, cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace',
                  border: '1px solid ' + (phvStatus === opt.v ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.08)'),
                  background: phvStatus === opt.v ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: phvStatus === opt.v ? '#fff' : 'rgba(255,255,255,0.3)' }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{opt.l}</div>
                <div style={{ fontSize: 9, marginTop: 2, opacity: 0.6 }}>{opt.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Derived profile card */}
        {derivedProfile && (
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', marginBottom: 8 }}>AUTO-DETECTED ATHLETE PROFILE</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{derivedProfile.label}</span>
              {derivedProfile.mult && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>clearance x{derivedProfile.mult.toFixed(2)}</span>}
              {derivedProfile.confidence && derivedProfile.confidence !== 'none' && (
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4,
                  background: derivedProfile.confidence === 'high' ? 'rgba(52,199,89,0.15)' : 'rgba(255,204,0,0.15)',
                  border: '1px solid ' + (derivedProfile.confidence === 'high' ? 'rgba(52,199,89,0.4)' : 'rgba(255,204,0,0.4)'),
                  color: derivedProfile.confidence === 'high' ? '#34C759' : '#FFCC00' }}>
                  {derivedProfile.confidence} confidence
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 2 }}>{derivedProfile.reasoning}</div>
            {derivedProfile.aiPct && <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Drop-off: {derivedProfile.aiPct}% per doubling · &lt;3% Endurance · 3–6% All-Round · &gt;6% Sprint</div>}
            {derivedProfile.staleUsed && <div style={{ marginTop: 4, fontSize: 10, color: 'rgba(255,149,0,0.7)', background: 'rgba(255,149,0,0.06)', borderRadius: 4, padding: '4px 8px' }}>⚠ Some times used in this profile are over 13 months old. Profile may not reflect current fitness.</div>}
            {derivedProfile.css && <div style={{ marginTop: 4, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>CSS: {secToDisplay(derivedProfile.css)}/100m (from {derivedProfile.cssMethod})</div>}
          </div>
        )}

        {/* Manual time grid */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' }}>Manual time entry</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 4, marginBottom: 8 }}>
            <div />
            {mStrokeDefs.map(s => (
              <div key={s.code} style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textAlign: 'center', fontFamily: 'monospace', letterSpacing: '0.06em', paddingBottom: 3, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{s.code}</div>
            ))}
            {mDistDefs.map(mDist => [
              <div key={'lbl-' + mDist} style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{mDist}m</div>,
              ...mStrokeDefs.map(mS => makeTimeCell(mDist + '_' + mS.code, mDist, mS.code, mS.name)),
            ])}
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginBottom: 8 }}>Enter times as m:ss or ss.cc</div>
          {Object.keys(athleteTimes).length > 0 && (
            <button onClick={handleSave} style={{ padding: '6px 16px', background: 'rgba(52,199,89,0.12)', border: '1px solid rgba(52,199,89,0.4)', borderRadius: 5, color: '#34C759', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>
              SAVE ATHLETE
            </button>
          )}
        </div>

        {/* Parsed times table */}
        {Object.keys(athleteTimes).length > 0 && (
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', marginBottom: 8 }}>IMPORTED TIMES — {Object.keys(athleteTimes).length} events</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {['Event','Time','Pool','LC equiv'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Event' ? 'left' : 'right', padding: '4px 0', fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.values(athleteTimes)
                  .sort((a, b) => a.code.localeCompare(b.code) || a.dist - b.dist)
                  .map(t => (
                    <tr key={t.dist + '_' + t.code} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '5px 0', color: '#fff' }}>{t.dist}m {t.stroke}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: t.stale ? 'rgba(255,255,255,0.35)' : '#fff', fontWeight: 700 }}>
                        {t.display}{t.stale && <span style={{ marginLeft: 5, fontSize: 9, color: '#FF9500' }}>stale</span>}
                      </td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: t.pool === 'LC' ? 'rgba(48,176,199,0.8)' : 'rgba(255,204,0,0.8)' }}>{t.pool}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{t.pool === 'SC' ? secToDisplay(t.lcEq) : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Parse log */}
        {parseLog.length > 0 && (
          <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 6 }}>PARSE LOG</div>
            {parseLog.map((l, i) => <div key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>{l}</div>)}
          </div>
        )}

        {/* SwimmingResults.org paste */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' }}>Import times from SwimmingResults.org</label>
          <textarea value={rawPaste} onChange={e => setRawPaste(e.target.value)}
            placeholder="Paste the full page text from a SwimmingResults.org individual times page…"
            rows={5} style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: 'rgba(255,255,255,0.7)', padding: '10px', fontFamily: 'monospace', fontSize: 11, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
          <button onClick={handleParse} style={{ marginTop: 8, padding: '8px 18px', background: 'rgba(48,176,199,0.12)', border: '1px solid rgba(48,176,199,0.4)', borderRadius: 6, color: '#30B0C7', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>
            PARSE & IMPORT TIMES
          </button>
        </div>

        {/* Athlete JSON export / import */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' }}>Save / Load Athlete Profile</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={handleExportJson} style={{ padding: '5px 14px', background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.25)', borderRadius: 5, color: 'rgba(52,199,89,0.7)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>EXPORT JSON</button>
            <button onClick={handleImportJson} style={{ padding: '5px 14px', background: 'rgba(48,176,199,0.08)', border: '1px solid rgba(48,176,199,0.25)', borderRadius: 5, color: 'rgba(48,176,199,0.6)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>IMPORT JSON</button>
          </div>
          <textarea id="athlete-json-area" rows={4}
            placeholder="JSON appears here after export · paste here to import"
            onClick={e => e.target.select()}
            style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', fontSize: 9, padding: 8, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
        </div>

        {/* No profile warning */}
        {Object.keys(athleteTimes).length > 0 && !derivedProfile && (
          <div style={{ background: 'rgba(255,204,0,0.08)', border: '1px solid rgba(255,204,0,0.2)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,204,0,0.8)' }}>No 200m + 400m freestyle times found — athlete type cannot be auto-detected.</div>
          </div>
        )}

      </div>
    </div>
  );
}
