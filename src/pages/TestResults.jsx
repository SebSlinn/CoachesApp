// src/pages/TestResults.jsx  —  /test-sets/results/:protocolId?a=<athleteId>&n=<name>
// One athlete's runs of one test: tick the runs to look at, see them side by
// side (results, rep times chart, rep by rep), open any run in full, and
// download exactly what is ticked as a formatted Excel workbook or a plain CSV.
// Everything on screen and in both downloads comes from records/testReport.js.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getTestHistory } from '../services/protocols';
import { highestHeld } from '../records/testVersions.js';
import { useAthleteContext } from '../records/athleteLink.js';
import { buildRunView, compareRuns, runLabels, toCsv, fmtTime, fmtDelta, exportFileName, fmtDay } from '../records/testReport.js';
import { S, INK, INK_2, INK_3, RULE, GOOD, Crumbs } from '../records/recordsUi.jsx';
import RepTimesChart, { RUN_COLORS } from '../records/RepTimesChart.jsx';

const MAX_CHART = RUN_COLORS.length;
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
  const [protocol, setProtocol] = useState(null);
  const [efforts, setEfforts] = useState(null);
  const [error, setError] = useState(null);
  const [ticked, setTicked] = useState(null);       // Set of run ids; null = all
  const [openId, setOpenId] = useState(null);       // run shown in full
  const [openRep, setOpenRep] = useState(null);     // rep whose lengths are shown
  const [busy, setBusy] = useState('');

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
    } catch (e) { setBusy('Could not build the spreadsheet: ' + (e.message || e)); }
  }
  function downloadCsv() {
    const blob = new Blob([toCsv(meta, chosen)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = exportFileName(meta, 'csv');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

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
                </span>
                <button onClick={() => { setOpenId(v.id); setOpenRep(null); setTimeout(() => document.getElementById('run-h')?.scrollIntoView({ behavior: 'smooth' }), 30); }}
                  style={{ ...btn(false), padding: '4px 10px', fontSize: 11 }}>Open run</button>
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
            <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 360, width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#1a1a2e' }}><tr>
                  <th style={S.th}>Rep</th><th style={S.th}>Swim</th>
                  {cmp.labels.map((l) => <th key={l} style={{ ...S.th, textAlign: 'right', whiteSpace: 'nowrap' }}>{l}</th>)}
                </tr></thead>
                <tbody>
                  {cmp.reps.map((row) => (
                    <tr key={row.repNo}>
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
            <p style={{ ...S.muted, fontSize: 10, marginTop: 6 }}>Green is the fastest run for that rep.</p>
          </section>
        </>
      )}

      {open && <RunDetail run={open} label={labels[views.indexOf(open)]} openRep={openRep} setOpenRep={setOpenRep} />}

      <p style={{ ...S.muted, fontSize: 11, marginTop: 28 }}>
        <Link to="/test-sets" state={{ athleteId, name }} style={S.crumbLink}>Back to Test Sets</Link>
      </p>
    </Shell>
  );
}

// One run in full: what was set, the results, every rep (click a rep for its lengths).
function RunDetail({ run, label, openRep, setOpenRep }) {
  const has = (k) => run.has.includes(k);
  const cols = [
    ['Time', (r) => fmtTime(r.timeSec), true],
    has('targetSec') && ['Target', (r) => fmtTime(r.targetSec)],
    has('vsTargetSec') && ['vs target', (r) => fmtDelta(r.vsTargetSec)],
    has('restSec') && ['Rest after', (r) => (r.restSec == null ? '' : r.restSec.toFixed(1) + ' s')],
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
      <h2 id="run-h" style={S.h2}>Run: {label}</h2>
      <p style={{ ...S.muted, margin: '0 0 12px', lineHeight: 1.6 }}>
        {fmtDay(run.swumOn)}{run.paramText ? `, ${run.paramText}` : ''}{run.poolType ? `, ${run.poolType}` : ''}{run.location ? `, ${run.location}` : ''}.
        {' '}{run.swum} of {run.prescribed} reps timed{run.hasHrStream ? ', heart rate from a sensor' : ''}.
      </p>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '12px 18px', margin: '0 0 16px' }}>
        {run.summaryRows.map((r) => (
          <div key={r.key}>
            <dt style={{ fontSize: 11, color: INK_3 }}>{r.label}{r.unit ? ` (${r.unit})` : ''}</dt>
            <dd style={{ margin: 0, fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: r.kind === 'bool' ? (r.value ? GOOD : '#f2b654') : INK }}>{cellText(r.kind, r.value)}</dd>
          </div>
        ))}
      </dl>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
          <thead><tr>
            <th style={S.th}>Rep</th>
            {cols.map(([h]) => <th key={h} style={{ ...S.th, textAlign: 'right', whiteSpace: 'nowrap' }}>{h}</th>)}
            {has('note') && <th style={S.th}>Note</th>}
          </tr></thead>
          <tbody>
            {run.reps.map((r) => {
              const isOpen = openRep === r.repNo && r.lengths.length;
              const lowHr = r.hrCoverage != null && r.hrCoverage < 0.8;
              return (
                <Fragment key={r.repNo}>
                  <tr onClick={() => r.lengths.length && setOpenRep(isOpen ? null : r.repNo)} style={{ cursor: r.lengths.length ? 'pointer' : 'default' }}>
                    <td style={{ ...S.td, color: INK_3, whiteSpace: 'nowrap' }}>{r.lengths.length ? (isOpen ? '▾ ' : '▸ ') : ''}{r.repNo}{r.extra ? ' extra' : ''}</td>
                    {cols.map(([h, get, bold]) => (
                      <td key={h} style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: bold ? 700 : 400,
                        color: h === 'HR cover' && lowHr ? '#f2b654' : (h === 'vs target' && r.vsTargetSec != null ? (r.vsTargetSec <= 0 ? GOOD : INK_2) : INK) }}>{get(r)}</td>
                    ))}
                    {has('note') && <td style={{ ...S.td, color: INK_2 }}>{r.note}</td>}
                  </tr>
                  {isOpen ? (
                    <tr><td />
                      <td colSpan={cols.length + (has('note') ? 1 : 0)} style={{ ...S.td, color: INK_2, fontSize: 11 }}>
                        {r.lengths.map((l) => (
                          <span key={l.dist} style={{ display: 'inline-block', marginRight: 14, whiteSpace: 'nowrap' }}>
                            {l.dist}m <b style={{ color: INK }}>{fmtTime(l.lapSec)}</b>{l.sc != null ? ` · ${l.sc} strokes` : ''}{l.sr != null ? ` · rate ${Math.round(l.sr)}` : ''}{l.hrFirst != null ? ` · HR ${l.hrFirst}→${l.hrLast}` : ''}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ ...S.muted, fontSize: 10, marginTop: 6 }}>
        {anyLengths ? 'Click a rep to see its lengths. ' : ''}Rest after is what was left of the send-off once the rep was finished (send-off minus swim time): the rest before the next rep.{has('hrCoverage') ? ' Amber HR cover means the sensor dropped out for part of the rep.' : ''}
      </p>
    </section>
  );
}

function Shell({ children }) {
  return <div style={S.page}><main style={{ ...S.wrap, maxWidth: 980 }}>{children}</main></div>;
}
