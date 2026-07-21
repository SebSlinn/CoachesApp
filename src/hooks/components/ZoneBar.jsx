// components/ZoneBar.jsx
// Horizontal stacked zone breakdown bar

function ZoneBar({ breakdown }) {
  if (!breakdown) return null;
  return (
    <div style={{ height: 22, borderRadius: 6, overflow: "hidden",
      display: "flex", marginBottom: 14 }}>
      {breakdown.filter(z => z.pct > 0).map(z => (
        <div key={z.id} title={`${z.name}: ${z.pct}%`}
          style={{ width: `${z.pct}%`, background: z.color,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "width 0.5s ease", overflow: "hidden" }}>
          {z.pct >= 8 && <span style={{ fontSize: 9, fontWeight: 700,
            color: z.textColor, letterSpacing: "0.05em" }}>{z.pct}%</span>}
        </div>
      ))}
    </div>
  );
}

export default ZoneBar;
