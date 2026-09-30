# SwimZone — Test Protocols Context (2026-09-29)

Upload this at the start of a chat about **the Test Set Library** (named,
versioned tests coaches share), **running a test for an athlete**, and **the
trend/comparison views** built on the results. It sits on top of
`SET-FORMAT-CONTEXT.md` (a protocol *is* a `swimzone.set/1`) and
`ATHLETE-RECORDS-CONTEXT.md` (a run of a test is a `swimzone.setresult/1`).

**Update "Status" and "Open items" after each completed step.**

---

## The model in one picture

```
test_protocols  (the library — a few shared tests, versioned)
   key + version ─┐        e.g. step-7x200 v1
   set_json       │        swimzone.set/1, generic (no per-athlete times)
   measures[]     │        what each rep records by default
   params{}       │        knobs a coach may set per run (send-off, rest)
   analyser       │        which code-side analyser summarises a run
                  ▼
Prescription  (in memory / in the Poolside hand-off — not a table)
   protocol + chosen params + athlete  →  resolved targets per rep
                  ▼
set_efforts   (one run of the test by one athlete)
   protocol_id → test_protocols.id
   set_json      snapshot with params applied (still generic)
   conditions    { rpe, location, poolType, params:{ sendOff:"5:00" } }
   summary       analyser output — the numbers the trend charts plot
                  ▼
performance_results  (one row per rep, effort_id → set_efforts)
   time_sec      first-class
   metrics       { sc, sr, hr, rpe, lactate } — only what the line measures
   pb_at_swim_sec, rep_no, effort='submaximal'
                  ▼
v_set_rep_metrics  (flat view: every rep, metrics as columns — for export/SQL)
```

## The rules (agreed — raise changes, don't just make them)

1. **Few tests, shared.** Coaches mostly use the same handful. The library is
   something you *pick from*, not a general test engine.
2. **Identity by tag, not shape.** A run is a test because it carries
   `protocol_id`. Comparison is exact within `(key, version)`.
3. **A used version is frozen.** A protocol locks automatically the first time a
   `set_effort` references it (DB trigger). After that, changing the set,
   measures, params or analyser means **a new version with the same key**.
   Renaming/description edits are still allowed. Unused drafts are editable.
4. **Varying by athlete = parameters, not copies.** Target times come from the
   set's `targetRule` resolved against the athlete (PB bands etc.). Group-level
   knobs (send-off, rest) are `params`. Neither creates a new protocol.
5. **Raw reps are the truth; summaries are derived.** `set_efforts.summary` is
   written by the analyser on save and can be recomputed at any time.
6. **Time stays first-class**; everything else is in `metrics` jsonb, declared
   by `measures`. No column-per-metric migrations.
7. **Visibility follows the grant tree.** Global library (`owner_org_id` null)
   is visible to everyone signed in and edited by root only. A club's protocols
   are visible to that club, every group below it, and managers above it; edited
   by the club's admins/coaches/managers.

---

## Protocol fields

| Field | Meaning |
|---|---|
| `key` | Stable slug across versions: `step-7x200`, `css-400-200`. `^[a-z0-9][a-z0-9-]{1,62}$`. |
| `version` | Integer from 1. Unique per `(owner_org_id, key, version)`. |
| `set_json` | A `swimzone.set/1`. May use the optional line fields below. |
| `measures` | Default per-rep measures: subset of `time, splits, sc, sr, hr, rpe, lactate`. |
| `params` | Per-run knobs (see below). `{}` if none. |
| `analyser` | Code-side analyser id: `step`, `css`, `double-distance`, `blocks`, `swolf`, `maxhr`, `series`. |
| `locked` | Set by the DB on first use. Never set by hand. |

### Optional line fields (additive to `swimzone.set/1`; no `fmt` bump)

```jsonc
{
  "type":"swim", "stroke":"FS", "distM":100, "qty":10, …,
  "interval": { "type":"fixed", "onTime":"1:30", "param":"sendOff" }, // param = opt in to a protocol knob
  "measures": ["time","sc"],        // overrides protocol.measures for this line; [] = time only if the
                                    // clock runs, nothing prompted (e.g. a recovery 200)
  "constraints": { "scMax":16, "hrMin":150, "hrMax":170, "srMin":null, "srMax":null }
                                    // prescribed limits — displayed, and flagged if broken; never block a save
}
```

Readers that don't know these fields ignore them, so existing sets are
unaffected.

### `params`

```jsonc
"params": {
  "sendOff": { "label":"Send-off", "kind":"onTime",  "default":"5:00", "options":["4:30","5:00","5:30","6:00"] },
  "rest":    { "label":"Rest",     "kind":"restSec", "default":30,     "options":[20,30,45,60] }
}
```

Resolution: for each line whose `interval.param` names a param, replace
`interval.onTime` (`kind:"onTime"`) or `interval.restSec` (`kind:"restSec"`) with
the chosen value. The resolved set is what gets snapshotted into
`set_efforts.set_json`; the chosen values also go in `conditions.params`.
Params are group-level (same for the whole lane), so the snapshot is still
generic — rule 1 of the set format holds.

---

## The seeded library (global, v1)

| Key | Test | Measures | Params | Analyser → summary |
|---|---|---|---|---|
| `step-7x200` | 7×200 step, PB+30 → PB+0 in 5 s steps | time, hr, lactate, sr | sendOff 5:00 | `step` → speed vs HR / lactate per step; speed at 4 mmol when lactate taken |
| `css-400-200` | 400 max, recovery, 200 max | time, splits, sr, sc | recovery 600 s | `css` → CSS pace per 100 |
| `double-distance-400` | **DRAFT** 400 vs a target from the 200 PB | time, splits, hr, rpe | — | `double-distance` → 400 vs target, split fade |
| `turn-20x100` | 10×100 FS AT · 200 BK A2 · 10×100 FS AT | time, sc, hr, rpe (BK line: none) | sendOff 1:30 | `blocks` → block means, set 1 vs set 2 drop-off |
| `eff-8x50` | 8×50 controlled, count strokes | time, sc | sendOff 1:00 | `swolf` → SWOLF per rep, best, mean |
| `max-hr` | **DRAFT** 4×100 build, last all out | hr, time | — | `maxhr` → peak HR |
| `t10x400` | 10×400 best average | time, hr, rpe | rest 30 s | `series` → mean, fastest/slowest, spread, drift |

The two DRAFTs need a coach's definition before anyone runs them. They stay
editable until first use (see Open items).

---

## Database (migration `20260929120000_test_protocols.sql`)

- `test_protocols` (above), RLS via `can_see_protocol_org` / `can_edit_protocol_org`
  (SECURITY DEFINER, grant-tree aware).
- Trigger `guard_locked_protocol`: refuses definition changes and un-locking
  once locked (`LOCKED: …` error code).
- Trigger `lock_protocol_on_use` on `set_efforts` (SECURITY DEFINER, so an
  athlete saving a run can lock a protocol they can't edit).
- `set_efforts.protocol_id` → real FK, `on delete restrict` (a used protocol
  can't be deleted).
- `set_efforts.summary jsonb` — analyser output `{ analyser, v, …numbers }`.
- `performance_results.metrics jsonb not null default '{}'` (must be an object).
- `v_set_rep_metrics` — `security_invoker` view: one row per set rep with
  `protocol_key, protocol_version, swum_on, rep_no, time_sec, sc, sr, hr, rpe,
  lactate`. Use it for exports and ad-hoc SQL.
- Tested by `supabase/tests/test_protocols.test.mjs` (self-contained, RLS
  enforced with `SET ROLE authenticated`): 41 checks, including that the old
  import_dedup index is gone after `20260928120000_drop_import_dedup.sql`.

---

## Code

**`src/session/protocolFormat.js`** — pure, shared with Poolside (copied to
`public/poolside/` with `setFormat.js` by `scripts/copy-setformat.mjs`, which now
runs automatically before `npm run dev` / `npm run build`).

```js
validateProtocol(p)                         → error string | null
resolveParams(set, paramDefs, chosen)       → { set, params }   (invalid/missing → default)
expandReps(set, protocol?)                  → [{ repNo, blockIdx, lineIdx, stroke, distM, measures, constraints, … }]
prescribe(protocol, { chosen, athlete })    → swimzone.prescription/1 for one swimmer
prescribeGroup(protocol, { chosen, athletes }) → same set/params, per-athlete reps with
                                              target{display,resolved,fromSec,toSec}, targetTime, restSec, pbAtSwim
cleanMetrics(m)  lineMeasures(p, line)  checkConstraints(constraints, metrics)
analyse(analyserId, reps, { set })          → { analyser, v, …numbers }  (never throws)
ANALYSERS: series · step · css · double-distance · blocks · swolf · maxhr
```

**`src/services/protocols.js`**

```js
listProtocols({ allVersions?, key? })       latest version per test; scope 'global' | 'club'
getProtocol(id)
createProtocol(orgId|null, def)             v1; validated; null org = global (root only)
updateProtocol(id, changes)                 unlocked → anything; locked → name/description only
newVersion(id, changes)                     same key/owner, next version
deleteProtocol(id)                          unused only
prescribeForAthletes(protocolId, [{id,name}], { chosen, windowMonths })   fetches bests
prescribeForLoadedAthlete(protocol, athlete, chosen)                      no fetch
```

**`src/services/results.js`** (extended)

- `addSetResult(athleteId, setResult)` — `setResult` may now carry
  `protocolId`, `params`, `sessionId`, and per-rep `metrics` / `splits` /
  `targetTime`. It cleans metrics, freezes targets in `conditions.targets` and
  params in `conditions.params`, runs the protocol's analyser into `summary`,
  derives a deterministic `client_uuid` from `sessionId`, and is idempotent
  (re-save → `{ alreadyPresent: true }`). Pass the **prescription's** `set` (params
  applied) as the snapshot. Returns `{ effortId, reps, alreadyPresent, summary }`.
- `reanalyseSetResults(protocolId, athleteId)` — recompute stored summaries after
  an analyser changes.

**Repository**: `IProtocolsRepository` / `SupabaseProtocolsRepository`
(`getProtocolsRepository()` in the factory). `SupabaseResultsRepository` maps
`metrics` and `summary`, and gains `updateSetEffortSummary`.

**Tests** — `npm test` runs all four:
`src/session/protocolFormat.test.mjs` (against the real seeds, via PGlite),
`tests/services/run.mjs` (services over in-memory repos),
`supabase/tests/athlete_records.test.mjs`, `supabase/tests/test_protocols.test.mjs`.

## Status

| Piece | State |
|---|---|
| Spec (this doc) | ✅ |
| Drop old import_dedup index | ✅ applied (live DB clean) |
| Migration + seeds + test | ✅ applied to Supabase (verified 2026-09-30 with `supabase/checks/db_status.sql`); 41/41 in PGlite |
| `protocolFormat.js` + analysers | ✅ 59 tests |
| Protocols service/repo | ✅ |
| `addSetResult` metrics + summary + reanalyse | ✅ 20 service tests |
| Library UI — `/test-sets` (`src/pages/TestSets.jsx`) | ✅ pick test, params, swimmers → rep-by-rep targets; previous runs. Linked from Dashboard + Athlete Setup |
| Poolside set mode (Piece 2) | ❌ |

## Open items

- Double-distance 400: target rule (is it 2 × 200 PB + x? per-100 pace?).
- Max HR: the actual protocol coaches use.
- Step test: confirm the 5 s steps from PB+30, and whether lactate is taken.
- HR capture: typed after (watch/strap) or counted at the wall — affects the
  Poolside prompt, not the schema.
- Multi-athlete lanes: prescription payload is `athletes[]` from the start.
