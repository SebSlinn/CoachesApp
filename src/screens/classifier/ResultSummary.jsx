// screens/classifier/ResultSummary.jsx
// Above the tabs: four stat tiles and the Energy / Zones / Adaptations tab bar. Below them: the coaching note.
import { fmtTime } from '../../zones/index.js';
import { T, FONT } from '../../styles/theme.js';
import { ui } from '../../styles/ui.js';

export const RESULT_VIEWS = [
  { v: 'energy',      l: '⚡ Energy Systems' },
  { v: 'zones',       l: '⬡ Training Zones' },
  { v: 'adaptations', l: '◈ Adaptations' },
];

export function KeyMetrics({ result }) {
  const mTiles = [
    { l: 'Speed',     v: `${(result.speedRatio * 100).toFixed(0)}%`, s: 'of 200m pace' },
    { l: 'Work dur',  v: fmtTime(result.workDur), s: 'per rep' },
    { l: 'Rest:Work', v: `${result.restWorkRatio.toFixed(1)}:1`,
      s: result.restoreCheck?.atpcpRestored ? '✓ ATP-CP restores' : '✗ ATP-CP depletes' },
    { l: 'Volume',    v: `${result.totalVolume}m`, s: `${result.breakdown[0]?.pct}% ${result.primary?.id}` },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
      {mTiles.map(m => (
        <div key={m.l} style={ui.tile}>
          <div style={{ ...ui.caption, fontSize: 8, marginBottom: 3 }}>{m.l}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{m.v}</div>
          <div style={{ fontSize: 8, color: m.s.startsWith('✓') ? T.text2 : T.text3 }}>{m.s}</div>
        </div>
      ))}
    </div>
  );
}

export function ViewTabs({ value, onChange }) {
  return (
    <div style={{ display: 'flex', marginBottom: 14, borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.border}` }}>
      {RESULT_VIEWS.map((t, i) => (
        <button key={t.v} onClick={() => onChange(t.v)} style={{
          flex: 1, padding: '9px 6px', border: 'none', cursor: 'pointer', fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
          background: value === t.v ? T.active : 'transparent', color: value === t.v ? T.text : T.text3,
          borderLeft: i ? `1px solid ${T.border}` : 'none', transition: 'all 0.2s' }}>{t.l}</button>
      ))}
    </div>
  );
}

/** One-paragraph reading of the result, or '' when there's nothing worth saying. */
export function coachNote(r) {
  if (!r) return '';
  const mNotes = [];
  if (!r.restoreCheck?.atpcpRestored && r.avgAtpcp * 100 < 5) mNotes.push('ATP-CP virtually absent after rep 1. Set is glycolytic/aerobic from rep 2.');
  if (r.restoreCheck?.atpcpRestored) mNotes.push('Rest is sufficient — ATP-CP partially replenishes between reps.');
  if (r.workDur > 90 && r.speedRatio < 0.95) mNotes.push('Rep duration ' + r.workDur?.toFixed(0) + 's — glycolytic system under sustained stress.');
  if (r.lastRep?.aerobic > 0.65) mNotes.push('By the last rep, aerobic contribution is ~' + (r.lastRep.aerobic * 100).toFixed(0) + '%.');
  return mNotes.join(' ');
}

export function CoachNote({ result }) {
  const mText = coachNote(result);
  if (!mText) return null;
  return (
    <div style={{ ...ui.banner('note'), fontSize: 10, lineHeight: 1.7, marginBottom: 14 }}>
      <span style={{ ...ui.caption }}>Coaching note · </span>{mText}
    </div>
  );
}

/** A captioned panel holding a chart. */
export function ChartPanel({ title, children }) {
  return (
    <div style={{ ...ui.card, padding: 14 }}>
      <div style={{ ...ui.caption, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
