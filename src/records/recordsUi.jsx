// src/records/recordsUi.jsx
// Shared look for the Records pages: the app's dark monospace theme, plus the
// two course colours (validated for colour-blind separation and contrast on
// #1a1a2e). Text always stays in ink colours; course colour only marks swatches,
// lines and points, so identity never rests on coloured text alone.
import { Link } from 'react-router-dom';

export const INK = '#ffffff', INK_2 = 'rgba(255,255,255,0.62)', INK_3 = 'rgba(255,255,255,0.4)', RULE = 'rgba(255,255,255,0.07)';
export const SURFACE = '#1a1a2e', GOOD = '#3fd196';
export const COURSE_COLOR = { LC: '#1e9cb2', SC: '#c48622', SCY: '#8a7fd1', unknown: 'rgba(255,255,255,0.45)' };

export const S = {
  page: { minHeight: '100vh', background: SURFACE, color: INK, fontFamily: 'monospace', padding: '16px 16px 48px' },
  wrap: { maxWidth: 820, margin: '0 auto' },
  crumbs: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 11, color: INK_3, marginBottom: 18 },
  crumbLink: { color: INK_2, textDecoration: 'none', borderBottom: '1px solid rgba(255,255,255,0.18)' },
  section: { borderTop: '1px solid ' + RULE, paddingTop: 16, marginTop: 22 },
  h2: { fontSize: 13, fontWeight: 700, margin: '0 0 10px', color: INK },
  muted: { color: INK_3, fontSize: 12 },
  th: { textAlign: 'left', padding: '6px 8px 6px 0', fontWeight: 400, color: INK_3, fontSize: 10, borderBottom: '1px solid ' + RULE },
  td: { padding: '7px 8px 7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 12, verticalAlign: 'baseline' },
  chip: (on) => ({ padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
    border: '1px solid ' + (on ? 'rgba(48,176,199,0.6)' : 'rgba(255,255,255,0.12)'),
    background: on ? 'rgba(48,176,199,0.16)' : 'transparent', color: on ? '#bfe9f1' : INK_3 }),
};

export function CourseSwatch({ course, size = 9 }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size, borderRadius: 2, background: COURSE_COLOR[course] || COURSE_COLOR.unknown, marginRight: 6, verticalAlign: 'baseline' }} />;
}

// Small course tag: swatch + text in ink (never coloured text).
export function CourseTag({ course }) {
  const short = course === 'unknown' ? '—' : course;
  return <span style={{ whiteSpace: 'nowrap', fontSize: 11, color: INK_2 }}><CourseSwatch course={course} size={8} />{short}</span>;
}

export function Crumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb" style={S.crumbs}>
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true" style={{ margin: '0 6px 0 0' }}>/</span>}
          {it.to ? <Link to={it.to} state={it.state} style={S.crumbLink}>{it.label}</Link> : <span style={{ color: INK_2 }}>{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export const fmtDate = (iso) => {
  const t = Date.parse(iso);
  return isNaN(t) ? (iso || '') : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const fmtGain = (s) => (s == null ? '' : (s > 0 ? '−' : '+') + Math.abs(s).toFixed(2));

// Swim-time display as swimmers write it: 31.20 under a minute, 1:05.43 above.
// Rounds to hundredths first so 59.999 shows as 1:00.00, never 0:60.00.
export function fmtSwim(pSec) {
  const v = Math.round(Number(pSec) * 100) / 100;
  if (!(v > 0)) return '—';
  if (v < 60) return v.toFixed(2);
  const m = Math.floor(v / 60);
  return m + ':' + (v - m * 60).toFixed(2).padStart(5, '0');
}
