// screens/classifier/AdaptationsView.jsx
// Layer 3: specific and general adaptations for every zone that is ≥5% of the set, grouped by zone group.
import { ZONE_GROUPS } from '../../zones/index.js';
import { useZoneScheme } from '../../context/ZoneSchemeContext.jsx';
import { T } from '../../styles/theme.js';
import { ui } from '../../styles/ui.js';

function Bullets({ title, items, color }) {
  return (
    <div>
      <div style={{ ...ui.caption, fontSize: 8, marginBottom: 5 }}>{title}</div>
      {items.map((s, i) => <div key={i} style={ui.bullet(color)}>{s}</div>)}
    </div>
  );
}

export default function AdaptationsView({ result }) {
  const { color: zoneColor, style: zoneStyle } = useZoneScheme();
  return (
    <div>
      {ZONE_GROUPS.map(grp => {
        const mInGroup = result.breakdown.filter(z => grp.members.includes(z.id));
        const mShown = mInGroup.filter(z => z.pct >= 5 && grp.adaptations?.[z.id]);
        if (!mShown.length) return null;
        const mTotal = mInGroup.reduce((s, z) => s + z.pct, 0);
        return (
          <div key={grp.zone} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              borderBottom: `1px solid ${T.border}`, paddingBottom: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: T.text2 }}>{grp.label}</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: T.text2 }}>{mTotal}%</span>
            </div>
            {mShown.map(z => {
              const mC = zoneColor(z.id);
              const mAd = grp.adaptations[z.id];
              return (
                <div key={z.id} style={{ ...ui.accentCard(mC, 'faint'), borderLeft: `3px solid ${mC}`, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: mC }}>{zoneStyle(z.id).name}</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: mC }}>{z.pct}%</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Bullets title="Specific adaptations" items={mAd.specific} color={mC} />
                    <Bullets title="General adaptations" items={mAd.general} />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      <div style={{ ...ui.markedCard, marginBottom: 12 }}>
        <div style={{ ...ui.caption, fontWeight: 700, color: T.text2, marginBottom: 4 }}>The engine size principle — Sweetenham</div>
        <div style={{ fontSize: 9, color: T.text3, lineHeight: 1.6 }}>
          The aerobic base built during childhood and early adolescence has a disproportionate impact on adult performance. Time spent in A1–A2 as a young swimmer is the most important long-term investment.
        </div>
      </div>
    </div>
  );
}
