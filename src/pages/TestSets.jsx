// src/pages/TestSets.jsx
// The Test Set Library: pick a test, set the per-run knobs (send-off / rest),
// pick the swimmer(s), and see the test rep by rep with each swimmer's own
// targets from their bests. Also lists the previous runs of that test.
//
// ONE SWIMMER AT A TIME (agreed 2026-09-30): opened from Athlete Setup with
// { athleteId, name } in router state — the loaded athlete is the swimmer.
// Poolside times one person, and a lane of 20 would make the target table
// unreadable, so there is no multi-swimmer picker here. Opened without an
// athlete, the page is a read-only preview of the library (rules, not times).
// (The engine — prescribeGroup / buildHandoff — still supports several
// swimmers, for a later "coach ticks off, parents time" lane mode.) Data via services/protocols.js
// and services/results.js; the DB decides which tests and athletes are visible.
// "Time in Poolside" opens Poolside in set mode for one swimmer, carrying
// exactly the prescription shown here (compressed into the link, so it works
// offline). Poolside's "SwimZone test" file comes back through "Import Poolside
// results" and is saved with its summary.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { listProtocols, prescribeForAthletes } from '../services/protocols';
import { getSetResultsByProtocol, ingestPoolsideSetResult } from '../services/results';
import { prescribeGroup, buildHandoff, encodeHandoff } from '../session/protocolFormat';
import { hrRollup, HR_MIN_COVERAGE } from '../hr/hrMetrics';

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

// One line of heart-rate for a run (live sensor or typed HR), or null.
function hrLine(reps) {
  const h = hrRollup(reps);
  if (!h) return null;
  const bits = [];
  if (h.min != null) bits.push(`min ${h.min}`);
  if (h.avg != null) bits.push(`avg ${h.avg}`);
  if (h.peak != null) bits.push(`max ${h.peak}`);
  if (h.meanDrop30 != null) bits.push(`−${h.meanDrop30} in 30 s`);
  if (h.coverage != null) bits.push(`${Math.round(h.coverage * 100)}% covered`);
  return { text: '♥ ' + bits.join(' · '), low: h.coverage != null && h.coverage < HR_MIN_COVERAGE };
}
const fmtRep = (s) => (s >= 60 ? fmtClock(s) : Number(s).toFixed(1));
// Per-length rows from a rep's cumulative splits [{dist, sec, sc?, sr?, hrAvg?…}],
// shown only when a length carries more than its time.
function lengthRows(splits) {
  if (!Array.isArray(splits) || !splits.length || !splits.every((x) => Number.isFinite(Number(x.sec)))) return null;
  if (!splits.some((x) => x.sc || x.sr || x.hrFirst != null)) return null;
  let prev = 0;
  return splits.map((x) => { const lap = Number(x.sec) - prev; prev = Number(x.sec);
    return { ...x, lap, low: x.hrCoverage != null && x.hrCoverage < HR_MIN_COVERAGE }; });
}

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
  const handoff = location.state?.athleteId ? { id: location.state.athleteId, name: location.state.name || 'Athlete' } : null;

  const [protocols, setProtocols] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [chosen, setChosen] = useState({});
  // The swimmer is the athlete loaded in Athlete Setup — fixed for this page.
  const athletes = useMemo(() => (handoff ? [handoff] : []), [handoff?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const picked = useMemo(() => (handoff ? [handoff.id] : []), [handoff?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [windowMonths, setWindowMonths] = useState(null);
  const [prescription, setPrescription] = useState(null);
  const [prError, setPrError] = useState(null);
  const [runs, setRuns] = useState([]);
  const [openRun, setOpenRun] = useState(null);
  const [runsTick, setRunsTick] = useState(0);
  const [importMsg, setImportMsg] = useState(null);     // { ok, text }

  // Library
  useEffect(() => {
    listProtocols().then(({ data, error }) => {
      if (error) { setLoadError(error.message || 'Could not load the test library'); return; }
      setProtocols(data || []);
      if (data && data.length) setSelectedId((cur) => cur || data[0].id);
    });
  }, []);

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
  }, [protocol, picked, runsTick]);

  // Open Poolside in set mode for one swimmer. The window is opened first,
  // synchronously, so the browser treats it as a direct result of the click
  // (encoding is async and would otherwise trip popup blockers).
  async function timeInPoolside(pAthleteId) {
    const mWin = window.open('', '_blank');
    try {
      const mHandoff = buildHandoff(prescription, pAthleteId);
      const mUrl = '/poolside/#run=' + (await encodeHandoff(mHandoff));
      if (mWin) mWin.location.href = mUrl; else window.location.assign(mUrl);
    } catch (e) {
      if (mWin) mWin.close();
      setImportMsg({ ok: false, text: 'Could not open Poolside: ' + (e.message || e) });
    }
  }

  // Poolside "SwimZone test" file → saved run (idempotent: re-importing is a no-op).
  async function importPoolsideFile(pFile) {
    setImportMsg(null);
    if (!pFile) return;
    let mEnv;
    try { mEnv = JSON.parse(await pFile.text()); } catch { setImportMsg({ ok: false, text: 'That file isn\'t valid JSON.' }); return; }
    if (mEnv.fmt === 'swimzone.import/1') {
      setImportMsg({ ok: false, text: 'That is a plain Poolside session (single swims) — import it in Athlete Setup. Test files come from a test opened with "Time in Poolside".' });
      return;
    }
    const { data, error } = await ingestPoolsideSetResult(mEnv, { expectAthleteId: handoff?.id, fallbackAthleteId: handoff?.id });
    if (error) { setImportMsg({ ok: false, text: error.message || 'Save failed' }); return; }
    const mWho = data.athleteName || 'the swimmer';
    setImportMsg({ ok: true, text: data.alreadyPresent
      ? `Already saved — this ${mEnv.protocolName || 'test'} for ${mWho} is on record.`
      : `Saved ${data.reps} rep${data.reps === 1 ? '' : 's'} of ${mEnv.protocolName || 'the test'} for ${mWho}` +
        (data.missing && data.missing.length ? ` (rep${data.missing.length > 1 ? 's' : ''} ${data.missing.join(', ')} not timed)` : '') +
        (data.summary ? ` — ${headline(data.summary)}` : '') + '.' });
    if (mEnv.protocolId && protocols.some((p) => p.id === mEnv.protocolId)) setSelectedId(mEnv.protocolId);
    setRunsTick((n) => n + 1);
  }

  const grouped = prescription ? groupRows(prescription) : null;
  const unresolved = grouped && grouped.athletes.some((a) => a.athleteId && a.reps.some((r) => r.target && !r.target.resolved && /^PB/.test(r.target.display)));

  return (
    <div style={C.page}>
      <div style={C.wrap}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <button style={C.btn} onClick={() => (handoff ? navigate(-1) : navigate('/athlete-setup'))}>← {handoff ? 'Back to Athlete Setup' : 'Athlete Setup'}</button>
          <h2 style={{ margin: 0, fontSize: 18 }}>Test Sets</h2>
          <span style={C.muted} className="ts-sub">pick a test, see it for the loaded swimmer, time it in Poolside</span>
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

                <span style={{ ...C.label, marginTop: 14 }}>Swimmer</span>
                {handoff
                  ? <div style={{ fontSize: 14 }}>{handoff.name}</div>
                  : <div style={{ ...C.muted }}>
                      No athlete loaded — targets show the rules. Load a swimmer in{' '}
                      <a href="/athlete-setup" onClick={(e) => { e.preventDefault(); navigate('/athlete-setup'); }} style={{ color: '#7fd8e8' }}>Athlete Setup</a>
                      {' '}and open Test Sets from there to see their times and time them in Poolside.
                    </div>}
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
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
                  {prescription && prescription.athletes.length > 0
                    ? prescription.athletes.map((a) => (
                      <button key={a.athleteId} style={{ ...C.btn, background: 'rgba(48,176,199,0.3)', borderColor: 'rgba(48,176,199,0.8)' }}
                        onClick={() => timeInPoolside(a.athleteId)}>
                        ⏱ Time {a.name.replace(' (me)', '')} in Poolside
                      </button>))
                    : <span style={C.muted}>Load a swimmer in Athlete Setup to time this test in Poolside.</span>}
                </div>
                <div style={{ ...C.muted, fontSize: 11, marginTop: 6 }}>
                  Opens Poolside with this exact set. When done, tap Results → SwimZone test, then import that file below.
                </div>
              </div>
            )}

            {protocol && handoff && (
              <div style={C.card}>
                <span style={C.label}>Import Poolside results</span>
                <label style={{ ...C.btn, display: 'inline-block' }}>
                  Choose file…
                  <input type="file" accept=".json,application/json" style={{ display: 'none' }}
                    onChange={(e) => { importPoolsideFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
                </label>
                <span style={{ ...C.muted, marginLeft: 10 }}>the <b>.swimzone-test.json</b> file Poolside saves</span>
                {importMsg && (
                  <div style={{ marginTop: 10, fontSize: 12, color: importMsg.ok ? '#9be29b' : '#ff8a8a' }}>{importMsg.text}</div>
                )}
              </div>
            )}

            {protocol && picked.length > 0 && (
              <div style={C.card}>
                <span style={C.label}>Previous runs · {athletes.find((a) => a.id === picked[0])?.name?.replace(' (me)', '') || 'athlete'}</span>
                {runs.length === 0
                  ? <div style={C.muted}>Not swum yet.</div>
                  : runs.map((r) => {
                    const reps = (r.reps || []).slice().sort((a, b) => a.repNo - b.repNo);
                    const hr = hrLine(reps);
                    const isOpen = openRun === r.id;
                    return (
                      <div key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 12 }}>
                        <div onClick={() => reps.length && setOpenRun(isOpen ? null : r.id)}
                          style={{ display: 'flex', gap: 12, flexWrap: 'wrap', cursor: reps.length ? 'pointer' : 'default' }}>
                          <span style={{ color: 'rgba(255,255,255,0.5)', minWidth: 90 }}>{r.swumOn}</span>
                          <span style={{ flex: 1 }}>{headline(r.summary)}</span>
                          {hr && <span style={{ color: hr.low ? '#f2b654' : '#ff9a63' }}>{hr.text}</span>}
                          {reps.length > 0 && <span style={{ color: 'rgba(255,255,255,0.4)' }}>{isOpen ? 'hide reps ▴' : 'reps ▾'}</span>}
                        </div>
                        {isOpen && (
                          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 11 }}>
                            <thead><tr style={{ color: 'rgba(255,255,255,0.45)' }}>
                              {['Rep', 'Time', 'HR', 'Min', 'Avg', 'Max', '+30 s', 'Cover', 'Other'].map((h) => (
                                <th key={h} style={{ textAlign: h === 'Rep' || h === 'Other' ? 'left' : 'right', fontWeight: 500, padding: '2px 4px' }}>{h}</th>))}
                            </tr></thead>
                            <tbody>
                              {reps.map((x) => {
                                const m = x.metrics || {};
                                const low = m.hrCoverage != null && m.hrCoverage < HR_MIN_COVERAGE;
                                const td = { textAlign: 'right', padding: '2px 4px' };
                                const other = ['lactate', 'rpe', 'sc', 'sr'].filter((k) => m[k] != null)
                                  .map((k) => `${{ lactate: 'La', rpe: 'RPE', sc: 'SC', sr: 'SR' }[k]} ${m[k]}`).join(' · ');
                                const lens = lengthRows(x.splits);
                                return (
                                  <Fragment key={x.id || x.repNo}>
                                  <tr style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                    <td style={{ padding: '2px 4px' }}>{x.repNo}</td>
                                    <td style={td}>{x.timeSec != null ? fmtRep(x.timeSec) : '—'}</td>
                                    <td style={td}>{m.hr ?? '—'}</td>
                                    <td style={td}>{m.hrMin ?? ''}</td>
                                    <td style={td}>{m.hrAvg ?? ''}</td>
                                    <td style={td}>{m.hrPeak ?? ''}</td>
                                    <td style={td}>{m.hrRec30 ?? ''}</td>
                                    <td style={{ ...td, color: low ? '#f2b654' : undefined }}>{m.hrCoverage != null ? `${Math.round(m.hrCoverage * 100)}%` : ''}</td>
                                    <td style={{ padding: '2px 4px', color: 'rgba(255,255,255,0.6)' }}>{other}</td>
                                  </tr>
                                  {lens && (
                                    <tr><td />
                                      <td colSpan={8} style={{ padding: '0 4px 4px', color: 'rgba(255,255,255,0.55)', fontSize: 10.5 }}>
                                        {lens.map((l) => (
                                          <span key={l.dist} style={{ display: 'inline-block', marginRight: 10, whiteSpace: 'nowrap' }}>
                                            {l.dist}m {fmtRep(l.lap)}{l.sc ? ` · SC ${l.sc}` : ''}{l.sr ? ` · SR ${Math.round(l.sr)}` : ''}
                                            {l.hrFirst != null && (
                                              <span style={{ color: l.low ? '#f2b654' : '#ff9a63' }}>{` · ♥ ${l.hrFirst}→${l.hrLast}`}</span>)}
                                          </span>
                                        ))}
                                      </td>
                                    </tr>
                                  )}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
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
