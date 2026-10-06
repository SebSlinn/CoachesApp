// src/pages/AthleteRecords.jsx
// An athlete's training log / records view. Read-only.
//   • Bests — fastest maximal per event, filtered by a date window (1/6/12/all).
//   • Progression — EVERY kept swim, under the SAME window as bests; click an
//     event to drill down into a dated trend (faster = higher, like SR.org).
//   • Sets & tests — click a set to drill into its structure + reps; pick a test
//     and compare its efforts rep-by-rep across dates.
// One window filter governs bests, progression and sets together.
// Reached from Athlete Setup with { athleteId, name } in router state.

import { Fragment, useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { secToDisplay } from '../zones/helpers.js';
import { getAthleteBests, getResultHistory, getSetResultsDetailed, setSignature } from '../services/results.js';

const STROKE_NAME = { FS: 'Free', BK: 'Back', BR: 'Breast', Fly: 'Fly', IM: 'IM', Kick: 'Kick' };
const WINDOWS = [
  { v: 1, l: '1 mo' }, { v: 6, l: '6 mo' }, { v: 12, l: '12 mo' }, { v: null, l: 'All time' },
];

const C = {
  page: { minHeight: '100vh', background: '#1a1a2e', color: '#fff', fontFamily: 'monospace', padding: '16px 12px' },
  wrap: { maxWidth: 760, margin: '0 auto' },
  card: { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 },
  label: { fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' },
  btn: { padding: '6px 10px', fontSize: 11, borderRadius: 5, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(48,176,199,0.12)', color: '#fff', cursor: 'pointer' },
  th: { textAlign: 'left', padding: '4px 0', fontWeight: 400, color: 'rgba(255,255,255,0.3)', fontSize: 10 },
  muted: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  chip: (on) => ({ padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
    border: '1px solid ' + (on ? 'rgba(48,176,199,0.6)' : 'rgba(255,255,255,0.1)'),
    background: on ? 'rgba(48,176,199,0.18)' : 'transparent', color: on ? '#8fd6e4' : 'rgba(255,255,255,0.4)' }),
};
const ACCENT = '#38c6df', GOOD = '#3fd196', INK_MUTED = 'rgba(255,255,255,0.4)';

const eventKeyToLabel = (s, d) => d + 'm ' + (STROKE_NAME[s] || s);
function monthsSince(iso) { const t = Date.parse(iso); return isNaN(t) ? Infinity : (Date.now() - t) / (1000 * 60 * 60 * 24 * 30.4375); }
function ageLabel(m) { if (m == null || !isFinite(m)) return ''; if (m < 1) return 'this month'; if (m < 12) return Math.round(m) + ' mo ago'; return (Math.round(m / 1.2) / 10) + ' yr ago'; }

// ── Single-series progression trend (faster time = higher, matching SR.org) ──
// Pure geometry so it's testable; one hue (no legend needed), PB + latest
// direct-labelled, every point hoverable.
function trendGeometry(rows, W, H) {
  const padL = 8, padR = 12, padT = 12, padB = 18;
  const pw = W - padL - padR, ph = H - padT - padB;
  const times = rows.map((r) => Number(r.timeSec));
  const minT = Math.min(...times), maxT = Math.max(...times);
  const ts = rows.map((r) => Date.parse(r.swumOn) || 0);
  const tmin = Math.min(...ts), tmax = Math.max(...ts);
  const xFor = (t) => (tmax === tmin ? padL + pw / 2 : padL + ((t - tmin) / (tmax - tmin)) * pw);
  const yFor = (v) => (maxT === minT ? padT + ph / 2 : padT + ((v - minT) / (maxT - minT)) * ph); // min (fastest) at top
  const pts = rows.map((r) => ({ x: xFor(Date.parse(r.swumOn) || 0), y: yFor(Number(r.timeSec)), row: r }));
  return { pts, minT, maxT, padL, padR, padT, padB, W, H };
}

function Trend({ rows }) {
  if (!rows || rows.length === 0) return null;
  const W = 340, H = 120;
  const g = trendGeometry(rows, W, H);
  const pbIdx = rows.reduce((bi, r, i, a) => (Number(r.timeSec) < Number(a[bi].timeSec) ? i : bi), 0);
  const lastIdx = rows.length - 1;
  const path = g.pts.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
  const labelFor = (i) => {
    const p = g.pts[i]; const above = p.y > H / 2;
    return (
      <text key={'lbl' + i} x={Math.min(Math.max(p.x, 20), W - 20)} y={above ? p.y - 7 : p.y + 13}
        textAnchor="middle" fontSize="9" fill={i === pbIdx ? GOOD : ACCENT} fontFamily="monospace">
        {secToDisplay(p.row.timeSec)}
      </text>
    );
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="progression trend, faster times higher">
      {/* faint top/bottom guide = fastest / slowest in view */}
      <line x1={g.padL} y1={g.padT} x2={W - g.padR} y2={g.padT} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      <line x1={g.padL} y1={H - g.padB} x2={W - g.padR} y2={H - g.padB} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      <text x={W - g.padR} y={g.padT - 3} textAnchor="end" fontSize="8" fill={INK_MUTED} fontFamily="monospace">{secToDisplay(g.minT)} (fastest)</text>
      {rows.length > 1 && <path d={path} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />}
      {g.pts.map((p, i) => (
        <g key={i}>
          <title>{p.row.swumOn} · {secToDisplay(p.row.timeSec)}{p.row.kind === 'time_trial' ? ' (trial)' : ''}</title>
          <circle cx={p.x} cy={p.y} r={i === pbIdx ? 4.5 : 3.5}
            fill={i === pbIdx ? GOOD : (i === lastIdx ? ACCENT : '#1a1a2e')}
            stroke={i === pbIdx ? GOOD : ACCENT} strokeWidth="1.5" />
        </g>
      ))}
      {labelFor(pbIdx)}
      {lastIdx !== pbIdx && labelFor(lastIdx)}
    </svg>
  );
}

// Human-readable set line, e.g. "6 × 100 Free @ PB+6–12 · on 1:50"
function describeLine(l) {
  if (!l || (l.type && l.type !== 'swim')) return l?.note || (l?.type || 'rest');
  const tr = l.targetRule || {}, iv = l.interval || {};
  const rule = tr.base === 'PB' ? `PB+${tr.plusFrom}–${tr.plusTo}`
    : tr.base === 'absolute' ? (tr.inTime || '')
    : tr.base === 'bestAverage' ? 'best avg'
    : (tr.base || '');
  const ivs = iv.type === 'rest' ? `${iv.restSec}s rest` : (iv.onTime ? 'on ' + iv.onTime : '');
  return `${l.qty || 1} × ${l.distM}m ${STROKE_NAME[l.stroke] || l.stroke || ''}` +
    (rule ? ' @ ' + rule : '') + (ivs ? ' · ' + ivs : '');
}
const setLines = (set) => (set?.blocks || []).flatMap((b) => (b.lines || []).map((l) => ({ l, repeats: b.repeats || 1 })));

export default function AthleteRecords() {
  const navigate = useNavigate();
  const location = useLocation();
  const athleteId = location.state?.athleteId || null;
  const name = location.state?.name || 'Athlete';

  const [windowMonths, setWindowMonths] = useState(null);   // null = all-time — governs the whole page
  const [bests, setBests] = useState([]);
  const [history, setHistory] = useState([]);
  const [sets, setSets] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [focusEvent, setFocusEvent] = useState(null);       // event key being drilled into
  const [openSwimId, setOpenSwimId] = useState(null);       // single swim showing its detail
  const [openSetId, setOpenSetId] = useState(null);         // set effort drilled into
  const [compareSig, setCompareSig] = useState(null);       // signature being compared

  // open an event's drill-down (from the Progression list OR a Best-times row)
  const openEvent = (k) => {
    setFocusEvent(k);
    setTimeout(() => { const el = document.getElementById('ev-' + k); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  };

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
    // allSettled, not all: if the sets fetch fails (e.g. a repo method not yet
    // deployed), progression + drill-down must still load.
    (async () => {
      const [mHist, mSets] = await Promise.allSettled([
        getResultHistory(athleteId, {}),
        getSetResultsDetailed(athleteId, {}),
      ]);
      if (mCancelled) return;
      if (mHist.status === 'fulfilled') {
        if (mHist.value.error) setError(mHist.value.error.message || 'Could not load history');
        setHistory(mHist.value.data || []);
      } else {
        setError('Could not load history');
      }
      if (mSets.status === 'fulfilled') setSets(mSets.value.data || []);
      setLoading(false);
    })();
    return () => { mCancelled = true; };
  }, [athleteId]);

  const inWindow = (iso) => windowMonths == null || monthsSince(iso) <= windowMonths;

  // progression grouped by event, UNDER THE SAME WINDOW as bests
  const byEvent = {};
  for (const r of history) { if (!inWindow(r.swumOn)) continue; const k = `${r.stroke}${r.distM}`; (byEvent[k] = byEvent[k] || []).push(r); }
  const eventKeys = Object.keys(byEvent).sort((a, b) => a.localeCompare(b));

  // sets under the window, grouped by signature for comparison
  const winSets = sets.filter((s) => inWindow(s.swumOn));
  const bySig = {};
  for (const s of winSets) { const sig = setSignature(s.set || {}); (bySig[sig] = bySig[sig] || []).push(s); }

  if (!athleteId) {
    return (
      <div style={C.page}><div style={C.wrap}>
        <button style={C.btn} onClick={() => navigate('/athlete-setup')}>← Athlete Setup</button>
        <p style={{ ...C.muted, marginTop: 16 }}>No athlete selected. Open this from Athlete Setup’s “View records / log”.</p>
      </div></div>
    );
  }

  const compareGroup = compareSig ? (bySig[compareSig] || []) : null;

  return (
    <div style={C.page}><div style={C.wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.15em' }}>TRAINING LOG</div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>{name}</div>
        </div>
        <button style={C.btn} onClick={() => navigate('/athlete-setup', { state: { loadAthlete: { athleteId, name } } })}>← Athlete Setup</button>
      </div>

      {/* One window filter for the whole page */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ ...C.muted, marginRight: 4 }}>Window:</span>
        {WINDOWS.map((w) => (
          <button key={w.l} onClick={() => setWindowMonths(w.v)} style={C.chip(windowMonths === w.v)}>{w.l}</button>
        ))}
        <span style={{ ...C.muted, fontSize: 10 }}>— applies to bests, progression &amp; sets</span>
      </div>

      {error && <div style={{ ...C.card, borderColor: 'rgba(255,80,80,0.4)', color: '#f88' }}>{error}</div>}
      {loading && <p style={C.muted}>Loading…</p>}

      {/* Bests */}
      <div style={C.card}>
        <label style={C.label}>Best times <span style={{ opacity: 0.5, fontWeight: 400 }}>— official &amp; trials rank on time alone</span></label>
        {bests.length === 0 ? <p style={C.muted}>No maximal times in this window.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr><th style={C.th}>Event</th><th style={{ ...C.th, textAlign: 'right' }}>Best</th><th style={{ ...C.th, textAlign: 'right' }}>Type</th><th style={{ ...C.th, textAlign: 'right' }}>When</th></tr></thead>
            <tbody>
              {bests.map((b) => (
                <tr key={b.stroke + b.distM} onClick={() => openEvent(b.stroke + b.distM)} title="Open this event's progression"
                  style={{ borderTop: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}>
                  <td style={{ padding: '5px 0' }}>{eventKeyToLabel(b.stroke, b.distM)}</td>
                  <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 700 }}>{secToDisplay(b.timeSec)}</td>
                  <td style={{ padding: '5px 0', textAlign: 'right' }}>
                    <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: b.official ? 'rgba(52,199,89,0.15)' : 'rgba(255,204,0,0.15)', color: b.official ? GOOD : '#FFCC00' }}>{b.official ? 'official' : 'trial'}</span>
                  </td>
                  <td style={{ padding: '5px 0', textAlign: 'right', color: INK_MUTED, fontSize: 10 }}>{ageLabel(b.ageMonths)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Progression — click an event to drill down */}
      <div style={C.card}>
        <label style={C.label}>Progression <span style={{ opacity: 0.5, fontWeight: 400 }}>— click an event for its dated trend</span></label>
        {eventKeys.length === 0 ? <p style={C.muted}>No swims in this window.</p> : eventKeys.map((k) => {
          const rowsNewest = byEvent[k].slice().sort((a, b) => (a.swumOn < b.swumOn ? 1 : -1));
          const rowsOldest = byEvent[k].slice().sort((a, b) => (a.swumOn < b.swumOn ? -1 : 1));
          const best = Math.min(...rowsNewest.map((r) => Number(r.timeSec)));
          const open = focusEvent === k;
          return (
            <div key={k} id={'ev-' + k} style={{ marginBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 8 }}>
              <div onClick={() => setFocusEvent(open ? null : k)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{open ? '▾ ' : '▸ '}{eventKeyToLabel(rowsNewest[0].stroke, rowsNewest[0].distM)}</span>
                <span style={{ ...C.muted, fontSize: 11 }}>{rowsNewest.length} swim{rowsNewest.length === 1 ? '' : 's'} · best {secToDisplay(best)}</span>
              </div>
              {open ? (
                <div style={{ marginTop: 8 }}>
                  <Trend rows={rowsOldest} />
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                    <thead><tr><th style={C.th}>Date</th><th style={{ ...C.th, textAlign: 'right' }}>Time</th><th style={{ ...C.th, textAlign: 'right' }}>Type</th><th style={{ ...C.th, textAlign: 'right' }}>Pool</th></tr></thead>
                    <tbody>
                      {rowsNewest.map((r) => {
                        const p = r.provenance || {};
                        const swimOpen = openSwimId === r.id;
                        const hasDetail = p.meetName || p.venue || p.importRef || r.poolType;
                        return (
                          <Fragment key={r.id}>
                            <tr onClick={() => hasDetail && setOpenSwimId(swimOpen ? null : r.id)}
                              style={{ borderTop: '1px solid rgba(255,255,255,0.04)', cursor: hasDetail ? 'pointer' : 'default' }}>
                              <td style={{ padding: '4px 0' }}>{hasDetail ? (swimOpen ? '▾ ' : '▸ ') : ''}{r.swumOn}</td>
                              <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 700, color: Number(r.timeSec) === best ? GOOD : '#fff' }}>{secToDisplay(r.timeSec)}</td>
                              <td style={{ padding: '4px 0', textAlign: 'right', color: INK_MUTED, fontSize: 10 }}>{r.kind === 'time_trial' ? 'trial' : (r.kind === 'meet' ? 'official' : r.kind)}</td>
                              <td style={{ padding: '4px 0', textAlign: 'right', color: INK_MUTED, fontSize: 10 }}>{r.poolType || ''}</td>
                            </tr>
                            {swimOpen && (
                              <tr>
                                <td colSpan={4} style={{ padding: '2px 0 8px 14px', color: 'rgba(255,255,255,0.55)', fontSize: 11, lineHeight: 1.6 }}>
                                  {p.meetName && <div>Meet: {p.meetName}</div>}
                                  {p.venue && <div>Venue: {p.venue}{p.country ? ' · ' + p.country : ''}</div>}
                                  <div>Pool: {r.poolType || '—'} · {p.sanctioned ? 'sanctioned' : (r.kind === 'time_trial' ? 'time trial (non-official)' : r.source || '')}</div>
                                  {p.importRef && <div style={{ color: INK_MUTED }}>Ref: {String(p.importRef).split(':')[2] || p.importRef}</div>}
                                  {r.note && <div style={{ color: INK_MUTED }}>{r.note}</div>}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {rowsNewest.slice(0, 8).map((r) => (
                    <span key={r.id} title={r.swumOn}
                      style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: Number(r.timeSec) === best ? 'rgba(63,209,150,0.15)' : 'rgba(255,255,255,0.05)', border: '1px solid ' + (r.kind === 'time_trial' ? 'rgba(255,204,0,0.3)' : 'rgba(255,255,255,0.08)') }}>
                      {secToDisplay(r.timeSec)}
                    </span>
                  ))}
                  {rowsNewest.length > 8 && <span style={{ ...C.muted, alignSelf: 'center' }}>+{rowsNewest.length - 8} more</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sets & tests — drill into one, or compare a group */}
      <div style={C.card}>
        <label style={C.label}>Sets &amp; tests <span style={{ opacity: 0.5, fontWeight: 400 }}>— click a set for detail; “compare” lines up every effort of the same test</span></label>
        {winSets.length === 0 ? <p style={C.muted}>No sets in this window. Test sets land here once swum (Poolside).</p> : (
          <div>
            {Object.keys(bySig).sort().map((sig) => {
              const group = bySig[sig];
              const title = group[0].set?.name || sig;
              return (
                <div key={sig} style={{ marginBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
                    <span style={{ ...C.muted, fontSize: 10 }}>{sig}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }}>
                    {group.slice().sort((a, b) => (a.swumOn < b.swumOn ? 1 : -1)).map((s) => (
                      <button key={s.id} onClick={() => setOpenSetId(openSetId === s.id ? null : s.id)} style={C.chip(openSetId === s.id)}>
                        {s.conditions?.hrStream?.samples?.length ? <span title="Live heart rate recorded" style={{ color: '#ff9a63', marginRight: 6 }}>♥</span> : null}{s.swumOn}{s.protocolId ? ' ·test' : ''}
                      </button>
                    ))}
                    {group.length >= 2 && (
                      <button onClick={() => setCompareSig(compareSig === sig ? null : sig)}
                        style={{ ...C.btn, fontSize: 10, padding: '5px 10px' }}>
                        {compareSig === sig ? 'Hide compare' : `Compare ${group.length}`}
                      </button>
                    )}
                  </div>

                  {/* single-set drill-down */}
                  {group.filter((s) => s.id === openSetId).map((s) => (
                    <div key={s.id} style={{ marginTop: 8, padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                      <div style={{ ...C.muted, marginBottom: 6 }}>{s.swumOn}{s.conditions?.location ? ' · ' + s.conditions.location : ''}{s.conditions?.rpe ? ' · RPE ' + s.conditions.rpe : ''}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
                        {setLines(s.set).map((x, i) => <div key={i}>{(x.repeats > 1 ? x.repeats + '× block: ' : '') + describeLine(x.l)}</div>)}
                      </div>
                      {(s.reps && s.reps.length) ? (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead><tr><th style={C.th}>Rep</th><th style={{ ...C.th, textAlign: 'right' }}>Time</th><th style={{ ...C.th, textAlign: 'right' }}>Target</th><th style={{ ...C.th, textAlign: 'right' }}>PB@swim</th></tr></thead>
                          <tbody>
                            {s.reps.map((rep) => (
                              <tr key={rep.id || rep.repNo} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                <td style={{ padding: '4px 0' }}>{rep.repNo}. {rep.distM}m {STROKE_NAME[rep.stroke] || rep.stroke || ''}</td>
                                <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 700 }}>{secToDisplay(rep.timeSec)}</td>
                                <td style={{ padding: '4px 0', textAlign: 'right', color: INK_MUTED, fontSize: 10 }}>{rep.targetTime || ''}</td>
                                <td style={{ padding: '4px 0', textAlign: 'right', color: INK_MUTED, fontSize: 10 }}>{rep.pbAtSwim ? secToDisplay(rep.pbAtSwim) : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <div style={C.muted}>No rep times recorded for this set.</div>}
                    </div>
                  ))}
                </div>
              );
            })}

            {/* comparison: same test, efforts as columns, reps as rows */}
            {compareGroup && compareGroup.length >= 2 && (
              <div style={{ marginTop: 10, padding: 10, background: 'rgba(56,198,223,0.06)', border: '1px solid rgba(56,198,223,0.25)', borderRadius: 8, overflowX: 'auto' }}>
                <div style={{ ...C.label, marginBottom: 8 }}>Comparing {compareGroup.length} efforts · {compareGroup[0].set?.name || compareSig}</div>
                {(() => {
                  const cols = compareGroup.slice().sort((a, b) => (a.swumOn < b.swumOn ? -1 : 1));
                  const maxReps = Math.max(...cols.map((c) => (c.reps || []).length));
                  const rowsIdx = Array.from({ length: maxReps }, (_, i) => i);
                  const repTime = (c, i) => { const rep = (c.reps || []).find((r) => (r.repNo || 0) === i + 1) || (c.reps || [])[i]; return rep ? Number(rep.timeSec) : null; };
                  return (
                    <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr><th style={C.th}>Rep</th>{cols.map((c) => <th key={c.id} style={{ ...C.th, textAlign: 'right', paddingLeft: 12 }}>{c.swumOn}</th>)}</tr></thead>
                      <tbody>
                        {rowsIdx.map((i) => {
                          const vals = cols.map((c) => repTime(c, i));
                          const best = Math.min(...vals.filter((v) => v != null));
                          return (
                            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                              <td style={{ padding: '4px 0' }}>{i + 1}</td>
                              {vals.map((v, ci) => (
                                <td key={ci} style={{ padding: '4px 0 4px 12px', textAlign: 'right', fontWeight: v === best ? 700 : 400, color: v === best ? GOOD : '#fff' }}>
                                  {v == null ? '—' : secToDisplay(v)}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                        {/* average row */}
                        <tr style={{ borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                          <td style={{ padding: '6px 0', color: INK_MUTED, fontSize: 10 }}>avg</td>
                          {cols.map((c) => {
                            const vs = (c.reps || []).map((r) => Number(r.timeSec)).filter((x) => x > 0);
                            const avg = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
                            return <td key={c.id} style={{ padding: '6px 0 6px 12px', textAlign: 'right', color: ACCENT, fontSize: 11 }}>{avg ? secToDisplay(avg) : '—'}</td>;
                          })}
                        </tr>
                      </tbody>
                    </table>
                  );
                })()}
                <div style={{ ...C.muted, fontSize: 10, marginTop: 6 }}>Fastest per rep in green. Oldest → newest left to right.</div>
              </div>
            )}
          </div>
        )}
      </div>

    </div></div>
  );
}
