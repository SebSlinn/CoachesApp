// screens/classifier/ZonesView.jsx
// Layer 2: the primary zone, the stacked zone bar, the breakdown by zone group, and the primary zone's write-up.
// Only training types carry colour. Group cards are neutral: a group is a way of ordering the list.
import { ZONE_GROUPS, ZONE_WRITEUPS } from '../../zones/index.js';
import { useZoneScheme } from '../../context/ZoneSchemeContext.jsx';
import ZoneBar from '../../components/ZoneBar.jsx';
import RepChart from '../../components/RepChart.jsx';
import ZoneWriteupCard from '../../components/ZoneWriteupCard.jsx';
import { T } from '../../styles/theme.js';
import { ui } from '../../styles/ui.js';
import { ChartPanel } from './ResultSummary.jsx';

function HeadlineCard({ color, caption, title, text, pct, rpe }) {
  return (
    <div style={{ ...ui.accentCard(color, 'strong'), borderRadius: 10, padding: '12px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ ...ui.caption, fontSize: 10 }}>{caption}</div>
          <div style={{ fontSize: 20, fontWeight: 900, color, marginTop: 1 }}>{title}</div>
          <div style={{ fontSize: 10, color: T.text2, marginTop: 4, maxWidth: 360, lineHeight: 1.6 }}>{text}</div>
        </div>
        {pct != null && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 32, fontWeight: 900, color }}>{pct}%</div>
            <div style={{ fontSize: 8, color: T.text4 }}>RPE {rpe}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupCard({ group, zones, total }) {
  const { color: zoneColor, style: zoneStyle } = useZoneScheme();
  return (
    <div style={{ ...ui.markedCard, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.text2 }}>{group.label}</span>
        <span style={{ fontSize: 14, fontWeight: 900, color: T.text2 }}>{total}%</span>
      </div>
      {zones.map(z => {
        const mC = zoneColor(z.id);
        return (
          <div key={z.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: mC, flexShrink: 0 }} />
            <div style={{ fontSize: 10, width: 170, color: T.text2 }}>{zoneStyle(z.id).name}</div>
            <div style={{ flex: 1, height: 4, background: T.raised, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${z.pct}%`, height: '100%', background: mC, borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: 11, width: 30, textAlign: 'right', fontWeight: 700, color: mC }}>{z.pct}%</div>
            <div style={{ fontSize: 9, width: 70, color: T.text4 }}>RPE {z.rpe}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function ZonesView({ result }) {
  const { color: zoneColor, style: zoneStyle } = useZoneScheme();
  const mIsCS = !!result.csDetection?.isCS;
  const mFocus = mIsCS ? 'CS' : result.primary?.id;

  return (
    <div>
      {mIsCS ? (
        <HeadlineCard color={zoneColor('CS')} caption="Training objective" title="CS — Critical Speed Training"
          text="Sustained work at CSS pace. Raises the critical speed threshold. 27–33 min total work at ~1.5:1 work:rest." />
      ) : (
        <HeadlineCard color={zoneColor(result.primary.id)} caption="Primary zone" title={zoneStyle(result.primary.id).name}
          text={result.primary.desc} pct={result.primary.pct} rpe={result.primary.rpe} />
      )}
      <ZoneBar breakdown={result.breakdown} />
      {ZONE_GROUPS.map(grp => {
        const mZones = result.breakdown.filter(z => grp.members.includes(z.id) && z.pct > 0);
        const mTotal = mZones.reduce((s, z) => s + z.pct, 0);
        return mTotal ? <GroupCard key={grp.zone} group={grp} zones={mZones} total={mTotal} /> : null;
      })}
      <div style={{ marginTop: 10 }}>
        <ChartPanel title="Rep-by-rep energy drift"><RepChart repResults={result.repResults} /></ChartPanel>
      </div>
      {mFocus && <ZoneWriteupCard zoneId={mFocus} writeup={ZONE_WRITEUPS[mFocus]} color={zoneColor(mFocus)} />}
    </div>
  );
}
