// src/pages/RecordsSwim.jsx  —  /athlete-records/swim/:swimId
// One swim in full: the time, what it meant on the day (PB? how far off?),
// where it was swum and how it was recorded, lap splits and any readings
// (stroke count/rate, heart rate, lactate). Steps to the previous/next swim of
// the same event. Read-only: swims are evidence and are never edited here.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getResultHistory } from '../services/results.js';
import { useAthleteContext, recordsHref, recordsPaths } from '../records/athleteLink.js';
import { annotateEvent, eventSlug, eventTitle, COURSE_LABEL, kindLabel, lapSplits, METRIC_LABEL, METRIC_UNIT } from '../records/eventView.js';
import { S, INK, INK_2, INK_3, GOOD, Crumbs, CourseTag, fmtDate, fmtSwim } from '../records/recordsUi.jsx';

const SOURCE_LABEL = { import: 'Imported from SwimmingResults.org', manual: 'Typed in by a coach', stopwatch: 'Timed on Poolside' };
const EFFORT_LABEL = { maximal: 'Flat out (counts for PBs)', submaximal: 'Not flat out (never counts as a PB)', unknown: 'Effort not recorded' };
const SPLIT_EXTRAS = { sc: 'Strokes', sr: 'Rate', hrFirst: 'HR in', hrLast: 'HR out' };

export default function RecordsSwim() {
  const { swimId } = useParams();
  const { athleteId, name } = useAthleteContext();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    getResultHistory(athleteId, {}).then(({ data, error: e }) => {
      if (cancelled) return;
      if (e) setError(e.message || 'Could not load this swim.');
      setRows(data || []);
    });
    return () => { cancelled = true; };
  }, [athleteId]);

  // The swim, set in its event's history so "PB on the day" is known.
  const ctx = useMemo(() => {
    if (!rows) return null;
    const raw = rows.find((r) => String(r.id) === String(swimId));
    if (!raw) return { missing: true };
    const ev = annotateEvent(rows.filter((r) => r.stroke === raw.stroke && Number(r.distM) === Number(raw.distM)));
    const i = ev.findIndex((r) => String(r.id) === String(swimId));
    const swim = ev[i];
    const sameCourse = ev.filter((r) => r.course === swim.course && Number(r.timeSec) > 0);
    const rank = sameCourse.slice().sort((a, b) => Number(a.timeSec) - Number(b.timeSec)).findIndex((r) => r.id === swim.id) + 1;
    const currentPB = sameCourse.find((r) => r.isCurrentPB) || null;
    return { swim, prev: ev[i - 1] || null, next: ev[i + 1] || null, rank, of: sameCourse.length, currentPB };
  }, [rows, swimId]);

  const overview = recordsHref(recordsPaths.overview, athleteId, name);
  if (!athleteId) return <Shell><p style={S.muted}>No athlete selected. Open this page from an athlete’s records.</p></Shell>;
  if (error) return <Shell><Crumbs items={[{ label: name, to: overview }]} /><p style={{ color: '#f88', fontSize: 12 }}>{error}</p></Shell>;
  if (!ctx) return <Shell><Crumbs items={[{ label: name, to: overview }]} /><p style={S.muted}>Loading swim…</p></Shell>;
  if (ctx.missing) return <Shell><Crumbs items={[{ label: name, to: overview }]} /><p style={S.muted}>This swim isn’t in {name}’s records. It may have been removed, or you may not have access to this log.</p></Shell>;

  const { swim, prev, next, rank, of, currentPB } = ctx;
  const title = eventTitle(swim.stroke, swim.distM);
  const eventHref = recordsHref(recordsPaths.event(eventSlug(swim.stroke, swim.distM)), athleteId, name);
  const swimHref = (r) => recordsHref(recordsPaths.swim(r.id), athleteId, name);
  const p = swim.provenance || {};
  const laps = lapSplits(swim.splits, Number(swim.distM));
  const extraKeys = Object.keys(SPLIT_EXTRAS).filter((k) => laps.some((l) => l.extra[k] != null));
  const metrics = Object.entries(swim.metrics || {}).filter(([k, v]) => METRIC_LABEL[k] && v != null && v !== '');
  const t = Number(swim.timeSec);
  const course = COURSE_LABEL[swim.course].toLowerCase();

  // One sentence on what this swim meant, in the coach's terms.
  let verdict;
  if (swim.isPB && swim.prevBest == null) verdict = `First recorded ${course} swim of this event.`;
  else if (swim.isPB) verdict = `Personal best by ${swim.gainSec.toFixed(2)} s, beating ${fmtSwim(swim.prevBest)} in ${course}.`;
  else if (swim.prevBest != null) verdict = `${(t - swim.prevBest).toFixed(2)} s outside the ${course} best at the time (${fmtSwim(swim.prevBest)}).`;
  else verdict = 'Not a flat-out swim, so it isn’t compared with personal bests.';

  const facts = [
    ['Date', fmtDate(swim.swumOn)],
    ['Course', COURSE_LABEL[swim.course] + (swim.poolType ? ` (${swim.poolType})` : '')],
    ['Type', kindLabel(swim)],
    p.meetName && ['Meet', p.meetName],
    swim.location && ['Venue', swim.location],
    p.awardingBody && ['Licensed by', p.awardingBody + (p.sanctioned === false ? ' (not licensed)' : '')],
    p.country && ['Country', p.country],
    ['Effort', EFFORT_LABEL[swim.effort] || swim.effort],
    ['Recorded', SOURCE_LABEL[swim.source] || swim.source || '—'],
    p.importRef && ['Reference', String(p.importRef).split(':').slice(1).join(' ') || p.importRef],
  ].filter(Boolean);

  return (
    <Shell>
      <Crumbs items={[{ label: name, to: overview }, { label: title, to: eventHref }, { label: fmtDate(swim.swumOn) }]} />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 16px' }}>
        <h1 style={{ fontSize: 46, fontWeight: 900, margin: 0, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
          {fmtSwim(t)}
        </h1>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{title} <span style={{ marginLeft: 6 }}><CourseTag course={swim.course} /></span></div>
      </div>
      <p style={{ fontSize: 13, color: swim.isPB ? GOOD : INK_2, margin: '10px 0 2px', lineHeight: 1.5 }}>{verdict}</p>
      <p style={{ ...S.muted, margin: 0, lineHeight: 1.6 }}>
        {of > 1 && <>{rank === 1 ? 'Fastest' : ordinal(rank) + ' fastest'} of {of} {course} swims. </>}
        {currentPB && currentPB.id !== swim.id && <>Current {course} best is <Link to={swimHref(currentPB)} style={S.crumbLink}>{fmtSwim(currentPB.timeSec)}</Link> ({fmtDate(currentPB.swumOn)}).</>}
        {currentPB && currentPB.id === swim.id && <>Still the {course} best.</>}
      </p>

      <section style={S.section} aria-labelledby="details-h">
        <h2 id="details-h" style={S.h2}>Details</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, max-content) 1fr', gap: '6px 18px', margin: 0, fontSize: 12 }}>
          {facts.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt style={{ color: INK_3 }}>{k}</dt>
              <dd style={{ margin: 0, color: INK, overflowWrap: 'anywhere' }}>{v}</dd>
            </div>
          ))}
        </dl>
        {swim.note && <p style={{ fontSize: 12, color: INK_2, marginTop: 12, whiteSpace: 'pre-wrap' }}>{swim.note}</p>}
      </section>

      <section style={S.section} aria-labelledby="splits-h">
        <h2 id="splits-h" style={S.h2}>Splits</h2>
        {laps.length === 0 ? (
          <p style={S.muted}>No splits recorded. Swims timed on Poolside with lap presses keep their splits; SwimmingResults imports bring the final time only.</p>
        ) : (
          <SplitTable laps={laps} extraKeys={extraKeys} />
        )}
      </section>

      {metrics.length > 0 && (
        <section style={S.section} aria-labelledby="readings-h">
          <h2 id="readings-h" style={S.h2}>Readings</h2>
          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 14, margin: 0 }}>
            {metrics.map(([k, v]) => (
              <div key={k}>
                <dt style={{ fontSize: 11, color: INK_3 }}>{METRIC_LABEL[k]}</dt>
                <dd style={{ margin: 0, fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {typeof v === 'number' ? +v.toFixed(2) : String(v)}<span style={{ fontSize: 11, fontWeight: 400, color: INK_3, marginLeft: 4 }}>{METRIC_UNIT[k] || ''}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <nav aria-label="Other swims in this event" style={{ ...S.section, display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
        {prev ? <Link to={swimHref(prev)} style={{ color: INK_2, textDecoration: 'none' }}>Earlier swim<br /><span style={{ color: INK, fontWeight: 700 }}>{fmtSwim(prev.timeSec)}</span> <span style={{ color: INK_3 }}>{fmtDate(prev.swumOn)}</span></Link> : <span />}
        <Link to={eventHref} style={{ ...S.crumbLink, alignSelf: 'center' }}>All {title} swims</Link>
        {next ? <Link to={swimHref(next)} style={{ color: INK_2, textDecoration: 'none', textAlign: 'right' }}>Later swim<br /><span style={{ color: INK_3 }}>{fmtDate(next.swumOn)}</span> <span style={{ color: INK, fontWeight: 700 }}>{fmtSwim(next.timeSec)}</span></Link> : <span />}
      </nav>
    </Shell>
  );
}

// Lap times with a thin bar per lap: lengths of an even swim read as a flat
// row; a fade shows as bars growing. Bars are scaled within this swim only.
function SplitTable({ laps, extraKeys }) {
  const lapTimes = laps.map((l) => l.lapSec);
  const lo = Math.min(...lapTimes), hi = Math.max(...lapTimes);
  const fastest = laps.length > 1 ? lapTimes.indexOf(lo) : -1;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 360 }}>
        <thead><tr>
          <th style={S.th}>Distance</th>
          <th style={{ ...S.th, textAlign: 'right' }}>Lap</th>
          <th style={{ ...S.th, width: '32%' }}><span style={{ position: 'absolute', left: -9999 }}>Lap time bar</span></th>
          <th style={{ ...S.th, textAlign: 'right' }}>Running</th>
          {extraKeys.map((k) => <th key={k} style={{ ...S.th, textAlign: 'right' }}>{SPLIT_EXTRAS[k]}</th>)}
        </tr></thead>
        <tbody>
          {laps.map((l, i) => {
            const frac = hi === lo ? 0.6 : 0.25 + 0.75 * ((l.lapSec - lo) / (hi - lo));
            return (
              <tr key={i}>
                <td style={S.td}>{l.dist != null ? l.dist + 'm' : `Split ${i + 1}`}</td>
                <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: i === fastest ? GOOD : INK }}>{fmtSwim(l.lapSec)}</td>
                <td style={{ ...S.td, paddingLeft: 10 }} aria-hidden="true">
                  <div style={{ height: 6, width: `${(frac * 100).toFixed(1)}%`, background: 'rgba(255,255,255,0.28)', borderRadius: 3 }} />
                </td>
                <td style={{ ...S.td, textAlign: 'right', color: INK_2, fontVariantNumeric: 'tabular-nums' }}>{fmtSwim(l.cumSec)}</td>
                {extraKeys.map((k) => <td key={k} style={{ ...S.td, textAlign: 'right', color: INK_2 }}>{l.extra[k] ?? ''}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
      {fastest >= 0 && <p style={{ ...S.muted, fontSize: 10, marginTop: 6 }}>Fastest lap in green. Longer bar = slower lap.</p>}
    </div>
  );
}

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

function Shell({ children }) {
  return <div style={S.page}><main style={S.wrap}>{children}</main></div>;
}
