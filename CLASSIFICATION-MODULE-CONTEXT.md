# SwimZone — Classification & Verification Module Context

Upload this file + the listed source files to work on zone classification
and set validation in a focused thread. No app code, no React, no storage.

---

## What this module does

Given a training set description (one or more lines with distance, target
time, ON time, quantity, stroke) and an athlete profile, it answers:

1. **Is this set achievable?** (validatePace + speed chart)
2. **What training zone does it target?** (zoneCriteria)
3. **What energy systems does it stress?** (classify + energy)
4. **How does it degrade across reps?** (consistencyCheck)

It works for **single lines** (50m in 0:29 ON 1:00) and **multi-line sets**
(8×100 FS in 1:08 ON 1:10 + 4×50 FS in 0:28 ON 0:45).

---

## Files in this module

All zero-import or import only from siblings. No app dependencies.

```
src/zones/
  constants.js      — ZONES, STROKE_MULT, zone definitions
  helpers.js        — parseTime(), fmtTime(), secToDisplay()
  classify.js       — classifySet() — main zone classification
  energy.js         — repEnergy(), consistencyCheck(), phvZoneCaps()
  suggest.js        — suggestTimes() — reverse classifier
  validatePace.js   — validatePaceWithContext() — validation hierarchy
  speedChart.js     — getSpeedProfile(), predictFinishFromSplit()
  zoneCriteria.js   — evaluateZoneMatch() — criteria-based zone matching
  index.js          — re-exports all of the above

src/session/
  model.js          — flattenBlock(), classifySequence() — multi-line
  utils.js          — sbNewLine(), sbNewBlock(), sbBlockVolume() etc.
```

---

## The athlete profile object (athleteContext)

This is the input that drives athlete-specific validation and classification.
Fields are optional — more data = more accurate, fewer fields = graceful
degradation to generic formulas.

```js
const athleteContext = {
  // Identity
  name:         "Esme Slinn",
  gender:       "F",              // 'M' | 'F'
  athleteType:  "endurance",      // 'sprint' | 'allround' | 'endurance'
  phvStatus:    "post",           // 'pre' | 'developing' | 'post'

  // Derived profile (from athlete/parse.js deriveAthleteType())
  css:          72.62,            // Critical Speed in sec/100m
  cssMethod:    "1500m + 400m",   // how CSS was calculated
  mult:         1.35,             // lactate clearance multiplier

  // Known times — as many as available
  // Key format: "${distM}_${strokeCode}"
  // Value: { sec, lcEq, display, pool, dist, code, stroke, date, stale }
  times: {
    "50_FS":   { sec: 29.34, lcEq: 29.34, pool: "LC", ... },
    "100_FS":  { sec: 60.16, lcEq: 61.50, pool: "SC", ... },
    "200_FS":  { sec: 132.07, lcEq: 132.07, pool: "LC", ... },
    "400_FS":  { sec: 274.61, lcEq: 274.61, pool: "LC", ... },
    "800_FS":  { sec: 564.76, lcEq: 564.76, pool: "LC", ... },
    "1500_FS": { sec: 1073.48, lcEq: 1073.48, pool: "LC", ... },
    // ... other strokes
  },

  // Predicted times (auto-filled from formulas when measured times absent)
  // Same format as times{} but marked predicted: true
  // e.g. predicted 800m from CSS: css * 8 = 581s
  predicted: {
    "800_FS": { sec: 581, predicted: true, method: "css * 8" },
  },

  // Future fields (not yet implemented — reserved)
  // maxSpeed:     2.38,    // m/s at 15-20m from speed chart
  // reactionTime: 0.62,    // seconds from gun to feet off blocks
  // underwaterDist: 8.5,   // typical underwater distance off wall (m)
  // strokeRate:   50,       // strokes per minute at AT pace
  // recoveryRate: 0.85,     // lactate clearance multiplier (from step test)
};
```

---

## Single line input shape

```js
const set = {
  distM:         100,      // metres
  targetTimeSec: 68,       // seconds per rep (IN time)
  restSec:       2,        // rest seconds (ON time - IN time)
  qty:           8,        // number of reps
  stroke:        "FS",     // 'FS' 'BK' 'BR' 'Fly' 'IM' 'Kick'
  pace200Sec:    132.07,   // athlete's 200m FS time in seconds
  phvStatus:     "post",   // 'pre' | 'developing' | 'post'
};
```

---

## Multi-line set input shape

```js
// A block is the session/model.js structure
const block = {
  id: "b1",
  repeats: "2",      // outer repeat count
  children: [
    {
      id: "l1", type: "swim",
      distM: "100", targetTime: "1:08", onTime: "1:10",
      qty: "4", stroke: "FS",
      intensity: "A3", modifier: "Full", note: "",
    },
    {
      id: "l2", type: "rest",
      onTime: "0:30", note: "Easy kick",
    },
    {
      id: "l3", type: "swim",
      distM: "50", targetTime: "0:28", onTime: "0:45",
      qty: "4", stroke: "FS",
    },
  ],
};

// flattenBlock(block, pace200Map, phvStatus) → array of classified reps
// classifySequence(reps, phvStatus, clearMult, pace200Sec) → sequence result
```

---

## Core API

### validatePaceWithContext(pSet, pAthleteCtx)
Full validation hierarchy — returns warnings at each level.
```js
import { validatePaceWithContext } from './zones/validatePace.js';

const result = validatePaceWithContext(
  { distM: 100, targetTimeSec: 68, restSec: 2, qty: 8,
    pace200Sec: 132.07, stroke: 'FS' },
  { css: 72.62, athleteType: 'endurance', gender: 'F',
    times: { '100_FS': { sec: 60.16, pool: 'SC' }, ... } }
);
// → {
//     warningLevel: 'very_unlikely',
//     warningMsg: '⚠ LIKELY NOT ACHIEVABLE: ...',
//     checks: [{ level, source, msg, confidence }],
//   }
```

### classifySet(pSet)
Zone classification for a single rep.
```js
import { classifySet } from './zones/classify.js';

const result = classifySet({
  distM: 100, qty: 8, targetTimeSec: 68, restSec: 2,
  pace200Sec: 132.07, stroke: 'FS',
  phvStatus: 'post', lactateClearMult: 1.35,
  cssValue: 72.62,
});
// → {
//     primary: { id, name, pct, color, desc, rpe },
//     breakdown: [...],
//     speedRatio: 1.030,
//     restWorkRatio: 0.029,
//     workDur: 68,
//     repPace100: 68,
//     csDetection: { isCS, speedOk, restOk, volumeOk, ... },
//     consistencyWarning: { rep, estimatedTime, degradationPct, ... } | null,
//     paceValidation: { warningLevel, warningMsg },
//   }
```

### evaluateZoneMatch(pZoneId, pSingleResult, pInputs, pAthleteCtx)
Does a result meet a zone's criteria? Returns per-criterion pass/fail.
```js
import { evaluateZoneMatch } from './zones/zoneCriteria.js';

const match = evaluateZoneMatch('AT', singleResult,
  { distM: '100', qty: '8' },
  { css: 72.62, pace200Sec: 132.07, athleteType: 'endurance' }
);
// → {
//     isMatch: false,
//     isPartial: false,
//     criteria: [
//       { key: 'atPace', label: 'AT pace', met: false,
//         detail: '68.0s/100m (need 73.0–76.0s/100m = ½×200PB +7–10s)' },
//       { key: 'restSec', label: 'Rest', met: false,
//         detail: '2s rest (need 10–20s)' },
//       { key: 'volumeM', label: 'Volume', met: false,
//         detail: '800m (need 4500m+ for endurance swimmer)' },
//     ]
//   }
```

### getSpeedProfile(pFinishSec, pDistM, pStroke, pGender)
Speed chart: map finish time to split times at every 5m.
```js
import { getSpeedProfile } from './zones/speedChart.js';

const profile = getSpeedProfile(29.34, 50, 'FS', 'F');
// → {
//     markers: [15, 20, 25, 30, 35, 40, 45],
//     splits:  [7.81, 10.86, 13.91, 17.02, 20.12, 23.30, 26.46],
//     maxSpeedMs: 1.63,    // m/s at 15-20m
//     firstHalf:  26.46,   // split at 45m
//     secondHalf: 2.88,    // finish - firstHalf
//   }
```

---

## Key relationships and edge cases

**The 8×100 @ 1:08 on 1:10 case (Esmee):**
- `targetTimeSec = 68`, `restSec = 2`, `qty = 8`
- `effectiveContinuousTime = 68×8 + 2×7 = 558s`
- `cssFloor = (72.62/100) × 800 × 0.98 = 569s` (endurance, 800m scale)
- `558 < 569` → CSS-relative check fires: VERY_UNLIKELY
- AT criteria: pace 68s outside 73–76s → not AT
- A3 criteria: pace 68s outside AT+10–15s range → too fast for A3
- Result: CSS set structurally but not achievable as prescribed

**CS detection is a training method overlay, not a zone:**
- CS fires when pace ≈ CSS ± 5%, rest:work 0.4–0.83, volume 22–38min
- CS can coexist with AT/A3 zone classification — they answer different questions
- CS banner shows separately from achieved-zone card in UI

**speedRatio direction (important):**
- speedRatio = repPace100 / base100Pace (both in sec/100m)
- LOWER = FASTER (it's a time ratio)
- speedRatio < 1.0 means faster than 200m PB pace (HVO/LT territory)
- speedRatio > 1.0 means slower (aerobic zones)
- HVO: speedRatio < 0.85

**Stroke multipliers (STROKE_MULT in constants.js):**
- Applied to pace200Sec before any ratio calculations
- BK ×1.045, BR ×1.254, Fly ×1.051, IM ×1.082
- Speed chart uses these to derive non-FS profiles from FS coefficients

---

## Currently missing / future work

- **200m speed chart coefficients** — not yet scraped (PDFs behind auth)
  Currently uses CSS-relative validation for sets with distM ≥ 200
- **SCM coefficients** — have FS 100 SCM from Oswestry (behind auth)
  Currently using LC × 0.986 conversion
- **Male 50m BK/BR/Fly** specific coefficients — derived from FS × stroke mult
- **Underwater distance / reaction time** — reserved in athleteContext shape
- **Step test CSS input** — currently only 1500+400 or 400+800 formula
- **HR zones** — reserved condition type in zoneCriteria.js

---

## Rules for this module

1. Zero imports outside the module — no app/UI/storage dependencies
2. All functions accept optional athleteContext — degrade gracefully if absent  
3. Single-line and multi-line sets use the same underlying functions
4. speedRatio is always time-based (lower = faster) — never invert this
5. CS is a training method overlay, never a primary zone classification
6. When adding a new validation check, add it to the hierarchy in this doc
