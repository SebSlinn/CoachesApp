// screens/classifier/ZoneCheckBanners.jsx
// "Does this set meet the zone I picked?" — one banner for the selected zone, in that zone's colour.
//   CS            csDetection overlay from classifySet()
//   LP / LT / PL  evaluateZoneMatch() against the type's criteria (zones/types.js)
//   AT / A3       speed ratio inside the type's band (TYPES[code].criteria.speed)
// Met criteria show ✓ in full-strength text, unmet ✗ faint: the mark carries the meaning, not a colour.
import { parseTime, secToDisplay, evaluateZoneMatch, TYPES } from '../../zones/index.js';
import { useZoneScheme } from '../../context/ZoneSchemeContext.jsx';
import { T } from '../../styles/theme.js';
import { useTheme } from '../../context/ThemeContext.jsx';
import { ui } from '../../styles/ui.js';

const MATCH_CODES = ['LP', 'LT', 'PL'];
const SPEED_CODES = ['AT', 'A3'];
const WORK_REST_NOTE = { AT: ' · target 1.8–3.3:1 work:rest', A3: ' · target 6.7–∞:1 work:rest' };

function Criteria({ items }) {
  return (
    <div style={{ color: T.text2, fontSize: 10 }}>
      {items.map((c, i) => (
        <span key={c.key}>
          {i > 0 && ' · '}
          <span style={ui.criterion(c.met)}>{c.label} {c.met ? '✓' : '✗'} {c.detail}</span>
        </span>
      ))}
    </div>
  );
}

function CheckBanner({ color, state, title, children }) {
  const { theme } = useTheme();
  const mWeight = state === 'match' ? 'strong' : 'faint';
  return (
    <div style={{ ...ui.accentCard(color, mWeight, theme), fontSize: 11, lineHeight: 1.7 }}>
      <div style={{ fontWeight: 700, color: state === 'match' ? color : T.text2, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

export default function ZoneCheckBanners({ selectedZone, singleResult, inputs, activeAthlete }) {
  const { color: zoneColor } = useZoneScheme();
  const { theme } = useTheme();
  if (!selectedZone) return null;
  const mZc = zoneColor(selectedZone);

  if (selectedZone === 'CS') {
    const cs = singleResult?.csDetection;
    if (!cs) {
      return (
        <div style={{ ...ui.accentCard(mZc, 'faint', theme), fontSize: 10, color: T.text3 }}>
          {activeAthlete?.derivedProfile?.css ? 'Enter set parameters to check against CSS pace'
            : 'Load athlete times to calculate CSS — then time suggestions will appear'}
        </div>
      );
    }
    return (
      <CheckBanner color={mZc} state={cs.isCS ? 'match' : 'partial'} title={cs.isCS ? '✓ CS TRAINING SET' : '~ PARTIAL CS MATCH'}>
        <Criteria items={[
          { key: 'speed', met: cs.speedOk, label: 'Speed', detail: `${secToDisplay(cs.repPace100)}/100m vs CSS ${secToDisplay(cs.cssPace)}/100m (±5%)` },
          { key: 'rest',  met: cs.restOk,  label: 'Work:rest', detail: `${cs.workRest}:1 (target ~1.5:1)` },
          { key: 'vol',   met: cs.volumeOk, label: 'Volume', detail: `${cs.totalWorkMin} min (27–33 min)` },
        ]} />
      </CheckBanner>
    );
  }

  if (!singleResult) return null;

  if (MATCH_CODES.includes(selectedZone)) {
    const m = evaluateZoneMatch(selectedZone, singleResult, { distM: inputs.distM, qty: inputs.qty, stroke: inputs.stroke }, {
      times:       activeAthlete?.times || {},
      pace200Sec:  parseTime(inputs.pace200) || null,
      goal200Sec:  parseTime(inputs.goal200) || null,
      athleteType: inputs.athleteType || activeAthlete?.athleteType || null,
      css:         activeAthlete?.derivedProfile?.css || null,
      maxHr:       activeAthlete?.maxHr || null,
    });
    if (!m) return null;
    const mTitle = m.isMatch ? '✓ ' + selectedZone + ' SET' : m.isPartial ? '~ PARTIAL ' + selectedZone + ' MATCH' : '✗ NOT AN ' + selectedZone + ' SET';
    return (
      <CheckBanner color={mZc} state={m.isMatch ? 'match' : 'partial'} title={mTitle}>
        <Criteria items={m.criteria} />
      </CheckBanner>
    );
  }

  if (SPEED_CODES.includes(selectedZone)) {
    const [mLo, mHi] = TYPES[selectedZone].criteria.speed;
    const mIn = singleResult.speedRatio >= mLo && singleResult.speedRatio < mHi;
    return (
      <div style={{ ...ui.accentCard(mZc, mIn ? 'strong' : 'faint', theme), padding: '8px 14px', fontSize: 10, color: T.text2, lineHeight: 1.6 }}>
        <span style={{ fontWeight: 700, color: mIn ? mZc : T.text2, marginRight: 8 }}>
          {mIn ? '✓ ' + selectedZone : '✗ Outside ' + selectedZone}
        </span>
        {secToDisplay(singleResult.repPace100)}/100m · rest:work {singleResult.restWorkRatio.toFixed(1)}:1{WORK_REST_NOTE[selectedZone]}
      </div>
    );
  }
  return null;
}
