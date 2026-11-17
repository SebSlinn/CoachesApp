// screens/classifier/EnergyView.jsx
// Layer 1: share of each energy system, rep-by-rep drift, the single-rep curve, and a detail card per system.
// Energy colours come from styles/theme.js (never zone colours).
import { ENERGY_SYSTEMS } from '../../zones/index.js';
import EnergyGraph from '../../components/EnergyGraph.jsx';
import RepChart from '../../components/RepChart.jsx';
import { T, energyColor } from '../../styles/theme.js';
import { ui } from '../../styles/ui.js';
import { ChartPanel } from './ResultSummary.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';

const SHARE_KEY = { atpcp: 'avgAtpcp', glycolytic: 'avgGlycolytic', aerobic: 'avgAerobic' };
const share = (pResult, pId) => pResult[SHARE_KEY[pId]] || 0;

function Bullets({ title, items, color }) {
  return (
    <div>
      <div style={{ ...ui.caption, fontSize: 8, marginBottom: 5 }}>{title}</div>
      {items.map((s, i) => <div key={i} style={ui.bullet(color)}>{s}</div>)}
    </div>
  );
}

export default function EnergyView({ result }) {
  const { theme } = useTheme();
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
        {ENERGY_SYSTEMS.map(sys => {
          const mC = energyColor(sys.id, theme);
          return (
            <div key={sys.id} style={{ ...ui.accentCard(mC, 'normal', theme), marginBottom: 0, padding: '10px 12px' }}>
              <div style={{ ...ui.caption, fontSize: 8, marginBottom: 3 }}>{sys.label}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: mC }}>{(share(result, sys.id) * 100).toFixed(0)}%</div>
              <div style={{ fontSize: 8, color: T.text3, marginTop: 2 }}>
                {sys.id === 'atpcp' ? (result.restoreCheck?.atpcpRestored ? 'replenishes between reps' : 'depletes from rep 2') : sys.subLabel}
              </div>
            </div>
          );
        })}
      </div>
      <ChartPanel title="Rep-by-rep energy drift"><RepChart repResults={result.repResults} /></ChartPanel>
      <ChartPanel title="Energy system curve (single rep)"><EnergyGraph result={result} /></ChartPanel>

      {ENERGY_SYSTEMS.map(sys => {
        const mPct = share(result, sys.id);
        if (mPct * 100 < 3) return null;
        const mC = energyColor(sys.id, theme);
        return (
          <div key={sys.id} style={{ ...ui.accentCard(mC, 'faint', theme), borderLeft: `3px solid ${mC}`, padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 900, color: mC }}>{sys.label}</span>
                <span style={{ fontSize: 10, color: T.text3, marginLeft: 8 }}>{sys.subLabel}</span>
              </div>
              <span style={{ fontSize: 20, fontWeight: 900, color: mC }}>{(mPct * 100).toFixed(0)}%</span>
            </div>
            <div style={{ fontSize: 10, color: T.text2, lineHeight: 1.6, marginBottom: 8 }}>{sys.mechanism}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
              <Bullets title="Specific adaptations" items={sys.specific} color={mC} />
              <Bullets title="General adaptations" items={sys.general} />
            </div>
            <div style={{ fontSize: 9, color: T.text3, background: T.surface, borderRadius: 4, padding: '5px 8px' }}>
              <span style={{ color: T.text2, fontWeight: 700 }}>PHV: </span>{sys.phvNote}
            </div>
          </div>
        );
      })}
    </div>
  );
}
