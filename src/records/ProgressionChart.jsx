// src/records/ProgressionChart.jsx
// One event's swims over time. Faster = higher (like SwimmingResults' own
// graphs), one line per course — SC and LC times are never joined. Filled
// points are swims that were a PB on the day; the current PB per course is
// labelled. Hover shows the nearest swim; click (or Enter) opens it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { COURSE_COLOR, INK, INK_2, INK_3, SURFACE } from './recordsUi.jsx';
import { fmtDate, fmtSwim } from './recordsUi.jsx';

const PAD = { l: 58, r: 18, t: 16, b: 28 };

function niceTicks(min, max, count = 4) {
  if (max === min) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(3));
  return out;
}

function dateTicks(tmin, tmax) {
  const spanMonths = (tmax - tmin) / (30.44 * 864e5);
  const out = [];
  const d = new Date(tmin); d.setDate(1); d.setHours(0, 0, 0, 0);
  if (spanMonths > 20) {
    d.setMonth(0); d.setFullYear(d.getFullYear() + 1);
    for (; d.getTime() <= tmax; d.setFullYear(d.getFullYear() + 1)) out.push({ t: d.getTime(), label: String(d.getFullYear()) });
  } else {
    const every = Math.max(1, Math.ceil(spanMonths / 6));
    d.setMonth(d.getMonth() + 1);
    for (; d.getTime() <= tmax; d.setMonth(d.getMonth() + every))
      out.push({ t: d.getTime(), label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) });
  }
  return out;
}

export default function ProgressionChart({ rows, courses, onSelect }) {
  const boxRef = useRef(null);
  const [hover, setHover] = useState(null);   // index into pts
  // Draw at the container's real pixel width so text stays 10–11px on a phone
  // instead of shrinking with a scaled viewBox.
  const [W, setW] = useState(760);
  const hasData = rows.some((r) => courses.includes(r.course));
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);
  const H = W < 520 ? 220 : 280;

  const g = useMemo(() => {
    const vis = rows.filter((r) => courses.includes(r.course) && Number(r.timeSec) > 0);
    if (!vis.length) return null;
    const times = vis.map((r) => Number(r.timeSec));
    let minT = Math.min(...times), maxT = Math.max(...times);
    const padY = Math.max((maxT - minT) * 0.08, 0.3);
    minT -= padY; maxT += padY;
    const ts = vis.map((r) => Date.parse(r.swumOn) || 0);
    let tmin = Math.min(...ts), tmax = Math.max(...ts);
    if (tmax === tmin) { tmin -= 15 * 864e5; tmax += 15 * 864e5; }
    const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
    const x = (t) => PAD.l + ((t - tmin) / (tmax - tmin)) * pw;
    const y = (v) => PAD.t + ((v - minT) / (maxT - minT)) * ph;      // fastest at top
    const pts = vis.map((r) => ({ r, x: x(Date.parse(r.swumOn) || 0), y: y(Number(r.timeSec)) }));
    const lines = {};
    for (const p of pts) (lines[p.r.course] = lines[p.r.course] || []).push(p);
    return { pts, lines, yTicks: niceTicks(minT + padY, maxT - padY, W < 520 ? 3 : 4).map((v) => ({ v, y: y(v) })), xTicks: dateTicks(tmin, tmax).map((d) => ({ ...d, x: x(d.t) })) };
  }, [rows, courses, W, H]);

  if (!g) return <div ref={boxRef}><p style={{ color: INK_3, fontSize: 12 }}>No swims for the selected course.</p></div>;

  const toLocal = (e) => {
    const box = boxRef.current.getBoundingClientRect();
    return ((e.clientX - box.left) / box.width) * W;
  };
  const onMove = (e) => {
    const vx = toLocal(e);
    let best = 0, bd = Infinity;
    g.pts.forEach((p, i) => { const d = Math.abs(p.x - vx); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  };
  const hp = hover != null ? g.pts[hover] : null;

  return (
    <div ref={boxRef} style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block', cursor: hp ? 'pointer' : 'default' }}
        aria-label="Times over the season, faster times plotted higher" onMouseMove={onMove}
        onClick={() => hp && onSelect && onSelect(hp.r)}>
        {/* recessive grid + axis labels */}
        {g.yTicks.map((t) => (
          <g key={'y' + t.v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD.l - 8} y={t.y + 3.5} textAnchor="end" fontSize="10" fill={INK_3} fontFamily="monospace">{fmtSwim(t.v)}</text>
          </g>
        ))}
        {g.xTicks.map((t) => (
          <text key={'x' + t.t} x={t.x} y={H - 8} textAnchor="middle" fontSize="10" fill={INK_3} fontFamily="monospace">{t.label}</text>
        ))}
        <text x={PAD.l - 8} y={PAD.t - 5} textAnchor="end" fontSize="9" fill={INK_3} fontFamily="monospace">faster</text>

        {/* crosshair */}
        {hp && <line x1={hp.x} x2={hp.x} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />}

        {/* one line per course */}
        {Object.entries(g.lines).map(([c, ps]) => ps.length > 1 && (
          <path key={'l' + c} d={ps.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ')}
            fill="none" stroke={COURSE_COLOR[c]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {/* points: filled = PB on the day; hollow = not a PB */}
        {g.pts.map((p, i) => {
          const col = COURSE_COLOR[p.r.course];
          const big = p.r.isCurrentPB || i === hover;
          return (
            <circle key={p.r.id} cx={p.x} cy={p.y} r={big ? 5.5 : 4}
              fill={p.r.isPB ? col : SURFACE} stroke={p.r.isPB ? SURFACE : col} strokeWidth="2"
              tabIndex={0} role="button" aria-label={`${fmtDate(p.r.swumOn)}, ${fmtSwim(p.r.timeSec)}, ${p.r.course}${p.r.isPB ? ', personal best' : ''}. Open swim.`}
              onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect && onSelect(p.r); } }}
              style={{ outline: 'none' }} />
          );
        })}
        {/* ring the focused / hovered point so keyboard focus is visible */}
        {hp && <circle cx={hp.x} cy={hp.y} r={9} fill="none" stroke={INK} strokeOpacity="0.55" strokeWidth="1.5" />}

        {/* direct label: current PB per course */}
        {g.pts.filter((p) => p.r.isCurrentPB).map((p) => {
          const right = p.x < W - 120;
          return (
            <text key={'pb' + p.r.id} x={p.x + (right ? 10 : -10)} y={p.y - 9} textAnchor={right ? 'start' : 'end'}
              fontSize="11" fontWeight="700" fill={INK} fontFamily="monospace">{fmtSwim(p.r.timeSec)} PB</text>
          );
        })}
      </svg>

      {hp && (
        <div role="status" style={{
          position: 'absolute', pointerEvents: 'none', top: `${(hp.y / H) * 100}%`,
          left: `${(hp.x / W) * 100}%`, transform: `translate(${hp.x > W * 0.7 ? 'calc(-100% - 14px)' : '14px'}, -50%)`,
          background: '#24243c', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, padding: '7px 9px',
          fontSize: 11, lineHeight: 1.5, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{fmtSwim(hp.r.timeSec)}{hp.r.isPB ? '  PB' : ''}</div>
          <div style={{ color: INK_2 }}>{fmtDate(hp.r.swumOn)} · {hp.r.course}</div>
          {hp.r.provenance?.meetName && <div style={{ color: INK_3, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{hp.r.provenance.meetName}</div>}
        </div>
      )}
    </div>
  );
}
