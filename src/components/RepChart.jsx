// components/RepChart.jsx
// Rep-by-rep energy drift: one stacked bar per rep (aerobic on top, ATP-CP at the bottom).
// Colours: styles/theme.js energy systems.
import { T, energyVar } from '../styles/theme.js';

const BAR_H = 70;

function RepChart({ repResults }) {
  if (!repResults?.length) return null;
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 3, minWidth: repResults.length * 28,
        alignItems: 'flex-end', height: 80, padding: '0 2px' }}>
        {repResults.map((r, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column',
            justifyContent: 'flex-end', alignItems: 'center', gap: 1 }}
            title={`Rep ${r.rep}: ATP-CP ${(r.atpcp * 100).toFixed(0)}% / Glyco ${(r.glycolytic * 100).toFixed(0)}% / Aero ${(r.aerobic * 100).toFixed(0)}%`}>
            <div style={{ width: '100%', height: Math.round(r.aerobic * BAR_H),    background: energyVar('aerobic'), borderRadius: '1px 1px 0 0' }} />
            <div style={{ width: '100%', height: Math.round(r.glycolytic * BAR_H), background: energyVar('glycolytic') }} />
            <div style={{ width: '100%', height: Math.round(r.atpcp * BAR_H),      background: energyVar('atpcp') }} />
            <div style={{ fontSize: 8, color: T.text4, marginTop: 2 }}>{r.rep}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RepChart;
