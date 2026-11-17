// components/EnergyGraph.jsx
// Energy-system share over a single maximal rep (0–240 s), with the current rep's duration marked.
// Colours: styles/theme.js (energy systems + neutral chart chrome). A canvas needs real colour
// values, not CSS variables, hence themeColors(theme); it redraws when the theme changes.
import { useRef, useEffect } from 'react';
import { fmtTime } from '../zones/helpers.js';
import { ENERGY_SYSTEMS } from '../zones/constants.js';
import { themeColors, energyColor, FONT } from '../styles/theme.js';
import { useTheme } from '../context/ThemeContext.jsx';

const MAX_T = 240, STEPS = 300;
const TICKS = [0, 60, 120, 180, 240];
const SERIES = [   // data key → ENERGY_SYSTEMS id
  { key: 'atpcp', id: 'atpcp' },
  { key: 'glyco', id: 'glycolytic' },
  { key: 'aero',  id: 'aerobic' },
];

/** The modelled curve (shares sum to 1 at each t). Same maths as before. */
function curve() {
  const mData = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * MAX_T;
    if (t === 0) { mData.push({ t, atpcp: 0, glyco: 0, aero: 0 }); continue; }
    const at = 0.82 * Math.pow(Math.min(1, 15 / t), 1.5);
    const go = Math.min(1, Math.max(0, (t - 13) / 22));
    const ae = Math.min(0.58, 0.08 + t / 380);
    const tot = at + go + ae;
    mData.push({ t, atpcp: at / tot, glyco: go / tot, aero: ae / tot });
  }
  return mData;
}
const CURVE = curve();

function EnergyGraph({ result }) {
  const ref = useRef(null);
  const { theme } = useTheme();
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    const mC = themeColors(theme);
    const mFont = `9px ${FONT.mono}`;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = mC.well; ctx.fillRect(0, 0, W, H);

    const tx = t => (t / MAX_T) * (W - 40) + 20;
    const ty = v => H - 20 - v * (H - 30);

    // Grid + axis labels
    ctx.strokeStyle = mC.border; ctx.lineWidth = 1;
    ctx.font = mFont; ctx.fillStyle = mC.text4;
    TICKS.forEach(t => {
      ctx.beginPath(); ctx.moveTo(tx(t), 10); ctx.lineTo(tx(t), H - 10); ctx.stroke();
      ctx.fillText(t + 's', tx(t) - 8, H - 2);
    });

    // Curves
    SERIES.forEach(({ key, id }) => {
      ctx.strokeStyle = energyColor(id, theme); ctx.lineWidth = 1.5;
      ctx.beginPath();
      CURVE.forEach((d, i) => { const x = tx(d.t), y = ty(d[key]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.stroke();
    });

    // This set's rep duration
    if (result?.workDur) {
      const x = tx(Math.min(result.workDur, MAX_T));
      ctx.strokeStyle = mC.text3; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, H - 16); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = mC.text2; ctx.font = mFont;
      ctx.fillText(fmtTime(result.workDur), x - 12, H - 16);
    }

    // Legend
    ENERGY_SYSTEMS.forEach((sys, i) => {
      ctx.fillStyle = energyColor(sys.id, theme); ctx.fillRect(W - 90, 12 + i * 14, 8, 8);
      ctx.fillStyle = mC.text3; ctx.font = mFont;
      ctx.fillText(sys.label, W - 78, 20 + i * 14);
    });
  }, [result?.workDur, theme]);

  return <canvas ref={ref} width={580} height={110}
    style={{ width: '100%', height: 110, borderRadius: 6, display: 'block' }} />;
}

export default EnergyGraph;
