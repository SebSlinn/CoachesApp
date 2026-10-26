// src/pages/TestResults.jsx  —  /test-sets/results/:protocolId?a=<athleteId>&n=<name>
// One athlete's runs of one test: tick the runs to look at, see them side by
// side (results, rep times chart, rep by rep), open any run in full, and
// download exactly what is ticked as a formatted Excel workbook or a plain CSV.
// Everything on screen and in both downloads comes from records/testReport.js.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getTestHistory } from '../services/protocols';
import { deleteSetResult } from '../services/results';
import { getDisplayNames } from '../services/users';
import { useAuth } from '../hooks/useAuth';
import { highestHeld } from '../records/testVersions.js';
import { isStaleBuildError, reloadForNewVersion } from '../lib/staleBuild.js';
import { useAthleteContext } from '../records/athleteLink.js';
import { buildRunView, compareRuns, runLabels, toCsv, fmtTime, fmtDelta, exportFileName, fmtDay } from '../records/testReport.js';
import { S, INK, INK_2, INK_3, RULE, GOOD, Crumbs } from '../records/recordsUi.jsx';
import RepTimesChart, { RUN_COLORS } from '../records/RepTimesChart.jsx';

const MAX_CHART = RUN_COLORS.length;
// Tables scroll inside a box as tall as the screen, headings stuck to the top —
// so the data gets the space, like a spreadsheet.
const GRID_BOX = { overflow: 'auto', maxHeight: 'calc(100vh - 96px)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6 };
const DENSE = { paddingTop: 4, paddingBottom: 4 };   // tighter rows in the rep grid
const STICKY_TH = { position: 'sticky', top: 0, background: '#20203a', zIndex: 1 };
// The results worth seeing at a glance, per analyser; the rest sit behind "All results".
const KEY_RESULTS = {
  ladder: ['held', 'per100Sec', 'fadeSec', 'minRestSec', 'repsInsideSendOff'],
  series: ['meanSec', 'fastestSec', 'bestVsPbSec', 'spreadSec', 'driftSecPerRep'],
  step: ['pace100At4mmolSec', 'peakHr', 'lastStepSec'],
  css: ['cssPer100Sec', 't400Sec', 't200Sec'],
  'double-distance': ['timeSec', 'vsTargetSec', 'fadeSec'],
  blocks: ['dropOffSec', 'dropOffSc'],
  swolf: ['bestSwolf', 'meanSwolf', 'lastSec', 'lastVsTargetSec'],
  maxhr: ['peakHr', 'peakRepNo'],
};
const btn = (primary) => ({ padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
  border: '1px solid ' + (primary ? 'rgba(48,176,199,0.8)' : 'rgba(255,255,255,0.22)'),
  background: primary ? 'rgba(48,176,199,0.28)' : 'transparent', color: INK });

function cellText(kind, v) {
  if (v == null) return '—';
  if (kind === 'time') return fmtTime(v);
  if (kind === 'delta') return fmtDelta(v);
  if (kind === 'sec') return Number(v).toFixed(2);
  if (kind === 'bool') return v ? 'Yes' : 'No';
  return typeof v === 'number' && !Number.isInteger(v) ? String(Math.round(v * 10) / 10) : String(v);
}

export default function TestResults() {
  const { protocolId } = useParams();
  const { athleteId, name } = useAthleteContext();
  const { user } = useAuth();
  const [protocol, setProtocol] = useState(null);
  const [efforts, setEfforts] = useState(null);
  const [error, setError] = useState(null);
  const [ticked, setTicked] = useState(null);       // Set of run ids; null = all
  const [openId, setOpenId] = useState(null);       // run shown in full
  const [openRep, setOpenRep] = useState(null);     // rep whose lengths are shown
  const [busy, setBusy] = useState('');
  const [confirmId, setConfirmId] = useState(null);   // run awaiting delete confirm
  const [removing, setRemoving] = useState(false);
  const [removeErr, setRemoveErr] = useState(null);
  const [names, setNames] = useState({});            // { userId: public display name }

  useEffect(() => {
    if (!athleteId || !protocolId) return;
    let cancelled = false;
    // every version that is still the same test (e.g. a ladder that only gained levels)
    getTestHistory(protocolId, athleteId).then(({ data, error: e }) => {
      if (cancelled) return;
      if (e) { setError(e.message || 'Could not load this test.'); setEfforts([]); return; }
      setProtocol(data.protocol);
      setEfforts(data.efforts);
    });
    return () => { cancelled = true; };
  }, [athleteId, protocolId]);

  // Resolve the public name of whoever imported each run ("Added by") — any user,
  // not just coaches. Names only — never email; an id with no name set shows as
  // "a user".
  useEffect(() => {
    const ids = [...new Set((efforts || []).map((e) => e.createdBy).filter(Boolean))];
    if (!ids.length) return;
    let cancelled = false;
    getDisplayNames(ids).then(({ data }) => { if (!cancelled && data) setNames((prev) => ({ ...prev, ...data })); });
    return () => { cancelled = true; };
  }, [efforts]);

  const views = useMemo(() => (protocol && efforts ? efforts.map((e) => buildRunView(protocol, e))
    .sort((a, b) => (a.swumOn < b.swumOn ? -1 : 1)) : []), [protocol, efforts]);
  const labels = useMemo(() => runLabels(views), [views]);
  const isTicked = (id) => !ticked || ticked.has(id);
  const chosen = views.filter((v) => isTicked(v.id));
  const cmp = useMemo(() => (chosen.length ? compareRuns(chosen) : null), [chosen.map((v) => v.id).join()]);   // eslint-disable-line react-hooks/exhaustive-deps
  const open = views.find((v) => v.id === openId) || chosen[chosen.length - 1] || null;
  const chartRuns = cmp ? cmp.runs.slice(-MAX_CHART) : [];
  const chartLabels = cmp ? cmp.labels.slice(-MAX_CHART) : [];

  const held = protocol ? highestHeld(protocol, views) : null;
  const heldText = held ? `${held.label}, first held ${fmtDay(held.swumOn)}` : null;
  const meta = { athleteName: name, testName: protocol?.name || 'Test', testKey: protocol?.key || 'test', testVersion: protocol?.version || 1, highestHeld: heldText };
  const toggle = (id) => {
    const next = new Set(ticked || views.map((v) => v.id));
    next.has(id) ? next.delete(id) : next.add(id);
    setTicked(next);
  };

  async function downloadExcel() {
    setBusy('Preparing the spreadsheet…');
    try {
      const { downloadWorkbook } = await import('../records/testWorkbook.js');
      await downloadWorkbook(meta, chosen, exportFileName(meta, 'xlsx'));
      setBusy('');
    } catch (e) {
      if (isStaleBuildError(e)) {
        setBusy('SwimZone has been updated since this page was opened. Reloading, then press Download Excel again.');
        if (!reloadForNewVersion()) setBusy('SwimZone has been updated. Please reload the page (Ctrl+F5) and try again.');
        return;
      }
      setBusy('Could not build the spreadsheet: ' + (e.message || e));
    }
  }
  function downloadCsv() {
    const blob = new Blob([toCsv(meta, chosen)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = exportFileName(meta, 'csv');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // Remove a whole run (set_efforts parent + its reps via FK cascade). Drops it
  // from the list in place; no refetch. Clears it from the open/ticked state too.
  async function removeRun(id) {
    setRemoving(true); setRemoveErr(null);
    const { data, error: e } = await deleteSetResult(id);
    setRemoving(false);
    if (e) { setRemoveErr(e.message || 'Could not remove this run.'); return; }
    if (!data || data.deleted === 0) { setRemoveErr('Nothing was removed — it may already be gone, or you may not have permission.'); return; }
    setConfirmId(null);
    setEfforts((prev) => (prev || []).filter((x) => x.id !== id));
    if (openId === id) setOpenId(null);
    setTicked((prev) => { if (!prev) return prev; const n = new Set(prev); n.delete(id); return n; });
  }

  // "Added by {who} · {date}" for a run — who is 'you' for the current user,
  // else their public name, else "a user" (whoever imported it — coach, parent
  // or the athlete). Never shows an email.
  const addedBy = (v) => {
    if (!v) return null;
    const who = v.createdBy ? (user && v.createdBy === user.id ? 'you' : (names[v.createdBy] || 'a user')) : null;
    const when = v.createdAt ? fmtDay(String(v.createdAt).slice(0, 10)) : null;
    if (!who && !when) return null;
    return `Added${who ? ' by ' + who : ''}${when ? ' · ' + when : ''}`;
  };

  const back = { label: 'Test Sets', to: '/test-sets', state: { athleteId, name } };
  if (!athleteId) return <Shell><p style={S.muted}>No athlete selected. Open this from Test Sets with a swimmer loaded.</p></Shell>;

  return (
    <Shell>
      <Crumbs items={[{ label: name }, back, { label: protocol?.name || 'Results' }]} />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>{protocol?.name || 'Test results'}</h1>
          <p style={{ ...S.muted, margin: '6px 0 0' }}>{name}{views.length ? ` · ${views.length} run${views.length === 1 ? '' : 's'}` : ''}{protocol ? ` · ${protocol.key} v${protocol.version}` : ''}</p>
          {held && <p style={{ margin: '8px 0 0', fontSize: 13 }}>Highest level held: <b style={{ color: GOOD }}>{held.label}</b> <span style={{ color: INK_3 }}>(first held {fmtDay(held.swumOn)})</span></p>}
        </div>
        {chosen.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={btn(true)} onClick={downloadExcel} disabled={!!busy && busy.startsWith('Preparing')}>Download Excel</button>
            <button style={btn(false)} onClick={downloadCsv}>Download CSV</button>
          </div>
        )}
      </div>
      {chosen.length > 0 && <p style={{ ...S.muted, fontSize: 11, margin: '8px 0 0', textAlign: 'right' }}>{busy || `Downloads include the ${chosen.length} ticked run${chosen.length === 1 ? '' : 's'}.`}</p>}

      {error && <p style={{ color: '#f88', fontSize: 12 }}>{error}</p>}
      {!efforts && !error && <p style={S.muted}>Loading runs…</p>}
      {efforts && views.length === 0 && (
        <p style={{ ...S.muted, marginTop: 20 }}>{name} hasn’t swum this test yet. Time it from Test Sets with Poolside, then import the file there.</p>
      )}

      {views.length > 0 && (
        <section style={S.section} aria-labelledby="runs-h">
          <h2 id="runs-h" style={S.h2}>Runs</h2>
          <div style={{ display: 'grid', gap: 6 }}>
            {views.map((v, i) => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 7,
                border: '1px solid ' + (open && open.id === v.id ? 'rgba(48,176,199,0.5)' : RULE), background: open && open.id === v.id ? 'rgba(48,176,199,0.08)' : 'transparent' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, minWidth: 190 }}>
                  <input type="checkbox" checked={isTicked(v.id)} onChange={() => toggle(v.id)} style={{ accentColor: '#30b0c7', width: 16, height: 16 }} />
                  <span style={{ fontWeight: 700 }}>{labels[i]}</span>
                </label>
                <span style={{ fontSize: 12, color: INK_2, flex: 1, minWidth: 180 }}>
                  {v.summary?.held === true && <span style={{ color: GOOD, marginRight: 8 }}>Held</span>}
                  {v.summary?.held === false && <span style={{ color: '#f2b654', marginRight: 8 }}>Not held</span>}
                  {v.summaryRows.filter((r) => r.kind === 'time').slice(0, 1).map((r) => <span key={r.key}>{r.label.toLowerCase()} {fmtTime(r.value)}</span>)}
                  <span style={{ color: INK_3 }}> · {v.swum} of {v.prescribed} timed</span>
                  {addedBy(v) && <span style={{ color: INK_3 }}> · {addedBy(v)}</span>}
                </span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={() => { setOpenId(v.id); setOpenRep(null); setTimeout(() => document.getElementById('run-h')?.scrollIntoView({ behavior: 'smooth' }), 30); }}
                    style={{ ...btn(false), padding: '4px 10px', fontSize: 11 }}>Open run</button>
                  {confirmId === v.id ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, flexWrap: 'wrap' }}>
                      <span style={{ color: '#f2b654' }}>Remove {labels[i]} ({v.swum}/{v.prescribed} timed)?</span>
                      <button disabled={removing} onClick={() => removeRun(v.id)}
                        style={{ ...btn(false), padding: '4px 10px', fontSize: 11, borderColor: 'rgba(255,120,120,0.6)', color: '#f88' }}>{removing ? 'Removing…' : 'Yes, remove'}</button>
                      <button disabled={removing} onClick={() => { setConfirmId(null); setRemoveErr(null); }}
                        style={{ ...btn(false), padding: '4px 10px', fontSize: 11 }}>Cancel</button>
                      {removeErr && <span style={{ color: '#f88' }}>{removeErr}</span>}
                    </span>
                  ) : (
                    <button onClick={() => { setConfirmId(v.id); setRemoveErr(null); }}
                      style={{ ...btn(false), padding: '4px 10px', fontSize: 11, color: INK_3 }}>Remove</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {cmp && cmp.runs.length > 1 && (
        <>
          <section style={S.section} aria-labelledby="side-h">
            <h2 id="side-h" style={S.h2}>Side by side</h2>
            {cmp.levelsDiffer && <p style={{ fontSize: 11, color: '#f2b654', margin: '0 0 10px' }}>These runs are at different levels. A tighter send-off means a slower pace, so compare fade, rest and stroke count across levels, and pace only within one.</p>}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 190 + cmp.runs.length * 112 + 70, width: '100%' }}>
                <thead><tr>
                  <th style={{ ...S.th, position: 'sticky', left: 0, background: '#1a1a2e' }}>Measure</th>
                  {cmp.labels.map((l) => <th key={l} style={{ ...S.th, textAlign: 'right', whiteSpace: 'nowrap' }}>{l}</th>)}
                  <th style={{ ...S.th, textAlign: 'right' }}>Change</th>
                </tr></thead>
                <tbody>
                  {cmp.summary.map((row) => (
                    <tr key={row.key}>
                      <td style={{ ...S.td, color: INK_2, minWidth: 170, position: 'sticky', left: 0, background: '#1a1a2e' }}>{row.label}{row.unit ? <span style={{ color: INK_3 }}> ({row.unit})</span> : null}</td>
                      {row.values.map((v, i) => {
                        const best = row.best.includes(i);
                        return <td key={i} style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: best ? 700 : 400, color: best ? GOOD : (v == null ? INK_3 : INK) }}>{cellText(row.kind, v)}</td>;
                      })}
                      <td style={{ ...S.td, textAlign: 'right', color: INK_3, fontVariantNumeric: 'tabular-nums' }}>{row.change == null ? '' : (row.kind === 'num' ? (row.change > 0 ? '+' : '') + Math.round(row.change * 10) / 10 : fmtDelta(row.change))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ ...S.muted, fontSize: 10, marginTop: 6 }}>Green is the best run for each measure. Change is the newest run minus the oldest.</p>
          </section>

          <section style={S.section} aria-labelledby="chart-h">
            <h2 id="chart-h" style={S.h2}>Rep times{cmp.runs.length > MAX_CHART ? <span style={{ color: INK_3, fontWeight: 400 }}> (newest {MAX_CHART} of {cmp.runs.length} ticked)</span> : null}</h2>
            <RepTimesChart runs={chartRuns} labels={chartLabels} />
          </section>

          <section style={S.section} aria-labelledby="reps-h">
            <h2 id="reps-h" style={S.h2}>Rep by rep</h2>
            <div style={GRID_BOX}>
              <table style={{ borderCollapse: 'collapse', minWidth: 360, width: '100%' }}>
                <thead style={STICKY_TH}><tr>
                  <th style={S.th}>Rep</th><th style={S.th}>Swim</th>
                  {cmp.labels.map((l) => <th key={l} style={{ ...S.th, textAlign: 'right', whiteSpace: 'nowrap' }}>{l}</th>)}
                </tr></thead>
                <tbody>
                  {cmp.rows.map((row) => row.kind === 'flush' ? (
                    // a flush between reps: inline, so rep N stays next to rep N in every run
                    <tr key={row.key}>
                      <td style={{ ...S.td, color: INK_3 }} />
                      <td style={{ ...S.td, color: INK_3, fontStyle: 'italic', whiteSpace: 'nowrap' }}>flush</td>
                      {row.cells.map((c, i) => (
                        <td key={i} style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: INK_3, fontStyle: 'italic' }}>
                          {c ? `${c.distM ? c.distM + ' ' : ''}${c.timeSec != null ? fmtTime(c.timeSec) : ''}${c.count > 1 ? ` (${c.count})` : ''}` : ''}
                        </td>
                      ))}
                    </tr>
                  ) : (
                    <tr key={row.key}>
                      <td style={{ ...S.td, color: INK_3 }}>{row.repNo}</td>
                      <td style={{ ...S.td, color: INK_2, whiteSpace: 'nowrap' }}>{row.swim}{row.extra ? ' (extra)' : ''}</td>
                      {row.times.map((t, i) => {
                        const best = row.best.includes(i);
                        const untimed = t == null && row.repNo <= (cmp.runs[i].prescribed || 0);
                        return <td key={i} style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: best ? 700 : 400, color: best ? GOOD : (t == null ? INK_3 : INK), fontStyle: untimed ? 'italic' : 'normal' }}>{t != null ? fmtTime(t) : (untimed ? 'not timed' : '')}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ ...S.muted, fontSize: 10, marginTop: 6 }}>Green is the fastest run for that rep.{cmp.rows.some((r) => r.kind === 'flush') ? ' Flush rows are active recovery between reps: they take no rep number, so the reps stay lined up.' : ''}</p>
          </section>
        </>
      )}

      {open && <RunDetail run={open} label={labels[views.indexOf(open)]} openRep={openRep} setOpenRep={setOpenRep} addedByText={addedBy(open)} />}

      <p style={{ ...S.muted, fontSize: 11, marginTop: 28 }}>
        <Link to="/test-sets" state={{ athleteId, name }} style={S.crumbLink}>Back to Test Sets</Link>
      </p>
    </Shell>
  );
}

// One run in full: what was set, the results, every rep (click a rep for its lengths).
function RunDetail({ run, label, openRep, setOpenRep, addedByText }) {
  const has = (k) => run.has.includes(k);
  const [showAll, setShowAll] = useState(false);
  const keys = KEY_RESULTS[run.summary?.analyser] || run.summaryRows.slice(0, 4).map((r) => r.key);
  const keyRows = keys.map((k) => run.summaryRows.find((r) => r.key === k)).filter(Boolean);
  const valueStyle = (r) => ({ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: r.kind === 'bool' ? (r.value ? GOOD : '#f2b654') : INK });
  const cols = [
    ['Time', (r) => fmtTime(r.timeSec), true],
    has('targetSec') && ['Target', (r) => fmtTime(r.targetSec)],
    has('vsTargetSec') && ['vs target', (r) => fmtDelta(r.vsTargetSec)],
    has('restSec') && ['Rest after', (r) => (r.restSec == null ? '' : (r.restFrom === 'send-off' ? '≈' : '') + r.restSec.toFixed(1) + ' s')],
    run.reps.some((r) => r.distM !== 100) && ['Pace /100', (r) => fmtTime(r.pace100Sec)],
    has('sc') && ['Strokes', (r) => r.sc ?? ''],
    has('sr') && ['Rate', (r) => (r.sr == null ? '' : Math.round(r.sr))],
    has('hrAvg') && ['HR avg', (r) => r.hrAvg ?? ''],
    has('hrPeak') && ['HR peak', (r) => r.hrPeak ?? ''],
    has('hrRec30') && ['HR +30 s', (r) => r.hrRec30 ?? ''],
    has('hrCoverage') && ['HR cover', (r) => (r.hrCoverage == null ? '' : Math.round(r.hrCoverage * 100) + '%')],
    run.reps.some((r) => r.hr != null && r.hr !== r.hrEnd) && ['HR', (r) => (r.hr != null && r.hr !== r.hrEnd ? r.hr : '')],
    has('lactate') && ['Lactate', (r) => r.lactate ?? ''],
    has('rpe') && ['RPE', (r) => r.rpe ?? ''],
  ].filter(Boolean);
  const anyLengths = run.reps.some((r) => r.lengths.length);
  return (
    <section style={S.section} aria-labelledby="run-h">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 10px', marginBottom: 8 }}>
        <h2 id="run-h" style={{ ...S.h2, margin: 0 }}>Run: {label}</h2>
        <span style={{ ...S.muted, fontSize: 11 }}>
          {[run.paramText, run.poolType, run.location, `${run.swum} of ${run.prescribed} timed`, run.hasHrStream ? 'HR sensor' : null, addedByText].filter(Boolean).join(' · ')}
        </span>
      </div>
      {/* key results in one row; the full list on demand */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', alignItems: 'baseline', fontSize: 12, marginBottom: 10 }}>
        {keyRows.map((r) => (
          <span key={r.key} style={{ whiteSpace: 'nowrap' }}>
            <span style={{ color: INK_3 }}>{r.label}{r.unit ? ` (${r.unit})` : ''} </span>
            <span style={valueStyle(r)}>{cellText(r.kind, r.value)}</span>
          </span>
        ))}
        {run.summaryRows.length > keyRows.length && (
          <button onClick={() => setShowAll((x) => !x)} aria-expanded={showAll}
            style={{ background: 'none', border: 'none', color: '#8fd6e4', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, padding: 0 }}>
            {showAll ? 'Hide results' : `All results (${run.summaryRows.length})`}
          </button>
        )}
      </div>
      {showAll && (
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '4px 18px', margin: '0 0 12px', fontSize: 12 }}>
          {run.summaryRows.map((r) => (
            <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '3px 0' }}>
              <dt style={{ color: INK_3 }}>{r.label}{r.unit ? ` (${r.unit})` : ''}</dt>
              <dd style={{ margin: 0, ...valueStyle(r) }}>{cellText(r.kind, r.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      <div style={GRID_BOX}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
          <thead style={STICKY_TH}><tr>
            <th style={S.th}>Rep</th>
            {cols.map(([h]) => <th key={h} style={{ ...S.th, textAlign: 'right', whiteSpace: 'nowrap' }}>{h}</th>)}
            {has('note') && <th style={S.th}>Note</th>}
          </tr></thead>
          <tbody>
            {(run.flushes || []).filter((f) => f.afterRepNo === 0).map((f, i) => <FlushRow key={`f0-${i}`} f={f} span={cols.length + (has('note') ? 1 : 0)} />)}
            {run.reps.map((r) => {
              const isOpen = openRep === r.repNo && r.lengths.length;
              const lowHr = r.hrCoverage != null && r.hrCoverage < 0.8;
              return (
                <Fragment key={r.repNo}>
                  <tr onClick={() => r.lengths.length && setOpenRep(isOpen ? null : r.repNo)} style={{ cursor: r.lengths.length ? 'pointer' : 'default' }}>
                    <td style={{ ...S.td, ...DENSE, color: INK_3, whiteSpace: 'nowrap' }}>{r.lengths.length ? (isOpen ? '▾ ' : '▸ ') : ''}{r.repNo}{r.extra ? ' extra' : ''}</td>
                    {cols.map(([h, get, bold]) => (
                      <td key={h} style={{ ...S.td, ...DENSE, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: bold ? 700 : 400,
                        color: h === 'HR cover' && lowHr ? '#f2b654' : (h === 'vs target' && r.vsTargetSec != null ? (r.vsTargetSec <= 0 ? GOOD : INK_2) : INK) }}>{get(r)}</td>
                    ))}
                    {has('note') && <td style={{ ...S.td, ...DENSE, color: INK_2, minWidth: 220, maxWidth: 420, fontSize: 11 }}>{r.note}</td>}
                  </tr>
                  {isOpen ? (
                    <tr><td />
                      <td colSpan={cols.length + (has('note') ? 1 : 0)} style={{ ...S.td, ...DENSE, color: INK_2, fontSize: 11 }}>
                        {r.lengths.map((l) => (
                          <span key={l.dist} style={{ display: 'inline-block', marginRight: 14, whiteSpace: 'nowrap' }}>
                            {l.dist}m <b style={{ color: INK }}>{fmtTime(l.lapSec)}</b>{l.sc != null ? ` · ${l.sc} strokes` : ''}{l.sr != null ? ` · rate ${Math.round(l.sr)}` : ''}{l.hrFirst != null ? ` · HR ${l.hrFirst}→${l.hrLast}` : ''}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ) : null}
                  {(r.flushAfter || []).map((f, i) => <FlushRow key={`f-${i}`} f={f} span={cols.length + (has('note') ? 1 : 0)} />)}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ ...S.muted, fontSize: 10, marginTop: 6 }}>
        {anyLengths ? 'Click a rep to see its lengths. ' : ''}{!has('restSec') ? '' : run.reps.some((r) => r.restFrom === 'measured') ? 'Rest after is from finishing a rep to starting the next, from the Poolside start times. ' : run.reps.some((r) => r.restFrom === 'send-off') ? 'Rest after (≈) is estimated as send-off minus swim time: this run was saved without start times; re-import its Poolside file in Test Sets to measure it. ' : ''}{has('restSec') ? 'None after the last rep.' : ''}{has('hrCoverage') ? ' Amber HR cover means the sensor dropped out for part of the rep.' : ''}
      </p>
    </section>
  );
}

// A flush (active recovery between reps) inline in the rep table. No rep number.
function FlushRow({ f, span }) {
  return (
    <tr>
      <td style={{ ...S.td, ...DENSE, color: INK_3, fontStyle: 'italic' }}>flush</td>
      <td colSpan={span} style={{ ...S.td, ...DENSE, color: INK_3, fontStyle: 'italic' }}>
        {[f.distM ? `${f.distM}m` : null, f.timeSec != null ? fmtTime(f.timeSec) : null, 'active recovery — counted in the rest, not as a rep'].filter(Boolean).join(' · ')}
      </td>
    </tr>
  );
}

function Shell({ children }) {
  return <div style={S.page}><main style={{ ...S.wrap, maxWidth: 980 }}>{children}</main></div>;
}
