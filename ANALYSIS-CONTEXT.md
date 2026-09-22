# SwimZone — Analysis Module Context

Upload this file + the listed source files to work on the Classifier
screen's presentation, warnings, banners, or print/export in a focused
thread. Treat the Classification module (`zones/*`) as a black box you only
call through `zones/index.js` — its internals have their own context file
(`CLASSIFICATION-MODULE-CONTEXT.md`).

See `MODULE-SPLIT-PLAN.md` for how this module fits alongside the other four,
and for the important note in the next section.

---

## ⚠ Read this before assuming anything in `CLAUDE-CONTEXT.md` is live

`CLAUDE-CONTEXT.md` marks `ZoneMatchBanner.jsx`, `ResultWarnings.jsx`,
`SuggestPanel.jsx`, and `ZoneWriteupCard.jsx` all with "✓" as if they're
wired into the Classifier screen. Verified by grep against every import in
the codebase: **none of the four are imported by `Classifier.jsx` or
`ClassifierScreenRefactor.jsx`, or by anything else.** They're fully
written but not rendered anywhere. If you're picking up this module, your
first decision is whether to wire them in now or explicitly park them —
either way, fix the "✓" markers once you know which.

---

## What this module does

Takes one training set's inputs (distance / target time / ON time / stroke
/ pace200 / rest-type / athlete-type / PHV status), or a picked
group/block/line from a session built in the Swim Sets module, and:

1. Runs it through the Classification engine (`classifySet()` for a single
   line, `classifySequence()` for a multi-line selection).
2. Renders key metrics, an energy-system graph, a per-rep chart, and a
   zone bar.
3. (Written but not wired in — see warning above) would show
   selected-vs-achieved zone match banners, pace/consistency/PHV/PL
   warnings, a drill-suggestion panel, and a zone writeup card.
4. Generates a printable HTML report for one set or a whole session.

---

## Files in this module

```
src/pages/Classifier.jsx                  — orchestrator: owns state & storage,
                                             derives restSec = onTime−targetTime,
                                             derives lactateClearMult = restType×athleteType,
                                             calls classifySet()/classifySequence()
src/screens/ClassifierScreenRefactor.jsx  — all Analysis UI (~470 significant lines)
src/components/EnergyGraph.jsx            — ATP-CP/glycolytic/aerobic bar
src/components/RepChart.jsx               — per-rep degradation chart
src/components/ZoneBar.jsx                — zone % breakdown bar
src/services/classifierService.js         — formatResultSummary(), generatePrintHtml(),
                                             generateSessionPrintHtml()
```

Written but currently orphaned — include only if you're wiring them in this
session (see warning above):

```
src/components/ZoneMatchBanner.jsx   — needs { selectedZone, singleResult, inputs,
                                         zoneColors, activeAthlete }; imports
                                         evaluateZoneMatch from zones/zoneCriteria.js directly
src/components/ResultWarnings.jsx    — needs { singleResult, inputs, fmtTime }
src/components/SuggestPanel.jsx      — drill suggestion + zone-suggest-times panel
src/components/ZoneWriteupCard.jsx   — zone detail writeup card
```

---

## Core API this module calls into (Classification's public surface)

```js
import {
  STROKE_MULT, REST_TYPE_OPTS, ATHLETE_TYPE_OPTS,
  ENERGY_SYSTEMS, ZONE_GROUPS, ZONES, ZONE_WRITEUPS,
  parseTime, fmtTime, secToDisplay,
  validatePace, glycoCapacity, phvZoneCaps, repEnergy,
  paceImpairment, consistencyCheck,
  classifySet, suggestTimes,
} from '../zones/index.js';

// session bridge — a selected element from Swim Sets is flattened/classified here:
import { flattenBlock, classifySequence } from '../session/model.js';
```

`classifySet()` result shape and `evaluateZoneMatch()` are fully documented
in `CLASSIFICATION-MODULE-CONTEXT.md` — don't duplicate that here, just
reference it.

Note the barrel gap: `zones/index.js` does **not** currently re-export
`zoneCriteria.js` or `speedChart.js` (that's why `ZoneMatchBanner.jsx` has
to import `zoneCriteria.js` directly). `MODULE-SPLIT-PLAN.md` proposes
fixing the barrel — if you do, `ZoneMatchBanner.jsx`'s import can simplify
to the barrel too.

---

## Storage today

`Classifier.jsx` touches `lib/storage.js` directly for:
`CLASSIFIER_STATE` (its own persisted inputs/selectedZone/etc.), `SELECTED_ELEMENT`,
`EDITING_BLOCK` (both bridge state with Swim Sets) — and **reads** (never
writes) `ATHLETE` and `SESSION`, which belong to the Athlete and Swim Sets
modules respectively.

Proposed repository (see `MODULE-SPLIT-PLAN.md`): `classifierStateRepository.js`
for the three keys this module owns. For `ATHLETE`/`SESSION`, this module
should call the Athlete/Swim-Sets repositories once those exist, rather than
`storage.get()` directly — that's the whole point of the repository split.

---

## Known behaviour notes (carried over from CLAUDE-CONTEXT.md, still accurate)

- **restSec derivation**: `restSec = max(0, onTime − targetTime)`. No
  hardcoded rest values remain.
- **lactateClearMult**: `restType.clearMult × athleteType.clearMult` from
  `REST_TYPE_OPTS` / `ATHLETE_TYPE_OPTS` in `zones/constants.js`.
- **AT/A3 overlap is intentional** — a set at ½×200PB+10s/100m can show as
  a partial match for both zones simultaneously.
- **CS detection is a training-method overlay, not a zone** — it can
  coexist with an AT/A3 classification; they answer different questions.

---

## Rules for this module

1. This module never writes to the `ATHLETE` or `SESSION` storage keys —
   those belong to Athlete and Swim Sets respectively; read-only here.
2. Import Classification functions from `zones/index.js`, not individual
   files — except `zoneCriteria.js`, which is the one documented exception
   until the barrel gap above is fixed.
3. If you wire in the four orphaned components, update `CLAUDE-CONTEXT.md`'s
   checkmarks in the same change — don't leave the doc claiming more than
   the code does.
4. `e.target` is the DOM Event API — never rename it to match `targetTime`.
