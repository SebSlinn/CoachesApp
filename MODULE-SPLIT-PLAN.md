# SwimZone — Module Split & Layering Plan

Written 2026-09-16 after reading the live code in `swimzone_v2 - 240526`
(not just the existing `CLAUDE-CONTEXT.md`, which has drifted from the code —
see **Findings** below). This is the master doc; the five files listed next
to it are the per-module upload packs.

---

## Why this exists

Two goals:

1. **Cheaper, focused Claude chats.** Instead of uploading the whole app,
   each of the five areas you named gets its own small context file — the
   same pattern you already use for `CLASSIFICATION-MODULE-CONTEXT.md`.
   Each file below lists exactly which source files to attach for that
   topic, and which existing files to leave out (mostly dead duplicates).
2. **Real layering.** Today the frontend (pages) and the "service" layer
   both reach into storage directly. This doc proposes a repository tier
   so each module can be edited — and eventually moved — independently.

This pass only produces documents. No source files were changed.

---

## The five module context files

| Module | File | Upload with it |
|---|---|---|
| Login & Memberships | `LOGIN-MEMBERSHIPS-CONTEXT.md` | the 7 files it lists |
| Athlete Times & Results | `ATHLETE-CONTEXT.md` | the 4 files it lists |
| Analysis | `ANALYSIS-CONTEXT.md` | the 6 files it lists |
| Swim Sets | `SWIM-SETS-CONTEXT.md` | the 10 files it lists |
| Classification | `CLASSIFICATION-MODULE-CONTEXT.md` (already exists, still accurate) | the 9 `src/zones/` + `src/session/model.js,utils.js` files it already lists |

Classification didn't need a rewrite — it was already zero-import and
carefully documented. The other four didn't have a boundary drawn yet, so
this pass draws one based on how the code actually calls itself (verified
with `grep` across every import statement, not assumed from folder names).

---

## Current architecture, as verified against the code

```
App.jsx
 └─ pages/  (Login, Dashboard, AthleteSetup, Classifier, SetBuilder)
      │            \
      │             touches src/lib/storage.js (localStorage) DIRECTLY
      ▼
 services/  (auth.js, users.js, athleteService.js, sessionService.js, classifierService.js)
      │            \
      │             auth.js & users.js touch src/supabaseClient.js DIRECTLY
      ▼
 pure logic core (no imports out): zones/, athlete/parse.js, session/model.js+utils.js, drills/
```

There is **no repository/data-access tier today** — both storage backends
(localStorage via `lib/storage.js`, Supabase via `supabaseClient.js`) are
called directly from whichever layer happens to need them. That's the gap
your "frontend abstracted from middle, middle abstracted from storage" goal
is pointing at. The **Proposed layering** section below closes it.

---

## Findings: dead code and doc drift

Worth clearing out before or alongside the module split, so nobody (human
or Claude) edits a file that isn't actually running. Nothing has been
deleted — this is a punch list for you to confirm.

1. **`src/hooks/` contains a full duplicate copy of the entire `src/` tree**
   nested inside it (`hooks/athlete/`, `hooks/components/`, `hooks/pages/`,
   `hooks/screens/`, `hooks/services/`, `hooks/session/`, `hooks/styles/`,
   `hooks/zones/`, `hooks/lib/`). None of it is imported anywhere — confirmed
   by grepping every import in the project. Looks like an accidental nested
   copy from a past backup/zip. ~180KB of dead files.

2. **A second, unused state-management layer**: `hooks/useClassifier.js`,
   `hooks/useSessionBuilder.js`, `hooks/useAthleteSetup.js`, plus their
   private dependencies `lib/classifier/*`, `lib/sessions/*`, `lib/zones/*`.
   These are exported from `hooks/index.js` but never imported by any page —
   the pages (`Classifier.jsx`, `SetBuilder.jsx`, `AthleteSetup.jsx`) manage
   their own state inline instead. Only `useAuth.js` in that folder is
   actually used (by `ProtectedRoute.jsx` and `Dashboard.jsx`).

3. **Duplicate barrel files**, one live / one dead each:
   - `session/index.js` (live, used by `SetBuilder.jsx`) vs
     `session/session-index.js` (byte-identical dead copy)
   - `services/sessionService.js` (live, used by `SetBuilder.jsx`) vs
     `session/sessionService.js` (byte-identical dead copy)
   - `athlete/index.js` (live convention, `export * from './parse.js'`) vs
     `athlete/athlete-index.js` (dead copy, and its own header comment
     wrongly calls itself `src/athlete/index.js`)
   - `zones/index.js` (live, imported everywhere) vs `zones/zones-index.js`
     (unused) — **but `zones-index.js` is actually the more complete one**:
     it also exports `zoneCriteria.js` and `speedChart.js`, which the live
     `zones/index.js` is missing. That's why `ZoneMatchBanner.jsx` has to
     import `zoneCriteria.js` directly instead of via the barrel — documented
     in `CLAUDE-CONTEXT.md` as a deliberate "exception," but it's really the
     barrel falling out of date. Worth fixing by folding `zones-index.js`'s
     extra exports into `zones/index.js` and deleting `zones-index.js`.

4. **Two legacy monoliths sitting in `src/` root**: `App-original.jsx`
   (182KB) and `App-modular-attempt.jsx` (4.7KB). Neither is imported by
   `main.jsx` (which only imports `./App.jsx`). Pure history, safe to delete
   or move out of `src/` once you've confirmed you don't need to diff against
   them.

5. **`SupabaseTest.jsx`** in `src/` root — a scratch/test component, not
   referenced by any route in `App.jsx`.

6. **Dead code inside a live file**: `src/athlete/parse.js` has a large
   unreachable function (`handleParse()`, roughly lines 69–166) that reads
   like a leftover copy-paste from an old React component — it references
   `rawPaste`, `setAthleteName`, `setSeNumber` etc. that don't exist in this
   file. It's never called or exported, so it's dead weight rather than a
   bug, but it would throw immediately if anything ever called it.

7. **The bigger one — four components are written and documented as done,
   but wired into nothing.** `CLAUDE-CONTEXT.md` marks `ZoneMatchBanner.jsx`,
   `ResultWarnings.jsx`, `SuggestPanel.jsx`, and `ZoneWriteupCard.jsx` all
   with "✓" as if they're live in the Classifier screen. Grepping every
   import in the project shows **none of the four are imported by
   `Classifier.jsx` or `ClassifierScreenRefactor.jsx`** — or by anything
   else. So today, a coach using the app sees no selected-vs-achieved zone
   banner, no pace/consistency/PHV warnings, no drill-suggestion panel, and
   no zone writeup card, regardless of what the doc says. This is the one
   item on this list I'd fix (or deliberately shelve) before trusting
   `CLAUDE-CONTEXT.md`'s "✓" markers again.

None of the five module docs below tell you to upload the dead files —
each one calls them out by name so you don't waste chat budget on them.

---

## Proposed layered architecture (target)

```
┌───────────────────────────────────────────────────┐
│ PRESENTATION   pages/ · screens/ · components/     │
│ (per module — see boundary table below)            │
└───────────────────┬─────────────────────────────────┘
                    │  calls services only — never storage.js / supabaseClient.js
┌───────────────────▼─────────────────────────────────┐
│ SERVICE        services/*Service.js, auth.js, users.js│
│ business logic, formatting, validation — no storage  │
│ calls into pure logic (below) AND into repositories  │
└───────┬───────────────────────────────┬─────────────┘
        │                               │
┌───────▼─────────┐           ┌─────────▼───────────┐
│ PURE LOGIC       │           │ REPOSITORY  (new)    │
│ zones/ athlete/  │           │ src/repositories/     │
│ session/ drills/ │           │ one file per module,  │
│ zero imports out │           │ each wraps ONE storage │
└──────────────────┘           │ backend + ONE concern  │
                                └─────────┬───────────┘
                                          │
                                ┌─────────▼───────────┐
                                │ STORAGE DRIVERS       │
                                │ lib/storage.js (local- │
                                │ Storage) · supabase-   │
                                │ Client.js (Supabase)   │
                                └───────────────────────┘
```

**The rule that makes this real** (not just a diagram): after this change,
`lib/storage.js` and `supabaseClient.js` are imported from exactly one place
each — their matching repository file. Pages import services only; services
import repositories only (never `localStorage` or `supabase` directly).

Proposed new files (one per module, created when you're ready to touch code
— not created in this pass):

| New repository file | Wraps | Replaces direct calls currently in |
|---|---|---|
| `repositories/authRepository.js` | `supabase.auth.*` | `services/auth.js` |
| `repositories/membershipRepository.js` | `users` / `memberships` tables | `services/users.js` |
| `repositories/athleteRepository.js` | `storage` key `ATHLETE` | `pages/AthleteSetup.jsx`, `pages/Classifier.jsx`, `pages/SetBuilder.jsx` (all three currently read this key directly) |
| `repositories/sessionRepository.js` | `storage` keys `SESSION`, `ACTIVE_GROUP` | `pages/SetBuilder.jsx`, `pages/Classifier.jsx` |
| `repositories/classifierStateRepository.js` | `storage` keys `CLASSIFIER_STATE`, `SELECTED_ELEMENT`, `EDITING_BLOCK` | `pages/Classifier.jsx` |

`lib/storage.js` itself stays as the generic get/set/remove wrapper — it
becomes the thing repositories call, not the thing pages call. Its
`convertTimeForDisplay()` pool-conversion helper is unrelated to storage and
is a good candidate to move to a shared display-helpers file at the same
time (it's used by `SetBuilder.jsx` for display only, nothing to do with
persistence).

---

## Proposed module boundaries

| Module | Presentation | Service | Pure logic / data | Storage keys or tables (today) |
|---|---|---|---|---|
| Login & Memberships | `pages/Login.jsx`, `pages/Dashboard.jsx`, `components/ProtectedRoute.jsx`, `hooks/useAuth.js` | `services/auth.js`, `services/users.js` | — | Supabase `auth`, `users`, `memberships`, `organisations` |
| Athlete Times & Results | `pages/AthleteSetup.jsx` | `services/athleteService.js` | `athlete/parse.js` | localStorage `ATHLETE` |
| Analysis | `pages/Classifier.jsx`, `screens/ClassifierScreenRefactor.jsx`, `components/EnergyGraph.jsx`, `RepChart.jsx`, `ZoneBar.jsx` (+ `ZoneMatchBanner.jsx`, `ResultWarnings.jsx`, `SuggestPanel.jsx`, `ZoneWriteupCard.jsx` once wired in) | `services/classifierService.js` | consumes Classification's pure logic | localStorage `CLASSIFIER_STATE`, `SELECTED_ELEMENT`, `EDITING_BLOCK` (+ reads `ATHLETE`, `SESSION`) |
| Swim Sets | `pages/SetBuilder.jsx`, `components/SbBlockEditor.jsx`, `SbBlockView.jsx`, `SbLineEditor.jsx`, `SbLineView.jsx` | `services/sessionService.js` | `session/model.js`, `session/utils.js`, `drills/library.js` | localStorage `SESSION`, `ACTIVE_GROUP` |
| Classification | (none — pure logic module, no UI of its own) | — | `zones/*` (all 9 files) | none — zero-import module |

This is a **boundary for reasoning and for splitting Claude chats today**.
Physically moving files into `src/modules/<name>/` folders is a separate,
later step (see below) — do it only after the repository tier exists, so
you're not doing a file-move and a behaviour change at the same time.

---

## Suggested order of work

1. **Confirm the cleanup list above** — say which of items 1–7 you want
   deleted vs. kept, especially #7 (the four unwired components: wire them
   in, or park them explicitly and stop marking them "✓").
2. *(this pass)* Five module context docs, done.
3. Add the repository tier one module at a time, smallest first: Login →
   Athlete → Swim Sets → Analysis. Each is a same-behaviour refactor
   (function signatures stay stable, per the existing services' own header
   comments) — verify the app still builds and runs after each one.
4. Only once repositories exist, consider physically moving files into
   `src/modules/<name>/{presentation,service}` folders per the boundary
   table. Classification can stay exactly where it is — it's already
   independently extractable.

## How to use these docs in a new Claude chat

Same convention as your existing files: start a new chat, upload the one
module's `-CONTEXT.md` file plus the source files it lists, and nothing
else. Reference this `MODULE-SPLIT-PLAN.md` only when the work is about the
boundaries themselves (e.g. adding the repository tier) rather than about
one module's internals.
