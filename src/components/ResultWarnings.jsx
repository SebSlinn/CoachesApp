// src/components/ResultWarnings.jsx
// Warning banners above the key metrics. Each renders only when its data is present:
//   PL territory   singleResult.plSuggestion           PL's zone colour (it names a zone)
//   Pace warning   singleResult.paceValidation         danger when 'impossible', otherwise warn
//   Consistency    singleResult.consistencyWarning     warn
//   PHV            singleResult.phvWarning             warn
//
// The pace banner is guarded on warningMsg: warningLevel can be '' while a message is set.
//
// Props:
//   singleResult  classifySet() result (non-null)
//   inputs        { restType }
import { fmtTime } from '../zones/helpers.js';
import { useZoneScheme } from '../context/ZoneSchemeContext.jsx';
import { T } from '../styles/theme.js';
import { ui } from '../styles/ui.js';
import { useTheme } from '../context/ThemeContext.jsx';

export default function ResultWarnings({ singleResult, inputs }) {
  const { color: zoneColor } = useZoneScheme();
  const { theme } = useTheme();
  const mPV = singleResult.paceValidation;
  const mCW = singleResult.consistencyWarning;
  const mPlC = zoneColor('PL');

  return (
    <>
      {singleResult.plSuggestion && (
        <div style={{ ...ui.accentCard(mPlC, 'normal', theme), fontSize: 11, lineHeight: 1.7, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, color: mPlC, marginBottom: 4 }}>⚑ POSSIBLE PL TERRITORY</div>
          <div style={{ color: T.text2, fontSize: 10 }}>{singleResult.plSuggestion.note}</div>
        </div>
      )}

      {mPV?.warningMsg && (
        <div style={ui.banner(mPV.warningLevel === 'impossible' ? 'danger' : 'warn')}>{mPV.warningMsg}</div>
      )}

      {mCW && (
        <div style={{ ...ui.banner('warn'), lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12 }}>⚠ CONSISTENCY WARNING</div>
          <div>
            Target {fmtTime(singleResult.workDur)} — rep {mCW.rep} estimated ~{fmtTime(mCW.estimatedTime)} ({mCW.degradationPct.toFixed(1)}% slower).
          </div>
          <div style={{ marginTop: 6, fontSize: 10, opacity: 0.8 }}>
            Suggest rest ~{mCW.suggestedRest}s{inputs.restType !== 'a1' && ' or Active A1 recovery'} · or target ~{fmtTime(mCW.suggestedTime)}.
          </div>
        </div>
      )}

      {singleResult.phvWarning && <div style={ui.banner('warn')}>{singleResult.phvWarning}</div>}
    </>
  );
}
