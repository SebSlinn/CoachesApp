// components/EnergyGraph.jsx
import { useRef, useEffect } from 'react';
import { fmtTime } from '../zones/helpers.js';

function EnergyGraph({ result }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d");
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0d0d1a"; ctx.fillRect(0, 0, W, H);

    const maxT = 240, steps = 300;
    const data = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * maxT;
      if (t === 0) { data.push({ t, atpcp: 0, glyco: 0, aero: 0 }); continue; }
      const at = 0.82 * Math.pow(Math.min(1, 15 / t), 1.5);
      const go = Math.min(1, Math.max(0, (t - 13) / 22)) * Math.max(0, Math.min(1, 0.32 / 0.32));
      const ae = Math.min(0.58, 0.08 + t / 380) * 1.0;
      const tot = at + go + ae;
      data.push({ t, atpcp: at/tot, glyco: go/tot, aero: ae/tot });
    }

    const tx = t => (t / maxT) * (W - 40) + 20;
    const ty = v => H - 20 - v * (H - 30);

    const drawLine = (key, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = tx(d.t), y = ty(d[key]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    };

    // Axes
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
    [0, 60, 120, 180, 240].forEach(t => {
      ctx.beginPath(); ctx.moveTo(tx(t), 10); ctx.lineTo(tx(t), H-10); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.2)"; ctx.font = "9px monospace";
      ctx.fillText(t + "s", tx(t) - 8, H - 2);
    });

    drawLine("atpcp", "#FF2D55");
    drawLine("glyco", "#FFCC00");
    drawLine("aero",  "#34C759");

    // Rep duration marker
    if (result?.workDur) {
      const x = tx(Math.min(result.workDur, maxT));
      ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, H - 16); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "9px monospace";
      ctx.fillText(fmtTime(result.workDur), x - 12, H - 16);
    }

    // Legend
    [["ATP-CP","#FF2D55"],["Glycolytic","#FFCC00"],["Aerobic","#34C759"]].forEach(([l,c], i) => {
      ctx.fillStyle = c; ctx.fillRect(W - 90, 12 + i*14, 8, 8);
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "9px monospace";
      ctx.fillText(l, W - 78, 20 + i*14);
    });
  }, [result?.workDur]);

  return <canvas ref={ref} width={580} height={110}
    style={{ width: "100%", height: 110, borderRadius: 6, display: "block" }} />;
}

// ─── Zone Bar ─────────────────────────────────────────────────────────────────

export default EnergyGraph;
