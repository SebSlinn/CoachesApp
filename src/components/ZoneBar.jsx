// components/ZoneBar.jsx
// Horizontal stacked zone breakdown bar. Colours follow the coach's zone scheme.
import { useZoneScheme } from '../context/ZoneSchemeContext.jsx';

function ZoneBar({ breakdown }) {
  const { style: zoneStyle } = useZoneScheme();
  if (!breakdown) return null;
  return (
    <div style={{ height: 22, borderRadius: 6, overflow: "hidden",
      display: "flex", marginBottom: 14 }}>
      {breakdown.filter(z => z.pct > 0).map(z => {
        const mSt = zoneStyle(z.id);
        return (
        <div key={z.id} title={`${mSt.name}: ${z.pct}%`}
          style={{ width: `${z.pct}%`, background: mSt.color,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "width 0.5s ease", overflow: "hidden" }}>
          {z.pct >= 8 && <span style={{ fontSize: 9, fontWeight: 700,
            color: mSt.text, letterSpacing: "0.05em" }}>{z.pct}%</span>}
        </div>
        );
      })}
    </div>
  );
}

export default ZoneBar;
