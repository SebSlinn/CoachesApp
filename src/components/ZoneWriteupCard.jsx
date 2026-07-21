// src/components/ZoneWriteupCard.jsx
// Zone detail writeup card shown in the Zones results tab.
// Displays HR range, LA, RPE, description, usedFor, primary/secondary adaptations,
// and set structure guidance for the primary zone of the current result.
//
// Props:
//   zoneId   string          — zone id e.g. 'AT', 'CS', 'A2'
//   writeup  object          — ZONE_WRITEUPS[zoneId]
//   color    string          — hex colour for this zone

export default function ZoneWriteupCard({ zoneId, writeup, color }) {
  if (!writeup) return null;

  const mZc = color || '#fff';

  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)', border: `1px solid ${mZc}30`,
      borderLeft: `3px solid ${mZc}`, borderRadius: 8,
      padding: '12px 14px', marginBottom: 10,
    }}>
      {/* Header */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: mZc }}>{zoneId} — {writeup.name}</span>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{writeup.domain}</span>
        </div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
          {[['HR', writeup.hr], ['LA⁴', writeup.la], ['RPE', writeup.rpe]].map(([k, v]) => (
            <span key={k} style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>
              <span style={{ color: 'rgba(255,255,255,0.25)' }}>{k}: </span>{v}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, marginBottom: 10 }}>
          {writeup.description}
        </div>

        {/* Used for / Primary adaptations */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em', marginBottom: 5 }}>USED FOR</div>
            {writeup.usedFor.map((s, i) => (
              <div key={i} style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginBottom: 3,
                paddingLeft: 8, borderLeft: `2px solid ${mZc}50`, lineHeight: 1.5 }}>{s}</div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em', marginBottom: 5 }}>PRIMARY ADAPTATIONS</div>
            {writeup.primary.map((s, i) => (
              <div key={i} style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginBottom: 3,
                paddingLeft: 8, borderLeft: '2px solid rgba(255,255,255,0.15)', lineHeight: 1.5 }}>{s}</div>
            ))}
            {writeup.secondary && (
              <>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em', marginTop: 8, marginBottom: 4 }}>SECONDARY</div>
                {writeup.secondary.map((s, i) => (
                  <div key={i} style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 3,
                    paddingLeft: 8, borderLeft: '2px solid rgba(255,255,255,0.08)', lineHeight: 1.5 }}>{s}</div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Set structure */}
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)',
        background: 'rgba(255,255,255,0.03)', borderRadius: 4, padding: '5px 8px' }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}>Set structure: </span>
        {writeup.setStructure}
      </div>
    </div>
  );
}
