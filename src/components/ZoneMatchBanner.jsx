// src/components/ZoneMatchBanner.jsx
// Selected-zone vs achieved-zone comparison banners.
//
// Renders up to two banners, driven by evaluateZoneMatch() from
// zones/zoneCriteria.js — the single source of truth for zone matching
// criteria (model-swappable: see zoneCriteria.js header).
//
// BANNER 1 — MISMATCH (selected zone not the achieved zone)
//   Shows when: selectedZone is set AND the achieved zone (singleResult.primary.id)
//   differs from selectedZone AND the selected zone is not fully matched.
//   Disappears when: selected zone IS fully matched (Banner 2 covers it), or
//   no zone is selected.
//
// BANNER 2 — SELECTION MATCH (how well the selected zone's criteria are met)
//   Shows when: selectedZone is set.
//   If fully matched: Banner 1 is suppressed, only this shows (in "matched" style).
//   If partial/no match: shows alongside Banner 1.
//
// If selectedZone is null, neither banner renders — the achieved zone is
// shown elsewhere (ACHIEVED ZONE card in the Training Zones tab).
//
// Props:
//   selectedZone   string | null   — zone the coach clicked
//   singleResult   object | null   — classifySet() result
//   inputs         object          — { distM, qty, ... }
//   zoneColors     object          — { HVO:'#FF2D55', ... }
//   evaluateZoneMatch  fn — from zones/zoneCriteria.js

import { evaluateZoneMatch } from '../zones/zoneCriteria.js';

export default function ZoneMatchBanner({ selectedZone, singleResult, inputs, zoneColors, activeAthlete }) {
  if (!selectedZone || !singleResult) return null;

  const mAthleteCtx = activeAthlete ? {
    css:         activeAthlete.derivedProfile?.css        || null,
    pace200Sec:  activeAthlete.times?.['200_FS']?.sec     || null,
    athleteType: activeAthlete.athleteType                || null,
  } : null;

  const mAchievedId = singleResult.primary?.id;
  const mAchievedName = singleResult.primary?.name;
  const mSelMatch = evaluateZoneMatch(selectedZone, singleResult, inputs, mAthleteCtx);

  // Selected zone has no defined criteria (shouldn't happen for the 8 zones,
  // but guard anyway) — fall back to simple primary-zone comparison.
  if (!mSelMatch) {
    if (mAchievedId === selectedZone) return null;
    return (
      <MismatchBanner selectedZone={selectedZone} achievedId={mAchievedId}
        achievedName={mAchievedName} zoneColors={zoneColors} />
    );
  }

  const mFullyMet = mSelMatch.isMatch;

  return (
    <>
      {/* Banner 1 — mismatch (only if selected zone not fully met AND differs from achieved) */}
      {!mFullyMet && mAchievedId !== selectedZone && (
        <MismatchBanner selectedZone={selectedZone} achievedId={mAchievedId}
          achievedName={mAchievedName} zoneColors={zoneColors} />
      )}

      {/* Banner 2 — selection match checklist */}
      <SelectionMatchBanner selectedZone={selectedZone} match={mSelMatch} zoneColors={zoneColors} />
    </>
  );
}

// ── Banner 1 ──────────────────────────────────────────────────────────────────
function MismatchBanner({ selectedZone, achievedId, achievedName, zoneColors }) {
  const mZc = zoneColors[achievedId] || '#fff';
  return (
    <div style={{
      background: mZc + '12', border: '1px solid ' + mZc + '40',
      borderLeft: '4px solid ' + mZc, borderRadius: 8,
      padding: '8px 14px', marginBottom: 10, fontSize: 11, lineHeight: 1.6,
      color: 'rgba(255,255,255,0.7)',
    }}>
      You selected <strong style={{ color: zoneColors[selectedZone] }}>{selectedZone}</strong>,
      but this set achieves <strong style={{ color: mZc }}>{achievedId} — {achievedName}</strong>.
    </div>
  );
}

// ── Banner 2 ──────────────────────────────────────────────────────────────────
function SelectionMatchBanner({ selectedZone, match, zoneColors }) {
  const mZc = zoneColors[selectedZone] || '#fff';
  const mLabel = match.isMatch ? '✓ ' + selectedZone + ' MATCHED'
    : match.isPartial ? '~ PARTIAL ' + selectedZone + ' MATCH'
    : '✗ ' + selectedZone + ' NOT MATCHED';

  return (
    <div style={{
      background:  match.isMatch ? mZc + '12' : mZc + '06',
      border:      '1px solid ' + (match.isMatch ? mZc + '45' : mZc + '20'),
      borderLeft:  '4px solid ' + (match.isMatch ? mZc : mZc + '40'),
      borderRadius: 8, padding: '10px 14px', marginBottom: 10, fontSize: 11, lineHeight: 1.7,
    }}>
      <div style={{ fontWeight: 700, color: match.isMatch ? mZc : mZc + 'aa', marginBottom: 4 }}>
        {mLabel}
      </div>
      <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>
        {match.criteria.map((c, i) => (
          <span key={c.key}>
            {i > 0 && ' · '}
            <span style={{ color: c.met ? '#34C759' : 'rgba(255,255,255,0.3)' }}>
              {c.label} {c.met ? '✓' : '✗'} {c.detail}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
