// src/components/ResultWarnings.jsx
// Warning banners rendered above the key metrics when a result has issues.
// Four independent banners, each only renders if its data is present:
//
//   PL territory   — singleResult.plSuggestion
//   Pace warning   — singleResult.paceValidation.warningLevel  (was broken: fix below)
//   Consistency    — singleResult.consistencyWarning
//   PHV warning    — singleResult.phvWarning
//
// The pace warning was not rendering in the refactored version because
// paceValidation was being checked with optional chaining only —
// warningLevel could be an empty string (falsy) even when warningMsg was set.
// Fixed: check warningMsg directly as the guard condition.
//
// Props:
//   singleResult   object   — classifySet() result (assumed non-null by caller)
//   inputs         object   — { restType }
//   fmtTime        fn       — formats seconds as m:ss string

export default function ResultWarnings({ singleResult, inputs, fmtTime }) {
  const mPV = singleResult.paceValidation;

  return (
    <>
      {/* PL territory */}
      {singleResult.plSuggestion && (
        <div style={{
          background: 'rgba(204,34,0,0.08)', border: '1px solid rgba(204,34,0,0.3)',
          borderLeft: '4px solid #CC2200', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14, fontSize: 11, lineHeight: 1.7,
        }}>
          <div style={{ fontWeight: 700, color: 'rgba(204,34,0,0.9)', marginBottom: 4 }}>⚑ POSSIBLE PL TERRITORY</div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10 }}>{singleResult.plSuggestion.note}</div>
        </div>
      )}

      {/* Pace validation warning — guard on warningMsg not warningLevel */}
      {mPV?.warningMsg && (
        <div style={{
          background:  mPV.warningLevel === 'impossible' ? 'rgba(255,45,85,0.15)'  : 'rgba(255,149,0,0.12)',
          border:      '1px solid ' + (mPV.warningLevel === 'impossible' ? 'rgba(255,45,85,0.5)' : 'rgba(255,149,0,0.4)'),
          borderLeft:  '4px solid ' + (mPV.warningLevel === 'impossible' ? '#FF2D55' : '#FF9500'),
          borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 11, lineHeight: 1.6,
          color: mPV.warningLevel === 'impossible' ? 'rgba(255,180,180,0.95)' : 'rgba(255,220,150,0.95)',
        }}>
          {mPV.warningMsg}
        </div>
      )}

      {/* Consistency warning */}
      {singleResult.consistencyWarning && (
        <div style={{
          background: 'rgba(255,149,0,0.12)', border: '1px solid rgba(255,149,0,0.4)',
          borderLeft: '4px solid #FF9500', borderRadius: 8,
          padding: '12px 14px', marginBottom: 14, fontSize: 11, lineHeight: 1.7,
          color: 'rgba(255,220,150,0.95)',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12 }}>⚠ CONSISTENCY WARNING</div>
          <div>
            Target {fmtTime(singleResult.workDur)} — rep {singleResult.consistencyWarning.rep} estimated ~{fmtTime(singleResult.consistencyWarning.estimatedTime)} ({singleResult.consistencyWarning.degradationPct.toFixed(1)}% slower).
          </div>
          <div style={{ marginTop: 6, fontSize: 10, opacity: 0.75 }}>
            Suggest rest ~{singleResult.consistencyWarning.suggestedRest}s
            {inputs.restType !== 'a1' && ' or Active A1 recovery'}
            {' · '}or target ~{fmtTime(singleResult.consistencyWarning.suggestedTime)}.
          </div>
        </div>
      )}

      {/* PHV warning */}
      {singleResult.phvWarning && (
        <div style={{
          background: 'rgba(255,149,0,0.12)', border: '1px solid rgba(255,149,0,0.35)',
          borderLeft: '4px solid #FF9500', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14, fontSize: 11,
          color: 'rgba(255,220,150,0.9)', lineHeight: 1.6,
        }}>
          {singleResult.phvWarning}
        </div>
      )}
    </>
  );
}
