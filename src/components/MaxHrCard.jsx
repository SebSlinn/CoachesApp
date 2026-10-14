// components/MaxHrCard.jsx
// Athlete Setup: the athlete's max heart rate and the HR band it gives each zone.
// Which max HR is used follows athlete/maxHr.js:
//   saved on profile → latest Max HR test → 220 − age → none (HR zones off).
//
// Props:
//   value, source, on   the max HR typed/saved on the profile ('' = none), 'typed'|'test', date
//   onChange(value, source, on)
//   basis               { test: {peakHr, swumOn}|null, dateOfBirth: string|null } from resolveAthleteMaxHr
//   athleteKnown        true when this is a real member (so a test or DOB could exist)
import { resolveMaxHr, isValidMaxHr } from '../athlete/maxHr.js';
import { hrTargetRange, PRESCRIBABLE_CODES } from '../zones/types.js';
import { useZoneScheme } from '../context/ZoneSchemeContext.jsx';

export function effectiveMaxHr({ value, source, on, basis }) {
  return resolveMaxHr({
    savedMaxHr: isValidMaxHr(value) ? Number(value) : null, savedSource: source, savedOn: on,
    testPeakHr: basis?.test?.peakHr, testOn: basis?.test?.swumOn,
    dateOfBirth: basis?.dateOfBirth || null,
  });
}

export default function MaxHrCard({ value, source, on, onChange, basis, athleteKnown }) {
  const { color } = useZoneScheme();
  const mNow = effectiveMaxHr({ value, source, on, basis });
  const mBad = value !== '' && value != null && !isValidMaxHr(value);
  const mTest = basis?.test;
  const lbl = { fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'block' };
  const btn = { padding: '6px 10px', borderRadius: 5, cursor: 'pointer', fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
                background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)' };
  const mSrcColour = { profile: '#34C759', test: '#34C759', age: '#FFCC00', none: 'rgba(255,255,255,0.35)' }[mNow.source];

  return (
    <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
      <label style={lbl}>
        Max heart rate <span style={{ opacity: 0.4, fontWeight: 400 }}>— sets the HR band for every zone</span>
      </label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={value ?? ''} inputMode="numeric" placeholder={mNow.maxHr && mNow.source !== 'profile' ? String(mNow.maxHr) : 'bpm'}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 3), 'typed', new Date().toISOString().slice(0, 10))}
          style={{ width: 80, background: 'rgba(255,255,255,0.05)', border: '1px solid ' + (mBad ? 'rgba(255,85,0,0.6)' : 'rgba(255,255,255,0.1)'),
                   borderRadius: 6, color: '#fff', padding: '7px 10px', fontFamily: 'monospace', fontSize: 14, outline: 'none' }} />
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>bpm</span>
        {mTest && String(mTest.peakHr) !== String(value) && (
          <button style={btn} onClick={() => onChange(String(mTest.peakHr), 'test', mTest.swumOn)}>
            USE TEST RESULT: {mTest.peakHr}
          </button>
        )}
        {value !== '' && value != null && (
          <button style={btn} onClick={() => onChange('', null, null)}>CLEAR</button>
        )}
      </div>
      {mBad && <div style={{ fontSize: 10, color: '#FF5500', marginTop: 6 }}>Enter a max HR between 120 and 240 bpm — until then it isn’t used.</div>}
      <div style={{ fontSize: 10, color: mSrcColour, marginTop: 8 }}>Using: {mNow.detail}</div>
      {!athleteKnown && mNow.source === 'none' && (
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
          Load the athlete from the Dashboard to use their date of birth or Max HR test, or type a max HR here.
        </div>
      )}
      {mNow.maxHr && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
          {PRESCRIBABLE_CODES.map((c) => {
            const r = hrTargetRange(c, mNow.maxHr);
            if (!r) return null;
            const zc = color(c);
            return (
              <span key={c} style={{ fontSize: 9, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 4,
                background: zc + '18', border: '1px solid ' + zc + '50', color: zc }}>
                {c} {r.lo == null ? '<' + r.hi : r.lo + '–' + r.hi}
              </span>
            );
          })}
          {mNow.estimated && <span style={{ fontSize: 9, color: 'rgba(255,204,0,0.7)', alignSelf: 'center' }}>estimated</span>}
        </div>
      )}
    </div>
  );
}
