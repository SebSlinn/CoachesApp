// src/records/RepTimesChart.jsx
// Rep times across a test, one line per run, so runs sit on top of each other:
// a flatter line is a steadier swim, a line lower down is slower. Faster is
// plotted higher (same as the progression chart). Up to four runs; each line is
// labelled at its end, and hovering a rep lists every run's time for it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime } from './testReport.js';
import { INK, INK_2, INK_3, SURFACE } from './recordsUi.jsx';

// Validated on #1a1a2e: lightness band, CVD separation, contrast (dataviz check).
export const RUN_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500'];
const PAD = { l: 56, r: 92, t: 14, b: 30 };

export default function RepTimesChart({ runs, labels }) {
  const boxRef = useRef(null);
  const [W, setW] = useState(760);
  const [hover, setHover] = useState(null);       // rep number
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = W < 520;
  const H = narrow ? 230 : 270;
  const pad = narrow ? { ...PAD, r: 14 } : PAD;

  const g = useMemo(() => {
    const all = runs.flatMap((rv) => rv.reps.filter((r) => r.timeSec != null));
    if (!all.length) return null;
    const maxRep = Math.max(...runs.map((rv) => Math.max(rv.prescribed || 0, ...rv.reps.map((r) => r.repNo))));
    let lo = Math.min(...all.map((r) => r.timeSec)), hi = Math.max(...all.map((r) => r.timeSec));
    const p = Math.max((hi - lo) * 0.08, 0.2); lo -= p; hi += p;
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const x = (n) => pad.l + (maxRep <= 1 ? pw / 2 : ((n - 1) / (maxRep - 1)) * pw);
    const y = (t) => pad.t + ((t - lo) / (hi - lo)) * ph;              // fastest at top
    const lines = runs.map((rv) => rv.reps.filter((r) => r.timeSec != null).map((r) => ({ n: r.repNo, t: r.timeSec, x: x(r.repNo), y: y(r.timeSec) })));
    const step = (hi - lo) / 3;
    const yTicks = [0, 1, 2, 3].map((i) => lo + p + ((hi - lo - 2 * p) * i) / 3).filter(() => step > 0);
    const every = maxRep > 20 ? 5 : maxRep > 10 ? 2 : 1;
    const xTicks = Array.from({ length: maxRep }, (_, i) => i + 1).filter((n) => n === 1 || n % every === 0);
    return { lines, x, y, maxRep, yTicks, xTicks };
  }, [runs, W, H, pad.l, pad.r]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!g) return <div ref={boxRef}><p style={{ color: INK_3, fontSize: 12 }}>No timed reps to plot.</p></div>;

  const onMove = (e) => {
    const box = boxRef.current.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;
    let best = 1, bd = Infinity;
    for (let n = 1; n <= g.maxRep; n++) { const d = Math.abs(g.x(n) - vx); if (d < bd) { bd = d; best = n; } }
    setHover(best);
  };

  // End labels: nudge apart so they never overlap.
  const ends = g.lines.map((pts, i) => (pts.length ? { i, x: pts[pts.length - 1].x, y: pts[pts.length - 1].y } : null)).filter(Boolean)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;

  return (
    <div ref={boxRef} style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }} onMouseMove={onMove}
        aria-label={`Rep times for ${runs.length} run${runs.length === 1 ? '' : 's'}, faster plotted higher`}>
        {g.yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={g.y(v)} y2={g.y(v)} stroke="rgba(255,255,255,0.06)" />
            <text x={pad.l - 8} y={g.y(v) + 3.5} textAnchor="end" fontSize="10" fill={INK_3} fontFamily="monospace">{fmtTime(v)}</text>
          </g>
        ))}
        {g.xTicks.map((n) => <text key={n} x={g.x(n)} y={H - 10} textAnchor="middle" fontSize="10" fill={INK_3} fontFamily="monospace">{n}</text>)}
        <text x={W - pad.r} y={H - 10} textAnchor="end" fontSize="9" fill={INK_3} fontFamily="monospace" dx={narrow ? 0 : 26}>rep</text>
        <text x={pad.l - 8} y={pad.t - 3} textAnchor="end" fontSize="9" fill={INK_3} fontFamily="monospace">faster</text>
        {hover && <line x1={g.x(hover)} x2={g.x(hover)} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />}
        {g.lines.map((pts, i) => (
          <g key={i}>
            {pts.length > 1 && <path d={pts.map((p, k) => (k ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ')}
              fill="none" stroke={RUN_COLORS[i]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
            {pts.map((p) => (
              <circle key={p.n} cx={p.x} cy={p.y} r={p.n === hover ? 4.5 : (pts.length > 25 ? 2.5 : 3.2)} fill={RUN_COLORS[i]} stroke={SURFACE} strokeWidth="1.5" />
            ))}
          </g>
        ))}
        {!narrow && ends.map((e) => (
          <text key={e.i} x={e.x + 8} y={e.y + 3.5} fontSize="10.5" fill={INK_2} fontFamily="monospace">{labels[e.i]}</text>
        ))}
      </svg>
      {hover && (
        <div role="status" style={{
          position: 'absolute', pointerEvents: 'none', top: 8, left: `${(g.x(hover) / W) * 100}%`,
          transform: `translateX(${g.x(hover) > W * 0.6 ? 'calc(-100% - 12px)' : '12px'})`,
          background: '#24243c', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, padding: '7px 9px',
          fontSize: 11, lineHeight: 1.6, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
          <div style={{ fontWeight: 700, color: INK }}>Rep {hover}</div>
          {runs.map((rv, i) => {
            const rep = rv.reps.find((r) => r.repNo === hover);
            return (
              <div key={rv.id} style={{ color: INK_2 }}>
                <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: RUN_COLORS[i], marginRight: 6 }} />
                {labels[i]} <b style={{ color: INK, marginLeft: 6 }}>{rep && rep.timeSec != null ? fmtTime(rep.timeSec) : '—'}</b>
              </div>
            );
          })}
        </div>
      )}
      {/* legend: always present for ≥ 2 runs; also the only labels on a phone */}
      {runs.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6, fontSize: 11, color: INK_2 }}>
          {runs.map((rv, i) => (
            <span key={rv.id}><span aria-hidden="true" style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: RUN_COLORS[i], marginRight: 6 }} />{labels[i]}</span>
          ))}
        </div>
      )}
    </div>
  );
}
