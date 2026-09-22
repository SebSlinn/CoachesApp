# SwimZone — Athlete Times & Results Module Context

Upload this file + the listed source files to work on results-paste parsing
or athlete profiling in a focused thread. No zones math, no set builder, no
auth needed here — this module only produces the `athleteContext` object
that the Classification module consumes as input.

See `MODULE-SPLIT-PLAN.md` for how this module fits alongside the other four.

---

## What this module does

1. Takes a raw text paste from SwimmingResults.org (`/athlete-setup` screen).
2. Extracts the athlete's name / SE number / club, and every recognisable
   personal-best time across distances (50–1500m) and strokes (FS/BK/BR/Fly/IM),
   converting SC↔LC where the source page provides both.
3. Derives an athlete profile: Critical Swim Speed (CSS), an athlete-type
   classification (`sprint` / `allround` / `endurance`) from the FS pace
   drop-off curve across 200m+, and a confidence rating.
4. Persists the result so the Classification and Analysis modules can read
   it back as `athleteContext` / `activeAthlete`.

---

## Files in this module

```
src/pages/AthleteSetup.jsx     — UI: paste box, parsed-times table, profile card
src/services/athleteService.js — parseSwimmingResultsText(), buildAthleteObject(),
                                  exportAthleteJson(), importAthleteJson()
src/athlete/parse.js            — deriveAthleteType(), CSS calc, date/time parsing helpers
src/athlete/index.js            — barrel: export * from './parse.js'
```

**Do not include** `src/athlete/athlete-index.js` — it's a dead duplicate of
`athlete/index.js` (nothing imports it; `athleteService.js` imports
`../athlete/parse.js` directly, per the exception documented in
`CLAUDE-CONTEXT.md`).

**Known dead code inside a live file:** `athlete/parse.js` contains an
unreachable `handleParse()` function (~line 69–166) left over from an
earlier component version — it references `rawPaste`, `setAthleteName`,
`setSeNumber` etc. that don't exist in this file's scope. It's never called.
Safe to delete when you're next in this file; don't build on it.

---

## The athlete profile / `times{}` shape

This is the same shape documented in `CLASSIFICATION-MODULE-CONTEXT.md`
(that module consumes it, this module produces it) — key format
`"${distM}_${strokeCode}"`:

```js
times: {
  "50_FS":  { sec, lcEq, display, pool, dist, code, stroke, date, monthsOld, stale },
  "100_FS": { ... },
  // ...
}

derivedProfile: {
  type,        // 'sprint' | 'allround' | 'endurance'
  mult,        // lactate clearance multiplier: 0.75 / 1.00 / 1.35
  label,       // 'Sprint' | 'All-Round' | 'Endurance'
  confidence,  // 'none' | 'low' | 'medium' | 'high'
  method,      // 'Aerobic index (FS 200m+ drop-off curve)'
  aiPct,       // average pace drop % per doubling of distance
  css,         // Critical Swim Speed, sec/100m
  cssMethod,   // e.g. '1500m + 400m'
  staleUsed,   // true if any input time was >13 months old
  reasoning,   // human-readable explanation string
}
```

CSS formula (from whichever pair of FS times is available, in priority
order): `100 * (longer.sec - shorter.sec) / (longerDist - shorterDist)`,
tried as 1500+400, then 800+400, then 400+200, then 200+100.

Athlete-type thresholds (average pace drop per doubling of distance, 200m+
only — 50/100m excluded as ATP-CP/technique dominated):
`< 3%` → endurance · `3–6%` → all-round · `> 6%` → sprint.

---

## Core API reference

```js
// services/athleteService.js
parseSwimmingResultsText(pRawText) → { times, log, name, seNumber, club }
buildAthleteObject({ name, seNumber, club, times, athleteType, phvStatus, derivedProfile })
  → { name, seNumber, club, times, derivedProfile, athleteType, phvStatus, pace200 }
exportAthleteJson(pAthlete) → string          // "SwimZone-Athlete-v1" format
importAthleteJson(pJsonText) → athleteFields  // throws on bad input / wrong _format

// athlete/parse.js
deriveAthleteType(times) → derivedProfile | null
parseDateToAge(ddmmyy)   → months old, or null
splitTimeToken(str, i)   → { token, end } | null
parseTimeToSec(token)    → seconds
```

---

## Storage today (see MODULE-SPLIT-PLAN.md for the proposed repository)

`AthleteSetup.jsx` writes the built athlete object to localStorage key
`ATHLETE` (`swimzone-athlete`) via `lib/storage.js` directly — no repository
indirection yet. `Classifier.jsx` and `SetBuilder.jsx` both read this same
key directly, also via `lib/storage.js`. Proposed: a single
`repositories/athleteRepository.js` with `getAthlete()` / `saveAthlete()`,
so all three pages call the repository instead of `storage.get/set` — and so
this could later become a Supabase `athletes` table without touching any of
the three pages.

---

## Rules for this module

1. Pure functions only in `athleteService.js` and `athlete/parse.js` — no
   React, no DOM, no localStorage calls (the page/caller handles persistence).
2. Stale-time detection (`STALE_MONTHS = 13`) affects confidence, never
   silently drops a time from `times{}}` — a stale time is still stored and
   still shown, just flagged.
3. Don't change the `times{}` key format (`"${dist}_${code}"`) or field names
   without checking `CLASSIFICATION-MODULE-CONTEXT.md` — the Classification
   module reads this shape directly.
4. Service function signatures must stay stable (per the file's own header
   comment — they're designed to become `fetch('/api/athlete/…')` calls later
   without changing callers).
