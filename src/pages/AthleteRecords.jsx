// src/pages/AthleteRecords.jsx
// An athlete's training log / records view. Read-only for now.
//   • Bests, with a window filter (1 / 6 / 12 months / all-time) — the same
//     filter that will feed zone classification. Official (meet) vs non-official
//     (time trial) are tagged but rank on time alone.
//   • Progression per event — every kept swim, oldest→newest (improvement AND
//     regression), never overwritten.
//   • Set / test history — sets swum (test sets land here once tagged).
// Reached from Athlete Setup ("View records / log") with { athleteId, name } in
// router state. Data via services/results.js; DB enforces who may read.

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { secToDisplay } from '../zones/helpers.js';
import { getAthleteBests, getResultHistory, getSetResults } from '../services/results.js';

const STROKE_NAME = { FS: 'Free', BK: 'Back', BR: 'Breast', Fly: 'Fly', IM: 'IM', Kick: 'Kick' };
const WINDOWS = [
  { v: 1, l: '1 mo' }, { v: 6, l: '6 mo' }, { v: 12, l: '12 mo' }, { v: null, l: 'All time' },
];

const C = {
  page: { minHeight: '100vh', background: '#1a1a2e', color: '#fff', fontFamily: 'monospace', padding: '16px 12px' },
  wrap: { maxWidth: 720, margin: '0 auto' },
  card: { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 },
  label: { fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' },
  btn: { padding: '6px 10px', fontSize: 11, borderRadius: 5, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(48,176,199,0.12)', color: '#fff', cursor: 'pointer' },
  th: { textAlign: 'left', padding: '4px 0', fontWeight: 400, color: 'rgba(255,255,255,0.3)', fontSize: 10 },
  muted: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
};

function eventKeyToLabel(pStroke, pDist) { return pDist + 'm ' + (STROKE_NAME[pStroke] || pStroke); }
function ageLabel(pMonths) {
  if (pMonths == null || !isFinite(pMonths)) return '';
  if (pMonths < 1) return 'this month';
  if (pMonths < 12) return Math.round(pMonths) + ' mo ago';
  return (Math.round(pMonths / 1.2) / 10) + ' yr ago';
}

export default function AthleteRecords() {
  const navigate = useNavigate();
  const location = useLocation();
  const athleteId = location.state?.athleteId || null;
  const name = location.state?.name || 'Athlete';

  const [windowMonths, setWindowMonths] = useState(null);   // null = all-time
  const [bests, setBests] = useState([]);
  const [history, setHistory] = useState([]);
  const [sets, setSets] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadBests = useCallback(async () => {
    if (!athleteId) return;
    const { data, error: mErr } = await getAthleteBests(athleteId, { windowMonths });
    if (mErr) { setError(mErr.message || 'Could not load bests'); return; }
    setBests((data?.bests || []).slice().sort((a, b) => a.stroke.localeCompare(b.stroke) || a.distM - b.distM));
  }, [athleteId, windowMonths]);

  useEffect(() => { loadBests(); }, [loadBests]);

  useEffect(() => {
    if (!athleteId) { setLoading(false); return; }
    let mCancelled = false;
    Promise.all([getResultHistory(athleteId, {}), getSetResults(athleteId, {})]).then(([mHist, mSets]) => {
      if (mCancelled) return;
      if (mHist.error) setError(mHist.error.message || 'Could not load history');
      setHistory(mHist.data || []);
      setSets(mSets.data || []);
      setLoading(false);
    });
    return () => { mCancelled = true; };
  }, [athleteId]);

  // group progression by event, oldest→newest
  const byEvent = {};
  for (const r of history) {
    const k = `${r.stroke}${r.distM}`;
    (byEvent[k] = byEvent[k] || []).push(r);
  }
  const eventKeys = Object.keys(byEvent).sort((a, b) => a.localeCompare(b));

  if (!athleteId) {
    return (
      <div style={C.page}><div style={C.wrap}>
        <button style={C.btn} onClick={() => navigate('/athlete-setup')}>← Athlete Setup</button>
        <p style={{ ...C.muted, marginTop: 16 }}>No athlete selected. Open this from Athlete Setup's “View records / log”, or load an athlete from the Dashboard first.</p>
      </div></div>
    );
  }

  return (
    <div style={C.page}><div style={C.wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.15em' }}>TRAINING LOG</div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>{name}</div>
        </div>
        <button style={C.btn} onClick={() => navigate('/athlete-setup', { state: { loadAthlete: { athleteId, name } } })}>← Athlete Setup</button>
      </div>

      {error && <div style={{ ...C.card, borderColor: 'rgba(255,80,80,0.4)', color: '#f88' }}>{error}</div>}
      {loading && <p style={C.muted}>Loading…</p>}

      {/* Bests + window filter */}
      <div style={C.card}>
        <label style={C.label}>Best times <span style={{ opacity: 0.5, fontWeight: 400 }}>— the classify window; official and trials rank on time alone</span></label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {WINDOWS.map((w) => (
            <button key={w.l} onClick={() => setWindowMonths(w.v)}
              style={{ padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
                border: '1px solid ' + (windowMonths === w.v ? 'rgba(48,176,199,0.6)' : 'rgba(255,255,255,0.1)'),
                background: windowMonths === w.v ? 'rgba(48,176,199,0.18)' : 'transparent',
                color: windowMonths === w.v ? '#8fd6e4' : 'rgba(255,255,255,0.4)' }}>
              {w.l}
            </button>
          ))}
        </div>
        {bests.length === 0 ? (
          <p style={C.muted}>No maximal times in this window.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>
              <th style={C.th}>Event</th>
              <th style={{ ...C.th, textAlign: 'right' }}>Best</th>
              <th style={{ ...C.th, textAlign: 'right' }}>Type</th>
              <th style={{ ...C.th, textAlign: 'right' }}>When</th>
            </tr></thead>
            <tbody>
              {bests.map((b) => (
                <tr key={b.stroke + b.distM} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '5px 0' }}>{eventKeyToLabel(b.stroke, b.distM)}</td>
                  <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 700 }}>{secToDisplay(b.timeSec)}</td>
                  <td style={{ padding: '5px 0', textAlign: 'right' }}>
                    <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4,
                      background: b.official ? 'rgba(52,199,89,0.15)' : 'rgba(255,204,0,0.15)',
                      color: b.official ? '#34C759' : '#FFCC00' }}>
                      {b.official ? 'official' : 'trial'}
                    </span>
                  </td>
                  <td style={{ padding: '5px 0', textAlign: 'right', color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>{ageLabel(b.ageMonths)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Progression per event */}
      <div style={C.card}>
        <label style={C.label}>Progression <span style={{ opacity: 0.5, fontWeight: 400 }}>— every swim kept, newest first</span></label>
        {eventKeys.length === 0 ? (
          <p style={C.muted}>No swims on record yet. Save times from Athlete Setup, or import a Poolside session.</p>
        ) : eventKeys.map((k) => {
          const rows = byEvent[k].slice().sort((a, b) => (a.swumOn < b.swumOn ? 1 : -1));
          const best = Math.min(...rows.map((r) => Number(r.timeSec)));
          return (
            <div key={k} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{eventKeyToLabel(rows[0].stroke, rows[0].distM)}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {rows.map((r) => (
                  <span key={r.id} title={(r.kind || '') + ' · ' + (r.poolType || '')}
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, fontFamily: 'monospace',
                      background: Number(r.timeSec) === best ? 'rgba(52,199,89,0.15)' : 'rgba(255,255,255,0.05)',
                      border: '1px solid ' + (r.kind === 'time_trial' ? 'rgba(255,204,0,0.3)' : 'rgba(255,255,255,0.08)') }}>
                    {secToDisplay(r.timeSec)} <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9 }}>{r.swumOn}</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Set / test history */}
      <div style={C.card}>
        <label style={C.label}>Sets &amp; tests <span style={{ opacity: 0.5, fontWeight: 400 }}>— sets swum; recognised test sets land here</span></label>
        {sets.length === 0 ? (
          <p style={C.muted}>No sets recorded yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>
              <th style={C.th}>Date</th>
              <th style={C.th}>Set</th>
              <th style={{ ...C.th, textAlign: 'right' }}>Test</th>
            </tr></thead>
            <tbody>
              {sets.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '5px 0' }}>{s.swumOn}</td>
                  <td style={{ padding: '5px 0' }}>{s.set?.name || '—'}</td>
                  <td style={{ padding: '5px 0', textAlign: 'right', color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>
                    {s.conditions?.hrStream?.samples?.length ? <span title="Live heart rate recorded" style={{ color: '#ff9a63', marginRight: 6 }}>♥ HR</span> : null}
                    {s.protocolId ? 'test' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div></div>
  );
}
