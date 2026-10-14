// components/ZoneSchemePicker.jsx
// Choose the zone colour scheme (contracts/ZONES.md). Changes how zone codes are
// coloured/named on every screen; never changes stored sets or results.
// Saved on this device for now (per-coach saving comes with Accounts).
import { useZoneScheme } from '../context/ZoneSchemeContext.jsx';
import { PRESCRIBABLE_CODES } from '../zones/types.js';
import { resolveZoneStyle } from '../zones/schemes.js';

export default function ZoneSchemePicker() {
  const { scheme, setScheme, schemes } = useZoneScheme();
  return (
    <div>
      <select value={scheme.builtIn ? scheme.id : 'custom'}
        onChange={(e) => setScheme(e.target.value)}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ccc', fontSize: 14 }}>
        {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        {!scheme.builtIn && <option value="custom">{scheme.name}</option>}
      </select>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, padding: 10, borderRadius: 8, background: '#1a1a2e' }}>
        {PRESCRIBABLE_CODES.map((c) => {
          const st = resolveZoneStyle(c, scheme);
          return (
            <span key={c} title={st.name}
              style={{ padding: '3px 8px', borderRadius: 4, fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
                background: st.color, color: st.text }}>
              {c}{st.short !== c ? ' · ' + st.short : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}
