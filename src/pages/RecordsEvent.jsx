// src/pages/RecordsEvent.jsx  —  /athlete-records/event/:event  (e.g. 100-FS)
// One event for one athlete: PB per course, every swim on a course-aware trend
// (faster = higher), and the full list. Each swim opens its own page.
// The athlete comes from router state or ?a=<id>&n=<name> (see athleteLink.js).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getResultHistory } from '../services/results.js';
import { useAthleteContext, recordsHref, recordsPaths } from '../records/athleteLink.js';
import { parseEventSlug, eventTitle, annotateEvent, eventSummary, courseOrder, COURSE_LABEL, kindLabel } from '../records/eventView.js';
import { S, INK, INK_2, INK_3, RULE, GOOD, COURSE_COLOR, fmtSwim, Crumbs, CourseSwatch, CourseTag, fmtDate, fmtGain } from '../records/recordsUi.jsx';
import ProgressionChart from '../records/ProgressionChart.jsx';

const WINDOWS = [{ v: 12, l: '12 months' }, { v: 36, l: '3 years' }, { v: null, l: 'All time' }];
const monthsSince = (iso) => { const t = Date.parse(iso); return isNaN(t) ? Infinity : (Date.now() - t) / (864e5 * 30.4375); };

export default function RecordsEvent() {
  const { event } = useParams();
  const navigate = useNavigate();
  const { athleteId, name } = useAthleteContext();
  const ev = parseEventSlug(event);

  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [courses, setCourses] = useState(null);        // null = all present
  const [windowMonths, setWindowMonths] = useState(null);

  useEffect(() => {
    if (!athleteId || !ev) return;
    let cancelled = false;
    getResultHistory(athleteId, { stroke: ev.stroke, distM: ev.distM }).then(({ data, error: e }) => {
      if (cancelled) return;
      if (e) setError(e.message || 'Could not load this event.');
      setRows(data || []);
    });
    return () => { cancelled = true; };
  }, [athleteId, event]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Annotate over ALL swims (so "PB on the day" is true history), then window.
  const all = useMemo(() => annotateEvent(rows || []), [rows]);
  const summary = useMemo(() => eventSummary(all), [all]);
  const present = courseOrder(summary);
  const shown = courses || present;
  const inWin = (r) => windowMonths == null || monthsSince(r.swumOn) <= windowMonths;
  const visible = all.filter(inWin);
  const listed = visible.filter((r) => shown.includes(r.course)).slice().reverse();

  const overview = recordsHref(recordsPaths.overview, athleteId, name);
  const openSwim = (r) => navigate(recordsHref(recordsPaths.swim(r.id), athleteId, name));
  const toggleCourse = (c) => {
    const cur = courses || present;
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
    setCourses(next.length ? next : present);
  };

  if (!ev) return <Shell><p style={S.muted}>That isn’t an event address. Open an event from the athlete’s records.</p></Shell>;
  if (!athleteId) return <Shell><p style={S.muted}>No athlete selected. Open this page from an athlete’s records.</p><Link to="/athlete-setup" style={S.crumbLink}>Go to Athlete Setup</Link></Shell>;

  const title = eventTitle(ev.stroke, ev.distM);

  return (
    <Shell>
      <Crumbs items={[{ label: name, to: overview }, { label: title }]} />

      <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.01em', margin: '0 0 18px' }}>{title}</h1>

      {error && <p style={{ color: '#f88', fontSize: 12 }}>{error}</p>}
      {rows == null && !error && <p style={S.muted}>Loading swims…</p>}
      {rows && rows.length === 0 && (
        <p style={S.muted}>No {title} swims on record yet. Times arrive from SwimmingResults imports, typed trials in Athlete Setup, or Poolside.</p>
      )}

      {present.length > 0 && (
        <>
          {/* Headline: the PB in each course — the number a coach looks for first. */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))`, gap: 18, marginBottom: 6 }}>
            {present.map((c) => {
              const s = summary[c];
              return (
                <div key={c} style={{ borderLeft: '3px solid ' + (COURSE_COLOR[c] || RULE), paddingLeft: 12 }}>
                  <div style={{ fontSize: 11, color: INK_2 }}>{COURSE_LABEL[c]} best</div>
                  {s.pb ? (
                    <Link to={recordsHref(recordsPaths.swim(s.pb.id), athleteId, name)} style={{ color: INK, textDecoration: 'none' }}>
                      <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{fmtSwim(s.pb.timeSec)}</div>
                    </Link>
                  ) : <div style={{ fontSize: 22, color: INK_3 }}>—</div>}
                  <div style={{ fontSize: 11, color: INK_3, lineHeight: 1.6 }}>
                    {s.pb && <>{fmtDate(s.pb.swumOn)}{s.pb.provenance?.meetName ? ' at ' + s.pb.provenance.meetName : ''}<br /></>}
                    {s.count} swim{s.count === 1 ? '' : 's'}
                    {s.totalGainSec ? `, ${s.totalGainSec.toFixed(2)} s faster than the first` : ''}
                  </div>
                </div>
              );
            })}
          </div>

          <section style={S.section} aria-labelledby="trend-h">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 id="trend-h" style={{ ...S.h2, margin: 0 }}>Progression</h2>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {WINDOWS.map((w) => <button key={w.l} onClick={() => setWindowMonths(w.v)} style={S.chip(windowMonths === w.v)} aria-pressed={windowMonths === w.v}>{w.l}</button>)}
              </div>
            </div>
            {/* Legend doubles as the course filter. */}
            {present.length > 1 && (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 6, fontSize: 11 }}>
                {present.map((c) => {
                  const on = shown.includes(c);
                  return (
                    <button key={c} onClick={() => toggleCourse(c)} aria-pressed={on}
                      style={{ background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, color: on ? INK_2 : INK_3, textDecoration: on ? 'none' : 'line-through' }}>
                      <CourseSwatch course={c} />{COURSE_LABEL[c]}
                    </button>
                  );
                })}
              </div>
            )}
            <ProgressionChart rows={visible} courses={shown} onSelect={openSwim} />
            <p style={{ ...S.muted, fontSize: 10, marginTop: 4 }}>Filled points were a personal best on the day. Click a point to open that swim.</p>
          </section>

          <section style={S.section} aria-labelledby="swims-h">
            <h2 id="swims-h" style={S.h2}>Every swim <span style={{ color: INK_3, fontWeight: 400 }}>({listed.length})</span></h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                <thead><tr>
                  <th style={S.th}>Date</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Time</th>
                  <th style={S.th}>Course</th>
                  <th style={{ ...S.th, textAlign: 'right' }} title="Against the course best before this swim">vs PB then</th>
                  <th style={S.th}>Where</th>
                </tr></thead>
                <tbody>
                  {listed.map((r) => (
                    <tr key={r.id} onClick={() => openSwim(r)} style={{ cursor: 'pointer' }}>
                      <td style={S.td}><Link to={recordsHref(recordsPaths.swim(r.id), athleteId, name)} onClick={(e) => e.stopPropagation()} style={{ color: INK, textDecoration: 'none' }}>{fmtDate(r.swumOn)}</Link></td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtSwim(r.timeSec)}
                      </td>
                      <td style={S.td}><CourseTag course={r.course} /></td>
                      <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.isPB ? GOOD : INK_3 }}>
                        {r.isPB ? (r.gainSec != null ? 'PB ' + fmtGain(r.gainSec) : 'First swim') : (r.prevBest != null ? fmtGain(r.prevBest - Number(r.timeSec)) : '')}
                      </td>
                      <td style={{ ...S.td, color: INK_2, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.provenance?.meetName || kindLabel(r)}{r.effort && r.effort !== 'maximal' ? ` (${r.effort})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ ...S.muted, fontSize: 10, marginTop: 6 }}>“vs PB then” compares each swim with the best time in the same course before it: −1.20 is 1.20 s faster.</p>
          </section>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return <div style={S.page}><main style={S.wrap}>{children}</main></div>;
}
