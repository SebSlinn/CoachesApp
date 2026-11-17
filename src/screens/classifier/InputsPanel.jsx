// screens/classifier/InputsPanel.jsx
// The set being classified: stroke, distance, qty, IN, ON, 200 PB/goal, then the zone picker and rest type.
import { REST_TYPE_OPTS, PRESCRIBABLE_CODES } from '../../zones/index.js';
import { useZoneScheme } from '../../context/ZoneSchemeContext.jsx';
import { T } from '../../styles/theme.js';
import { ui } from '../../styles/ui.js';
import { useTheme } from '../../context/ThemeContext.jsx';

const STROKES = ['FS', 'BK', 'BR', 'Fly', 'IM'];
const DISTS = [25, 50, 75, 100, 150, 200, 300, 400, 800, 1500];
/** Zone picker order: fastest first (HVO … A1), every training type in use. */
export const PICKER_CODES = [...PRESCRIBABLE_CODES].reverse();

/**
 * @param {Object}  props.inputs, props.set           classifier inputs and setter
 * @param {Object}  [props.activeAthlete]              picks the athlete's 200 time when the stroke changes
 * @param {string}  props.selectedZone, props.setSelectedZone, props.setClassifierDrill
 * @param {boolean} props.paused                       a Set Builder selection is shown: numeric inputs greyed
 */
export default function InputsPanel({ inputs, set, activeAthlete, selectedZone, setSelectedZone, setClassifierDrill, paused }) {
  const { color: zoneColor } = useZoneScheme();
  const { theme } = useTheme();

  function adjustDist(pDelta) {
    const mIdx = DISTS.indexOf(parseFloat(inputs.distM) || 100);
    if (mIdx === -1) return;
    set('distM', String(DISTS[Math.min(DISTS.length - 1, Math.max(0, mIdx + pDelta))]));
  }
  function changeStroke(pStroke) {
    set('stroke', pStroke);
    const mTime = activeAthlete?.times?.['200_' + pStroke];
    if (mTime) set('pace200', mTime.display);
  }
  const field = (pLabel, pKey, pWidth, pExtra = {}) => (
    <div style={{ width: pWidth }}>
      <label style={ui.label}>{pLabel}</label>
      <input style={{ ...ui.input, width: pWidth }} value={inputs[pKey] ?? ''} onChange={e => set(pKey, e.target.value)} {...pExtra} />
    </div>
  );
  const stepBtn = { padding: '0 6px', height: '50%', border: 'none', background: T.raised, color: T.text, cursor: 'pointer', fontSize: 10 };

  return (
    <div style={{ ...ui.card, padding: '10px 14px', marginBottom: 14 }}>
      <div style={{ opacity: paused ? 0.3 : 1, pointerEvents: paused ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '70px 110px 48px 72px 72px 78px', gap: 6, alignItems: 'end', marginBottom: 8 }}>
          <div>
            <label style={ui.label}>Stroke</label>
            <select value={inputs.stroke} onChange={e => changeStroke(e.target.value)} style={{ ...ui.input, width: 70, padding: 5 }}>
              {STROKES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ width: 110 }}>
            <label style={ui.label}>Dist m</label>
            <div style={{ display: 'flex' }}>
              <input style={{ ...ui.input, width: '100%', borderRadius: '5px 0 0 5px', textAlign: 'right' }} value={inputs.distM} onChange={e => set('distM', e.target.value)} />
              <div style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${T.border}`, borderRadius: '0 5px 5px 0', overflow: 'hidden' }}>
                <button onClick={() => adjustDist(1)} style={stepBtn} aria-label="Longer">▲</button>
                <button onClick={() => adjustDist(-1)} style={stepBtn} aria-label="Shorter">▼</button>
              </div>
            </div>
          </div>
          {field('Qty', 'qty', 48, { type: 'number' })}
          {field('Target (IN)', 'targetTime', 72)}
          {field('ON', 'onTime', 72, { placeholder: '1:30' })}
          {field('200 PB', 'pace200', 78)}
          {field('200 Goal', 'goal200', 78, { placeholder: 'optional' })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {PICKER_CODES.map(z => {
          const mActive = selectedZone === z;
          return (
            <button key={z} onClick={() => { setSelectedZone(mActive ? null : z); setClassifierDrill(''); }}
              style={{ ...ui.zoneButton(zoneColor(z), mActive, theme), flex: 1, padding: '5px 2px', fontSize: 11, transition: 'all 0.15s' }}>
              {z}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 6 }}>
        <span style={{ ...ui.caption, marginRight: 2 }}>Rest type:</span>
        {REST_TYPE_OPTS.map(o => (
          <button key={o.v} onClick={() => set('restType', o.v)} style={ui.toggle(inputs.restType === o.v)}>{o.l}</button>
        ))}
      </div>
    </div>
  );
}
