# SwimZone — Swim Sets (Set Builder) Module Context

Upload this file + the listed source files to work on the session/set
builder in a focused thread. Treat the Classification module (`zones/*`) as
a black box — this module only calls `parseTime()` and (via the drill
picker) nothing from zones at all. Scoring a built session against zones
happens in the Analysis module, not here.

See `MODULE-SPLIT-PLAN.md` for how this module fits alongside the other four.

---

## What this module does

1. Builds a training session as nested **groups → blocks → lines**, where a
   line is `swim` / `rest` / `note` and a block can repeat and nest.
2. Computes volume (metres) and total duration for any block or the whole
   session.
3. Offers a drill picker from the static drill library.
4. Imports/exports a session as JSON, and generates a printable HTML view
   of the whole session (shared helper, also used by Analysis).
5. Hands off a picked group/block/line to the Analysis module for scoring
   (via the `SELECTED_ELEMENT` storage key — Swim Sets writes it,
   Analysis reads it).

---

## Files in this module

```
src/pages/SetBuilder.jsx           — UI + local session state; delegates data
                                      ops to sessionService.js
src/components/SbBlockEditor.jsx   — edit a block's children (add/reorder/delete lines)
src/components/SbBlockView.jsx     — read-only rendering of a block
src/components/SbLineEditor.jsx    — edit one line (dist/time/stroke/drill/etc.)
src/components/SbLineView.jsx      — read-only rendering of one line
src/session/model.js               — flattenBlock(), classifySequence()
                                      (classifySequence's OUTPUT is consumed by
                                      Analysis, but it operates on this module's
                                      block/line shape, so it lives here)
src/session/utils.js               — sbId, sbNewLine, sbNewBlock, sbAddChild,
                                      sbDeleteChild, sbUpdateChild, sbMoveChild,
                                      sbParseSec, sbFmtDur, sbFmtTime, sbZoneColor,
                                      sbBlockVolume, sbBlockTotalTime, sbLineRest
src/session/index.js               — barrel: re-exports model.js + utils.js
src/services/sessionService.js     — validateSession(), importSessionJson(),
                                      exportSessionJson()
src/services/classifierService.js  — generateSessionPrintHtml() only (shared
                                      with Analysis, which uses its other
                                      two exports)
src/drills/library.js              — static drill catalog (name, objective,
                                      technique, coachingNotes, kickPct,
                                      paceFactor, zoneCeiling, url) — pure data,
                                      zero imports
src/drills/index.js                — barrel: export * from './library.js'
```

**Do not include** — both are byte-identical dead duplicates, confirmed
unused by grep:
```
src/session/session-index.js   — dead duplicate of session/index.js
src/session/sessionService.js  — dead duplicate of services/sessionService.js
                                  (SetBuilder.jsx imports the services/ one)
```

---

## Canonical line/block field names

Same table as `CLAUDE-CONTEXT.md` — this module owns these fields:

| Property | Type | Description | Dead aliases (don't use) |
|---|---|---|---|
| `distM` | string | Distance in metres | `dist` |
| `targetTime` | string | Target IN time, e.g. `"1:10"` | `target` |
| `onTime` | string | Turnaround ON time, e.g. `"1:30"` | `turnaround`, `On` |
| `qty` | string | Number of reps | — |
| `stroke` | string | `FS` `BK` `BR` `Fly` `IM` `Kick` | — |
| `intensity` | string | Zone: `A1` `A2` `A3` `AT` etc. | — |
| `modifier` | string | `Full` `Drill` `Tech` etc. | — |
| `note` | string | Free text / drill name | — |
| `type` | string | `swim` `rest` `note` | — |

`e.target` is the DOM Event API — never rename it to match `targetTime`.

---

## Core API reference

```js
// session/utils.js
sbId() → string
sbNewLine(defaults) → { id, distM:'100', qty:'1', targetTime:'', onTime:'',
  restSec:'20', stroke:'FS', intensity:'A2', note:'', type:'swim', poolType:'25SC', ...defaults }
sbNewBlock(defaults) → { id, repeats:'1', label:'', children:[], ...defaults }
sbAddChild/sbDeleteChild/sbUpdateChild/sbMoveChild(block, ...) → new block (immutable)
sbBlockVolume(block) → metres (recursive, respects nested repeats)
sbBlockTotalTime(block) → seconds (recursive)
sbZoneColor(zone) → hex string — MUST match ZONE_COLORS in zones/constants.js exactly

// session/model.js
flattenBlock(block, pace200Map, phvStatus) → array of { workSec, speedRatio, restSec, stroke, dist }
classifySequence(seq, phvStatus, lactateClearMult, cssValue) → sequence result
  (same breakdown/primary/csDetection shape as classifySet(), see
  CLASSIFICATION-MODULE-CONTEXT.md — plus isSequence:true, sequenceLength, repResults)

// services/sessionService.js
validateSession(pSession) → pSession | null   // just checks Array.isArray(session.groups)
importSessionJson(pJsonText) → session         // throws on bad JSON or missing groups
exportSessionJson(pSession, pIndent=2) → string
```

---

## Storage today

`SetBuilder.jsx` touches `lib/storage.js` directly for keys `SESSION` and
`ACTIVE_GROUP` (the latter via `storage.getRaw`/`setRaw` — it's a plain
string, not JSON). `Classifier.jsx` (Analysis module) reads `SESSION` back
to build the flattened sequence for scoring.

Proposed repository (see `MODULE-SPLIT-PLAN.md`): `repositories/sessionRepository.js`
wrapping both keys, so `SetBuilder.jsx` stops calling `storage.*` directly
and Analysis reads through the same repository rather than `storage.get()`.

---

## Rules for this module

1. Never mutate a block/line object in place — every helper in
   `session/utils.js` returns a new object; keep that pattern.
2. `sbZoneColor()` must stay in sync with `ZONE_COLORS` in
   `zones/constants.js` — if a zone colour changes there, update it here too
   (they're intentionally duplicated rather than imported, since this module
   should stay independent of a live zones/index.js barrel import for its
   own rendering).
3. Don't invent a new localStorage key without updating the table in
   `CLAUDE-CONTEXT.md` and, once it exists, the new `sessionRepository.js`.
4. `sessionService.js` function signatures must stay stable (per its own
   header comment — designed to become `fetch('/api/session/…')` later).
