# SwimZone — Claude project context (updated 2026-09-19 · Phase 9 in progress)

Upload this file at the start of a new Claude chat that spans the whole app
or touches more than one module. **For single-module work, use one of the
five focused docs instead — they're cheaper and keep the chat from loading
code it doesn't need:**

| Module | Doc |
|---|---|
| Login & Memberships | `LOGIN-MEMBERSHIPS-CONTEXT.md` |
| Athlete Times & Results | `ATHLETE-CONTEXT.md` |
| Analysis (Classifier screen) | `ANALYSIS-CONTEXT.md` |
| Swim Sets (Set Builder) | `SWIM-SETS-CONTEXT.md` |
| Classification (zone/energy engine) | `CLASSIFICATION-MODULE-CONTEXT.md` |

`MODULE-SPLIT-PLAN.md` is the master doc behind that split — current
architecture, a dead-code/doc-drift findings list, and the proposed
repository (data-storage) tier. Read it before restructuring folders or
adding the repository tier described there.

(Note: earlier versions of this file pointed to a `ZONE-CRITERIA-CONTEXT.md`
— that file was never actually created; `CLASSIFICATION-MODULE-CONTEXT.md`
is the real one and every reference below has been corrected to point at it.)

**Update "Phase status" after each completed step.**

---

## What this app does

A swimming coaching tool for club coaches.
Implements the **Sweetenham energy zone model** — classifies training sets into
zones (HVO, LT, LP, AT, A3, A2, A1) based on distance, target time, turnaround
interval, stroke, and athlete PHV (growth) status.

Three main screens via separate routes:
1. `/athlete-setup` — parse SwimmingResults.org data, derive athlete profile + CSS
2. `/classifier` — classify a single set; selected-zone vs achieved-zone banners
3. `/set-builder` — build a full training session as nested blocks

Stack: **React + Vite + Supabase** (auth + persistence).
Runs client-side. Supabase credentials go in `.env.local` (not in repo).

---

## Architecture — three tiers

```
┌─────────────────────────────────────────┐
│  PRESENTATION  (React)                  │
│  pages/   components/   screens/        │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  SERVICE LAYER  src/services/           │
│  auth.js  users.js  athleteService.js   │
│  sessionService.js  classifierService.js│
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  LOGIC TIER  (pure JS, no React/DOM)    │
│  zones/  session/  athlete/  drills/    │
└─────────────────────────────────────────┘
```

`zoneCriteria.js` sits in `zones/` but is independently extractable —
zero imports, pure JS. See `CLASSIFICATION-MODULE-CONTEXT.md` for its own context.

**Gap in this diagram, found 2026-09-16:** there's no data-storage tier
drawn here because there isn't really one yet — `pages/` calls
`lib/storage.js` directly and `services/auth.js`/`users.js` call
`supabaseClient.js` directly, bypassing the service layer for storage.
`MODULE-SPLIT-PLAN.md` proposes a `repositories/` tier to close this.

---

## Naming conventions

### Variable prefixes
| Prefix | Meaning | Example |
|--------|---------|---------|
| `m` | Local variable | `mDist`, `mBase100` |
| `p` | Parameter / prop | `pDistM`, `pPhvStatus` |
| `obj` | Object (local) | `mObjRaw` |
| `mobj` | Object passed as parameter | `mobjLine` |
| `txt` | State variable bound to text input | `txtAthleteName` |

### Canonical field names on line/block objects
| Property | Type | Description | Dead aliases |
|----------|------|-------------|--------------|
| `distM` | string | Distance in metres | `dist` |
| `targetTime` | string | Target IN time e.g. `"1:10"` | `target` |
| `onTime` | string | Turnaround ON time e.g. `"1:30"` | `turnaround`, `On` |
| `qty` | string | Number of reps | — |
| `stroke` | string | `FS` `BK` `BR` `Fly` `IM` `Kick` | — |
| `intensity` | string | Zone: `A1` `A2` `A3` `AT` etc. | — |
| `modifier` | string | `Full` `Drill` `Tech` etc. | — |
| `note` | string | Free text / drill name | — |
| `type` | string | `swim` `rest` `note` | — |

**Critical:** `e.target` is the DOM Event API — never rename it to match `targetTime`.

---

## Complete file map

```
src/
  main.jsx
  App.jsx               37 ln  Router shell ✓
  supabaseClient.js

  pages/
    Login.jsx
    Dashboard.jsx        67 ln
    Classifier.jsx      ~220 ln  Orchestrator — derives restSec from onTime-targetTime,
                                 computes lactateClearMult from restType × athleteType,
                                 passes cssValue to classifySet() ✓
    AthleteSetup.jsx    ~280 ln  Delegates to athleteService ✓
    SetBuilder.jsx      ~330 ln  Delegates to sessionService; pool convertTime ✓

  screens/
    ClassifierScreenRefactor.jsx  ~468 ln
      Key metrics (5 cols incl. Total Time) above inputs ✓
      Stroke select dark-styled ✓
      Dist M input 60px (5 digits) ✓
      Add To Set beside 200PB ✓
      Redundant CS-only card removed ✓
      ACHIEVED ZONE card always shows primary zone ✓
      ⚠ Its only component imports are EnergyGraph, RepChart, ZoneBar
        (verified 2026-09-16). It does NOT import ZoneMatchBanner,
        ResultWarnings, SuggestPanel, or ZoneWriteupCard — see below.

  components/
    ProtectedRoute.jsx
    SbLineEditor.jsx    ~380 ln
    SbLineView.jsx      ~130 ln  Uses convertTime prop for pool display ✓
    SbBlockEditor.jsx   ~360 ln  Receives poolDisplay, passes to sbNewLine ✓
    SbBlockView.jsx     ~230 ln  Uses sbZoneColor (not ZONE_COLORS) ✓
    ZoneBar.jsx          22 ln
    EnergyGraph.jsx      76 ln
    RepChart.jsx         33 ln
    ⚠ WRITTEN BUT NOT WIRED IN (re-confirmed 2026-09-19 — imported
      from NOWHERE, including ClassifierScreenRefactor.jsx and Classifier.jsx.
      Deliberately parked, not backlog-by-accident: decided 2026-09-19 to
      wire these in only once each earlier cleanup/repository step has been
      run up and checked — see Phase 9 below and ANALYSIS-CONTEXT.md):
    SuggestPanel.jsx     ~90 ln  Zone suggest times + drill selector
    ZoneMatchBanner.jsx  ~90 ln  Selected vs achieved zone banners;
                                 reads from evaluateZoneMatch();
                                 passes athleteContext {css, pace200Sec, athleteType}
    ResultWarnings.jsx   ~70 ln  PL/pace/consistency/PHV warnings
                                 Pace warning guards on warningMsg not warningLevel
    ZoneWriteupCard.jsx  ~75 ln  Zone detail writeup card

  hooks/
    useAuth.js           59 ln

  services/
    auth.js              12 ln
    users.js
    athleteService.js         parseSwimmingResultsText(), buildAthleteObject(),
                              exportAthleteJson(), importAthleteJson() ✓
    sessionService.js         validateSession(), importSessionJson(),
                              exportSessionJson() ✓
    classifierService.js      formatResultSummary(), generatePrintHtml(),
                              generateSessionPrintHtml() ✓

  lib/
    storage.js           ~90 ln  localStorage wrapper + KEYS + convertTimeForDisplay ✓

  zones/
    constants.js              ZONES, STROKE_MULT, ATHLETE_TYPE_OPTS,
                              REST_TYPE_OPTS, ENERGY_SYSTEMS, ZONE_GROUPS,
                              ZONE_WRITEUPS, ZONE_COLORS
    helpers.js                parseTime, fmtTime, secToDisplay
    classify.js               classifySet() — accepts cssValue, returns csDetection ✓
    energy.js                 repEnergy(), phvZoneCaps(), consistencyCheck() etc.
    suggest.js                suggestTimes()
    validatePace.js           validatePace()
    zoneCriteria.js           evaluateZoneMatch() — zero imports, extractable ✓
                              See CLASSIFICATION-MODULE-CONTEXT.md for full docs
    index.js                  Re-exports constants/helpers/validatePace/energy/
                              classify/suggest/zoneCriteria/speedChart (fixed
                              2026-09-19 — zones-index.js's extra exports were
                              folded in and zones-index.js deleted). Live code
                              (ZoneMatchBanner.jsx, parked) still imports
                              zoneCriteria.js directly — fine either way now.

  session/
    model.js            131 ln  flattenBlock(), classifySequence()
    utils.js             86 ln  sbId(), sbNewLine(), sbNewBlock(), sbZoneColor() etc.
                                sbZoneColor() matches ZONE_COLORS exactly ✓
    index.js                   Re-exports model.js + utils.js ← import from here

  athlete/
    parse.js            ~140 ln  deriveAthleteType(), CSS calculation etc.
                                (dead unreachable handleParse() removed 2026-09-19)
    index.js                   Re-exports parse.js — currently unused (live code
                              imports parse.js directly); kept for the barrel
                              convention this project uses elsewhere

  drills/
    library.js          331 ln
    index.js
```

**Import rule:** always import from barrel `index.js`, not individual files.
Exception: `athleteService.js` and `AthleteSetup.jsx` import from
`../athlete/parse.js` directly (the `athlete/index.js` barrel is unused).
Exception: `ZoneMatchBanner.jsx` (parked, not wired in) imports
`evaluateZoneMatch` from `../zones/zoneCriteria.js` directly — no longer
necessary now the barrel re-exports it too, but harmless either way.

**Dead files.** Re-verified 2026-09-19 by tracing every import reachable
from `src/main.jsx` (not just grepping for the filenames) — confirms every
item `MODULE-SPLIT-PLAN.md` flagged, plus one it missed (`styles/theme.js`,
only ever imported by the dead `App-modular-attempt.jsx`). Two were fixed
in place rather than deleted: `zones/index.js` now re-exports
`zoneCriteria.js`/`speedChart.js` (folded in from `zones-index.js`), and
the dead `handleParse()` function was removed from inside `athlete/parse.js`.
Everything else below is queued for deletion via
`delete-dead-files.ps1` in the project root (run it, then `npm run build`
to confirm nothing broke) — do not edit or upload these to a chat meanwhile:
- `src/hooks/{athlete,components,pages,screens,services,session,styles,zones,lib}/*`
  — an entire duplicate copy of `src/` nested inside `hooks/`, unimported.
- `src/hooks/index.js`, `useClassifier.js`, `useSessionBuilder.js`,
  `useAthleteSetup.js` and their private deps `src/lib/classifier/*`,
  `src/lib/sessions/*`, `src/lib/zones/*` — an abandoned second
  state-management layer. (`hooks/useAuth.js` is live — keep it.)
- `src/session/session-index.js` (dup of `session/index.js`),
  `src/session/sessionService.js` (dup of `services/sessionService.js`),
  `src/athlete/athlete-index.js` (dup of `athlete/index.js` — keep `index.js`
  itself, it's the intentional barrel, just currently unused).
- `src/App-original.jsx`, `src/App-modular-attempt.jsx`, `src/SupabaseTest.jsx`,
  `src/styles/theme.js` — not imported by `main.jsx`/`App.jsx`.

---

## Service API reference

### athleteService.js
```js
parseSwimmingResultsText(pRawText) → { times, log, name, seNumber, club }
buildAthleteObject({...}) → athleteObject
exportAthleteJson(pAthlete) → string
importAthleteJson(pJsonText) → athleteFields  (throws on bad input)
```

### sessionService.js
```js
validateSession(pSession) → session | null
importSessionJson(pJsonText) → session  (throws on bad input)
exportSessionJson(pSession, pIndent=2) → string
```

### classifierService.js
```js
formatResultSummary(pResult, pInputs) → string
generatePrintHtml(pResult, pInputs, pAthlete) → string  (single set)
generateSessionPrintHtml(pSession, pAthlete, pPoolDisplay, pConvertTime) → string
```

### storage.js
```js
storage.get(key) → value | null
storage.set(key, value)
storage.remove(key)
storage.getRaw(key) → string | null
storage.setRaw(key, value)
convertTimeForDisplay(pTimeStr, pFromPool, pToPool) → string
```

---

## Cross-page state (localStorage keys)

| Key constant | Key string | Written by | Read by |
|---|---|---|---|
| `KEYS.ATHLETE` | `swimzone-athlete` | AthleteSetup | Classifier, SetBuilder |
| `KEYS.SESSION` | `swimzone-session` | SetBuilder | Classifier |
| `KEYS.CLASSIFIER_STATE` | `swimzone-classifier-state` | Classifier | Classifier |
| `KEYS.SELECTED_ELEMENT` | `swimzone-selected-element` | Classifier | SetBuilder |
| `KEYS.ACTIVE_GROUP` | `swimzone-active-group` | SetBuilder | Classifier |
| `KEYS.EDITING_BLOCK` | `swimzone-editing-block` | Classifier | Classifier |

---

## Pool time conversion factors (storage.js)

| From → To | Factor |
|---|---|
| 25SC → 50LC | ×1.014 |
| 50LC → 25SC | ×0.986 |
| 25Y → 25SC | ×1.10 |
| 25SC → 25Y | ×0.909 |

Factors are applied per-event (not per-100m). Stored `poolType` on each line
is never mutated — only display changes when pool toggle changes.

---

## Known behaviour notes

**CS detection** — CS is a training method in the AT/A3 zone (Zone 3 crossover).
`csDetection` in `singleResult` is a structural overlay: speed within ±5% of
CSS pace, rest:work 0.4–0.83, volume 22–38 min. The ACHIEVED ZONE card always
shows the primary energy zone (AT/A3); CS detection is shown separately in
`ZoneMatchBanner` when CS zone is selected.

**AT/A3 overlap** — intentional. ½×200PB+10s/100m is a valid pace for both.
A set at that pace shows as partial match for both zones simultaneously.

**restSec derivation** — `Classifier.jsx` derives `restSec = max(0, onTime - targetTime)`.
The old `inputs.restSec` field is no longer used.

**lactateClearMult** — computed as `restType.clearMult × athleteType.clearMult`
from `REST_TYPE_OPTS` and `ATHLETE_TYPE_OPTS` in `constants.js`.

---

## Refactor phases

### Phase 0–6 ✅ Complete
(Dead code removal, service layer, component extraction, localStorage
centralisation, tidy loose ends — all done)

### Phase 7 ✅ Complete
- `zoneCriteria.js` built — zero-import, extractable zone model
- AT/A3 absolute-pace criteria (atPace + restSecByDist + volumeByAthleteType)
- CS pace check against athlete CSS (cssPace condition type)
- ZoneMatchBanner rewritten to use evaluateZoneMatch()
- Selected vs achieved zone banners (mismatch + match checklist)
- Housekeeping: stroke dropdown, dist input, key metrics layout, add-to-set placement
- sbZoneColor() fixed to match ZONE_COLORS
- restSec derived from onTime−targetTime (was hardcoded '20')
- lactateClearMult wired from restType × athleteType (was hardcoded 1.0)

### Phase 8 ✅ Complete (2026-09-16)
- Read the actual code (not just this doc) end-to-end and corrected drift:
  four components (`ZoneMatchBanner`, `ResultWarnings`, `SuggestPanel`,
  `ZoneWriteupCard`) were marked "✓" here but aren't imported anywhere
  — fixed above.
- Inventoried dead/duplicate files (see list above and `MODULE-SPLIT-PLAN.md`)
- Split the app into 5 module context docs (Login & Memberships, Athlete,
  Analysis, Swim Sets, Classification) so single-module Claude chats don't
  need to load the whole app
- Wrote `MODULE-SPLIT-PLAN.md`: proposed repository (data-storage) tier
  between services and `lib/storage.js`/`supabaseClient.js`, and a target
  module boundary table — not yet implemented, planning only

### Phase 9 — In progress (2026-09-19)
- ✅ Decided: park the 4 orphaned components for now — wire them in only
  after each earlier step (cleanup, then the repository tier) has been run
  up and verified, not bundled into this pass
- ✅ Re-verified the full dead-file list against live code (import-graph
  trace from `main.jsx`, not just grep) — one more file found (`styles/theme.js`)
- ✅ Folded `zones/zones-index.js`'s extra exports (zoneCriteria, speedChart)
  into `zones/index.js`; `zones-index.js` itself queued for deletion below
- ✅ Removed the dead unreachable `handleParse()` from `athlete/parse.js`
- ⏳ Delete the dead files: `delete-dead-files.ps1` written to the project
  root — run it, then `npm run build` to confirm the app still builds, then
  tick this off and commit
- Once cleanup is confirmed working: add the `repositories/` tier from
  `MODULE-SPLIT-PLAN.md`, smallest module first (Login & Memberships) —
  do this one module at a time, verifying the build after each
- Then: wire in the 4 parked components (see above)
- A3 volumeByAthleteType (ranges TBD)
- HR condition type in zoneCriteria.js
- PHV zone caps referenced from zoneCriteria (currently in energy.js only)
- Verbose zone writeup accessible from banners without extra screen real estate

---

## Rules for every Claude session

1. One file changed per task where possible
2. Always `grep` before any delete to confirm nothing imports it
3. Verify app builds after each step
4. Import from barrel `index.js` files (exceptions documented above)
5. Never invent new localStorage keys without updating the table
6. Service function signatures must be stable
7. `zoneCriteria.js` must remain zero-import at all times

---

## Zip / file-sharing guide

**For main app / cross-module work:**
Include `src/` + `vite.config.js` + `package.json` + `index.html`
Exclude `node_modules/` `.git/` `dist/` `.env.local` and the dead files
listed above.

**For single-module work:** don't zip anything — use the matching
`-CONTEXT.md` file from the table at the top of this doc; each one lists
the exact (small) file set to upload.

---

## How to start a new chat

**Whole app / cross-module work:** Upload `CLAUDE-CONTEXT.md` + only the
file(s) being worked on.

**One module:** Upload that module's `-CONTEXT.md` file (see table at top)
+ the files it lists. That's it — no other module's screens, storage, or
auth code needed.

**Restructuring the boundaries themselves** (adding the repository tier,
moving files into module folders): upload `MODULE-SPLIT-PLAN.md`.

**Within an ongoing conversation:** don't re-upload the context doc —
Claude can already see the conversation history.
