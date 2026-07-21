// components/RepChart.jsx

// components/RepChart.jsx
// Rep-by-rep energy drift bar chart

function RepChart({ repResults }) {
  if (!repResults?.length) return null;
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", gap: 3, minWidth: repResults.length * 28,
        alignItems: "flex-end", height: 80, padding: "0 2px" }}>
        {repResults.map((r, i) => {
          const h = 70;
          const aH = Math.round(r.aerobic * h);
          const gH = Math.round(r.glycolytic * h);
          const cH = Math.round(r.atpcp * h);
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column",
              justifyContent: "flex-end", alignItems: "center", gap: 1 }}
              title={`Rep ${r.rep}: ATP-CP ${(r.atpcp*100).toFixed(0)}% / Glyco ${(r.glycolytic*100).toFixed(0)}% / Aero ${(r.aerobic*100).toFixed(0)}%`}>
              <div style={{ width: "100%", height: aH, background: "#34C759", borderRadius: "1px 1px 0 0" }} />
              <div style={{ width: "100%", height: gH, background: "#FFCC00" }} />
              <div style={{ width: "100%", height: cH, background: "#FF2D55" }} />
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{r.rep}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RepChart;
