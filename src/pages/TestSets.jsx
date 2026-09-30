// src/pages/TestSets.jsx
// The Test Set Library: pick a test, set the per-run knobs (send-off / rest),
// pick the swimmer(s), and see the test rep by rep with each swimmer's own
// targets from their bests. Also lists the previous runs of that test.
//
// Reached from the Dashboard, or from Athlete Setup with { athleteId, name } in
// router state (that athlete is pre-selected). Data via services/protocols.js
// and services/results.js; the DB decides which tests and athletes are visible.
// "Send to Poolside" is the next step (Piece 2) — the prescription shown here is
// exactly what will be handed over.

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { listProtocols, prescribeForAthletes } from '../services/protocols';
import { getSetResultsByProtocol } from '../services/results';
import { getLogsSharedWithMe } from '../services/logSharing';
import { prescribeGroup } from '../session/protocolFormat';

const STROKE_NAME = { FS: 'Free', BK: 'Back', BR: 'Breast', Fly: 'Fly', IM: 'IM', Kick: 'Kick' };
const MEASURE_LABEL = { time: 'time', splits: 'splits', sc: 'strokes', sr: 'rate', hr: 'HR', rpe: 'RPE', lactate: 'lactate' };
const WINDOWS = [{ v: null, l: 'All-time bests' }, { v: 12, l: '12 mo' }, { v: 6, l: '6 mo' }];

const C = {
  page: { minHeight: '100vh', background: '#1a1a2e', color: '#fff', fontFamily: 'monospace', padding: '16px 12px' },
  wrap: { maxWidth: 1040, margin: '0 auto' },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) 1fr', gap: 12, alignItems: 'start' },
  card: { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 },
  label: { fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' },
  btn: { padding: '6px 10px', fontSize: 11, borderRadius: 5, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(48,176,199,0.12)', color: '#fff', cursor: 'pointer', fontFamily: 'monospace' },
  muted: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  th: { textAlign: 'left', padding: '6px 8px', fontWeight: 400, color: 'rgba(255,255,255,0.35)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  td: { padding: '7px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 12, verticalAlign: 'top' },
  select: { background: '#12122a', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 5, padding: '5px 8px', fontFamily: 'monospace', fontSize: 12 },
};

const badge = (bg, fg) => ({ display: 'inline-block', padding: '1px 7px', borderRadius: 9, fontSize: 10, background: bg, color: fg, marginRight: 4 });
const B = {
  global: badge('rgba(48,176,199,0.18)', '#7fd8e8'),
  club: badge('rgba(120,200,120,0.18)', '#9be29b'),
  draft: badge('rgba(255,204,0,0.18)', '#ffd84d'),
  used: badge('rgba(255,255,255,0.1)', 'rgba(255,255,255,0.6)'),
  measure: badge('rgba(255,255,255,0.07)', 'rgba(255,255,255,0.7)'),
};

const isDraft = (p) => /^DRAFT/i.test(p.description || '') || /DRAFT/i.test(p.set?.note || '');
const fmtClock = (s) => { const m = Math.floor(s / 60); return `${m}:${String(Math.round(s - m * 60)).padStart(2, '0')}`; };
const paramValueLabel = (def, v) => (def.kind === 'restSec' ? (v >= 60 && v % 60 === 0 ? `${v / 60} min` : `${v} s`) : v);

function intervalLabel(iv) {
  if (!iv) return '';
  if (iv.type === 'fixed') return iv.onTime ? `on ${iv.onTime}` : '';
  const r = Number(iv.restSec);
  return r > 0 ? `${r >= 60 && r % 60 === 0 ? `${r / 60} min` : `${r} s`} rest` : '—';
}

// One headline per analyser for the "previous runs" list.
function headline(summary) {
  if (!summary) return '—';
  if (summary.error) return summary.error;
  switch (summary.analyser) {
    case 'step': return summary.speedAt4mmol
      ? `${fmtClock(summary.pace100At4mmolSec)}/100 at 4 mmol · peak HR ${summary.peakHr ?? '—'}`
      : `last step ${fmtClock(summary.lastStepSec || 0)} · peak HR ${summary.peakHr ?? '—'}`;
    case 'css': return `CSS ${fmtClock(summary.cssPer100Sec)}/100`;
    case 'double-distance': return `${fmtClock(summary.timeSec)}${summary.vsTargetSec != null ? ` (${summary.vsTargetSec > 0 ? '+' : ''}${summary.vsTargetSec} s)` : ''}${summary.fadeSec != null ? ` · fade ${summary.fadeSec} s` : ''}`;
    case 'blocks': return summary.dropOffSec != null ? `drop-off ${summary.dropOffSec > 0 ? '+' : ''}${summary.dropOffSec} s/rep` : '—';
    case 'swolf': return `best SWOLF ${summary.bestSwolf ?? '—'} · mean ${summary.meanSwolf ?? '—'}`;
    case 'maxhr': return `peak HR ${summary.peakHr ?? '—'}`;
    default: return summary.meanSec ? `mean ${fmtClock(summary.meanSec)} · spread ${summary.spreadSec} s` : '—';
  }
}

// Collapse consecutive reps of the same line whose targets match for every
// swimmer into one row ("1–10"), so 20×100 reads as 3 rows, not 21.
function groupRows(pr) {
  const perAthlete = pr.athletes.length ? pr.athletes : [{ athleteId: null, name: '', reps: pr.reps }];
  const n = perAthlete[0].reps.length;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const rep = perAthlete[0].reps[i];
    const targets = perAthlete.map((a) => a.reps[i].targetTime || a.reps[i].target.display);
    const prev = rows[rows.length - 1];
    if (prev && prev.lineKey === `${rep.blockIdx}:${rep.lineIdx}:${rep.blockRepeat}` && prev.targets.join('|') === targets.join('|')) {
      prev.to = rep.repNo; prev.count++;
    } else {
      rows.push({ lineKey: `${rep.blockIdx}:${rep.lineIdx}:${rep.blockRepeat}`, from: rep.repNo, to: rep.repNo, count: 1, rep, targets,
                  rest: perAthlete.map((a) => a.reps[i].restSec) });
    }
  }
  return { rows, athletes: perAthlete };
}

export default function TestSets() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile } = useAuth();
  const handoff = location.state?.athleteId ? { id: location.state.athleteId, name: location.state.name || 'Athlete' } : null;

  const [protocols, setProtocols] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [chosen, setChosen] = useState({});
  const [athletes, setAthletes] = useState([]);           // who I can pick
  const [picked, setPicked] = useState(handoff ? [handoff.id] : []);
  const [windowMonths, setWindowMonths] = useState(null);
  const [prescription, setPrescription] = useState(null);
  const [prError, setPrError] = useState(null);
  const [runs, setRuns] = useState([]);

  // Library
  useEffect(() => {
    listProtocols().then(({ data, error }) => {
      if (error) { setLoadError(error.message || 'Could not load the test library'); return; }
      setProtocols(data || []);
      if (data && data.length) setSelectedId((cur) => cur || data[0].id);
    });
  }, []);

  // Swimmers I can pick: me, anyone shared with me, and the hand-off athlete.
  useEffect(() => {
    if (!user) return;
    const mMe = { id: user.id, name: (profile?.full_name || user.email || 'Me') + ' (me)' };
    getLogsSharedWithMe(user.id).then(({ data }) => {
      const mShared = (data || []).filter((p) => p.status === 'active' && p.can_read !== false)
        .map((p) => ({ id: p.owner_user_id, name: p.owner?.full_name || p.owner?.email || 'Athlete' }));
      const mAll = [mMe, ...mShared];
      if (handoff && !mAll.some((a) => a.id === handoff.id)) mAll.push(handoff);
      setAthletes(mAll);
    });
  }, [user, profile]);   // eslint-disable-line react-hooks/exhaustive-deps

  const protocol = useMemo(() => protocols.find((p) => p.id === selectedId) || null, [protocols, selectedId]);

  // New test → its default params.
  useEffect(() => {
    if (!protocol) return;
    const mDefaults = {};
    for (const [k, d] of Object.entries(protocol.params || {})) mDefaults[k] = d.default;
    setChosen(mDefaults);
  }, [protocol]);

  // Prescription: resolved for the picked swimmers (fetches their bests), or a
  // preview with the rules shown when nobody is picked.
  useEffect(() => {
    if (!protocol) return;
    let mCancelled = false;
    setPrError(null);
    if (!picked.length) { setPrescription(prescribeGroup(protocol, { chosen })); return; }
    const mWho = picked.map((id) => athletes.find((a) => a.id === id) || { id, name: 'Athlete' });
    prescribeForAthletes(protocol.id, mWho, { chosen, windowMonths }).then(({ data, error }) => {
      if (mCancelled) return;
      if (error) { setPrError(error.message || 'Could not work out targets'); setPrescription(prescribeGroup(protocol, { chosen })); return; }
      setPrescription(data);
    });
    return () => { mCancelled = true; };
  }, [protocol, chosen, picked, athletes, windowMonths]);

  // Previous runs of this test by the first picked swimmer.
  useEffect(() => {
    setRuns([]);
    if (!protocol || !picked.length) return;
    getSetResultsByProtocol(protocol.id, picked[0]).then(({ data }) => setRuns((data || []).slice().reverse()));
  }, [protocol, picked]);

  const togglePick = (id) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const grouped = prescription ? groupRows(prescription) : null;
  const unresolved = grouped && grouped.athletes.some((a) => a.athleteId && a.reps.some((r) => r.target && !r.target.resolved && /^PB/.test(r.target.display)));

  return (
    <div style={C.page}>
      <div style={C.wrap}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <button style={C.btn} onClick={() => navigate(handoff ? -1 : '/dashboard')}>← {handoff ? 'Back' : 'Dashboard'}</button>
          <h2 style={{ margin: 0, fontSize: 18 }}>Test Sets</h2>
          <span style={C.muted} className="ts-sub">the shared library — pick a test, see it for your swimmers</span>
        </div>

        {loadError && <div style={{ ...C.card, color: '#ff8a8a' }}>{loadError}</div>}

        <div style={C.grid} className="ts-grid">
          {/* ── Library ─────────────────────────────────────────────── */}
          <div>
            <div style={C.card}>
              <span style={C.label}>Library · {protocols.length} tests</span>
              {protocols.length === 0 && !loadError && <div style={C.muted}>Loading…</div>}
              <div className="ts-lib">
              {protocols.map((p) => (
                <div key={p.id} onClick={() => setSelectedId(p.id)}
                  style={{ padding: '9px 10px', borderRadius: 7, marginBottom: 6, cursor: 'pointer',
                           background: p.id === selectedId ? 'rgba(48,176,199,0.16)' : 'transparent',
                           border: `1px solid ${p.id === selectedId ? 'rgba(48,176,199,0.5)' : 'rgba(255,255,255,0.06)'}` }}>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>{p.name}</div>
                  <div>
                    <span style={p.scope === 'club' ? B.club : B.global}>{p.scope === 'club' ? 'club' : 'global'}</span>
                    <span style={B.used}>v{p.version}</span>
                    {isDraft(p) && <span style={B.draft}>draft</span>}
                    {p.locked && <span style={B.used}>in use</span>}
                  </div>
                </div>
              ))}
              </div>
            </div>
          </div>

          {/* ── Selected test ───────────────────────────────────────── */}
          <div>
            {protocol && (
              <div style={C.card}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{protocol.name}</h3>
                  <span style={C.muted}>{protocol.key} · v{protocol.version}</span>
                </div>
                {protocol.description && (
                  <p style={{ ...C.muted, margin: '8px 0 10px', color: isDraft(protocol) ? '#ffd84d' : C.muted.color }}>{protocol.description}</p>
                )}
                <div>
                  <span style={{ ...C.muted, fontSize: 11, marginRight: 6 }}>Records:</span>
                  {(protocol.measures || []).map((m) => <span key={m} style={B.measure}>{MEASURE_LABEL[m] || m}</span>)}
                </div>
              </div>
            )}

            {protocol && (
              <div style={C.card}>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  {Object.entries(protocol.params || {}).map(([k, def]) => (
                    <label key={k} style={{ display: 'block' }}>
                      <span style={C.label}>{def.label || k}</span>
                      <select style={C.select} value={String(chosen[k] ?? def.default)}
                        onChange={(e) => setChosen((c) => ({ ...c, [k]: def.kind === 'restSec' ? Number(e.target.value) : e.target.value }))}>
                        {(def.options && def.options.length ? def.options : [def.default]).map((o) => (
                          <option key={String(o)} value={String(o)}>{paramValueLabel(def, o)}{String(o) === String(def.default) ? ' (standard)' : ''}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label style={{ display: 'block' }}>
                    <span style={C.label}>Targets from</span>
                    <select style={C.select} value={String(windowMonths)} onChange={(e) => setWindowMonths(e.target.value === 'null' ? null : Number(e.target.value))}>
                      {WINDOWS.map((w) => <option key={String(w.v)} value={String(w.v)}>{w.l}</option>)}
                    </select>
                  </label>
                </div>

                <span style={{ ...C.label, marginTop: 14 }}>Swimmers</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {athletes.map((a) => {
                    const on = picked.includes(a.id);
                    return (
                      <button key={a.id} onClick={() => togglePick(a.id)}
                        style={{ ...C.btn, background: on ? 'rgba(48,176,199,0.35)' : 'transparent',
                                 borderColor: on ? 'rgba(48,176,199,0.8)' : 'rgba(255,255,255,0.2)' }}>
                        {on ? '✓ ' : ''}{a.name}
                      </button>
                    );
                  })}
                  {athletes.length === 0 && <span style={C.muted}>Loading swimmers…</span>}
                </div>
                {!picked.length && <div style={{ ...C.muted, marginTop: 8 }}>Pick one or more swimmers to see their own target times.</div>}
              </div>
            )}

            {grouped && (
              <div style={C.card}>
                <span style={C.label}>The set, rep by rep</span>
                {prError && <div style={{ color: '#ff8a8a', fontSize: 12, marginBottom: 8 }}>{prError}</div>}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={C.th}>Rep</th>
                        <th style={C.th}>Swim</th>
                        <th style={C.th}>Go</th>
                        {grouped.athletes.map((a, i) => <th key={i} style={C.th}>{a.name ? a.name.replace(' (me)', '') : 'Target'}</th>)}
                        <th style={C.th}>Record</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grouped.rows.map((r) => (
                        <tr key={r.from}>
                          <td style={{ ...C.td, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>{r.count > 1 ? `${r.from}–${r.to}` : r.from}</td>
                          <td style={C.td}>
                            {r.count > 1 ? `${r.count}×` : ''}{r.rep.distM} {STROKE_NAME[r.rep.stroke] || r.rep.stroke}
                            {r.rep.intensity && <span style={{ ...B.measure, marginLeft: 6 }}>{r.rep.intensity}</span>}
                            {r.rep.note && <div style={{ ...C.muted, fontSize: 11 }}>{r.rep.note}</div>}
                          </td>
                          <td style={{ ...C.td, whiteSpace: 'nowrap' }}>{intervalLabel(r.rep.interval)}</td>
                          {r.targets.map((t, i) => (
                            <td key={i} style={{ ...C.td, whiteSpace: 'nowrap', color: /^\d/.test(t) ? '#7fd8e8' : 'rgba(255,255,255,0.55)' }}>
                              {t || '—'}
                              {r.rep.interval?.type === 'fixed' && Number.isFinite(r.rest[i]) && /^\d/.test(t) && (
                                <div style={{ ...C.muted, fontSize: 10 }}>~{Math.round(r.rest[i])} s rest</div>
                              )}
                            </td>
                          ))}
                          <td style={C.td}>
                            {r.rep.measures.length
                              ? r.rep.measures.map((m) => <span key={m} style={B.measure}>{MEASURE_LABEL[m] || m}</span>)
                              : <span style={C.muted}>—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {unresolved && (
                  <div style={{ ...C.muted, marginTop: 8, color: '#ffd84d' }}>
                    Some targets show the rule (e.g. PB+30) because that swimmer has no best for the event in this window.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
                  <button style={{ ...C.btn, opacity: 0.45, cursor: 'not-allowed' }} disabled title="Next step: Poolside set mode">Send to Poolside</button>
                  <span style={C.muted}>coming next — Poolside will time exactly this set</span>
                </div>
              </div>
            )}

            {protocol && picked.length > 0 && (
              <div style={C.card}>
                <span style={C.label}>Previous runs · {athletes.find((a) => a.id === picked[0])?.name?.replace(' (me)', '') || 'athlete'}</span>
                {runs.length === 0
                  ? <div style={C.muted}>Not swum yet.</div>
                  : runs.map((r) => (
                    <div key={r.id} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 12 }}>
                      <span style={{ color: 'rgba(255,255,255,0.5)', minWidth: 90 }}>{r.swumOn}</span>
                      <span>{headline(r.summary)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 720px) {
        .ts-grid { grid-template-columns: minmax(0, 1fr) !important; }
        .ts-grid > div { min-width: 0; }
        .ts-sub { display: none; }
        .ts-lib { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
        .ts-lib > div { flex: 0 0 170px; margin-bottom: 0 !important; }
      }`}</style>
    </div>
  );
}
