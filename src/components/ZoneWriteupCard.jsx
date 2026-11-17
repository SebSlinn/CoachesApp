// src/components/ZoneWriteupCard.jsx
// The write-up for one training type (Training Zones tab): HR, LA, RPE, description,
// what it's used for, adaptations and set structure.
//
// Props:
//   zoneId   string   type code, e.g. 'AT'
//   writeup  object   TYPES[code].writeup / ZONE_WRITEUPS[code]
//   color    string   the type's colour from the coach's scheme
import { T } from '../styles/theme.js';
import { ui } from '../styles/ui.js';

export default function ZoneWriteupCard({ zoneId, writeup, color }) {
  if (!writeup) return null;
  return (
    <div style={{ ...ui.accentCard(color, 'normal'), padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 900, color }}>{zoneId} — {writeup.name}</span>
        <span style={{ fontSize: 9, color: T.text4 }}>{writeup.domain}</span>
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
        {[['HR', writeup.hr], ['LA⁴', writeup.la], ['RPE', writeup.rpe]].map(([k, v]) => (
          <span key={k} style={{ fontSize: 9, color: T.text3 }}><span style={{ color: T.text4 }}>{k}: </span>{v}</span>
        ))}
      </div>
      <div style={{ fontSize: 10, color: T.text2, lineHeight: 1.6, marginBottom: 10 }}>{writeup.description}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div style={{ ...ui.caption, fontSize: 8, marginBottom: 5 }}>Used for</div>
          {writeup.usedFor.map((s, i) => <div key={i} style={ui.bullet(color)}>{s}</div>)}
        </div>
        <div>
          <div style={{ ...ui.caption, fontSize: 8, marginBottom: 5 }}>Primary adaptations</div>
          {writeup.primary.map((s, i) => <div key={i} style={ui.bullet()}>{s}</div>)}
          {writeup.secondary && (
            <>
              <div style={{ ...ui.caption, fontSize: 8, marginTop: 8, marginBottom: 4 }}>Secondary</div>
              {writeup.secondary.map((s, i) => <div key={i} style={{ ...ui.bullet(), color: T.text3 }}>{s}</div>)}
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 9, color: T.text3, background: T.surface, borderRadius: 4, padding: '5px 8px' }}>
        <span style={{ color: T.text2, fontWeight: 700 }}>Set structure: </span>{writeup.setStructure}
      </div>
    </div>
  );
}
