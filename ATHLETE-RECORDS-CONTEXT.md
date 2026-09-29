# SwimZone — Athlete Records Context (updated 2026-09-26)

Upload this file at the start of a chat about **saving an athlete's swims**:
races, time trials, single logged swims, and sets-as-swum (including test
sets); importing competition times without losing history; and the **Poolside
App's** offline capture and sync back into records.

It extends `LOGIN-MEMBERSHIPS-CONTEXT.md` (auth, log sharing, guardians) and the
Accounts context (which owns `performance_results`, the RPCs, and RLS). Where
they overlap, log-sharing rules (`has_log_access`) still govern who may read/add/
edit a swim — this doc adds **what** a swim is and **how** it gets in.

It depends on `SET-FORMAT-CONTEXT.md` (`swimzone.set/1`): a set-as-swum stores a
snapshot of that generic set plus achieved times.

**Update "Status" and "Next steps" after each completed step.**

---

## The rules (agreed design — don't change without discussing)

### 1. Evidence, kept forever — never overwritten
- Every swim is **appended**, never replaced. A slower race is still a data
  point; a faster one **adds a row**, it doesn't overwrite the old PB. The app
  currently keeps only the current best time, so improvement is invisible —
  **this is the urgent fix**; history lost now can't be recovered later.
- Comp import **dedups by event + date + meet** and appends. Re-importing is
  safe and idempotent. (Known gap, ignored for now: SwimmingResults.org's front
  page only lists PB-beating races, so slower-than-PB races aren't captured
  there — deeper per-event pages would fill them in later.)

### 2. A swim knows what it is (so models can later decide what it means)
Two flags, orthogonal to `kind`, because a record's meaning depends on them:
- **`effort`** — `maximal | submaximal | unknown`. Meets/time trials default to
  maximal; training swims and set reps are submaximal unless marked. Only
  maximal continuous swims are candidates for critical-speed / PB reasoning.
- A **set rep is not a maximal single swim.** `20×100 @ 1:30` reps are stored,
  but must never be mistaken for a maximal 100 in a PB or CS query — they carry
  `effort_id` (a parent set-result) and default `effort='submaximal'`.

### 3. Two granularities, one destination
- **Single swim** — a race, a time trial, one logged swim. One row.
- **Set as swum** — a set (from `swimzone.set/1`) plus an achieved time per rep.
  Stored as **one parent effort + one child row per rep**.
- A **test set is just a set-as-swum tagged with a `protocol_id`** so the same
  test repeated under matched conditions can be graphed side by side across the
  season. The protocol **library** (named, structured, comparable tests) comes
  later; the tag is reserved now.

### 4. Benchmarks are a later, separate layer
The "current fitness" layer (CSS/pace200/working times, with age-weighted
confidence, coach-accepted) is **out of scope for this build**. Records is the
evidence store it will one day read. Don't build benchmark logic here — just
make sure the evidence carries enough (`effort`, `pb_at_swim`, provenance,
dates) to feed it later.

### 5. Offline-first, because capture happens poolside
- Poolside works **with or without wifi**. Capture writes locally and queues.
- Because swims are **append-only and immutable**, two devices never conflict —
  they only add. Sync is: **flush the outbox, dedup by id.** No merge logic.
- Every record carries a **client-generated UUID** at capture. Flushing an id
  the server already has is a no-op.
- **Logged-out capture is allowed**: no registry/athletes/saved sets, just a
  stopwatch against a typed/opened set, held locally and **attributed to a real
  athlete after signing in**. Same outbox mechanism — costs nothing extra.

---

## The two record shapes

App objects (JSON the pages/apps speak). Column mapping is the repository's job.

```jsonc
// swimzone.result/1  — one swim (race / time trial / single logged swim)
{
  "fmt": "swimzone.result/1",
  "id": "uuid",                 // client-generated, dedup key for sync
  "athleteId": "user-uuid",     // null while captured logged-out; set on attribution
  "kind": "meet",               // training | meet | time_trial
  "effort": "maximal",          // maximal | submaximal | unknown
  "swumOn": "2026-01-18",
  "stroke": "FS", "distM": 1500, "poolType": "50LC",
  "timeSec": 1110.0,
  "splits": [ … ],
  "source": "import",           // manual | stopwatch | import
  "provenance": {               // present for races/imports; omit for plain training
    "sanctioned": true, "meetName": "…", "awardingBody": "ASA", "country": "GB",
    "importRef": "swimmingresults:1609436:1500FS:2026-01-18"
  },
  "note": ""
}

// swimzone.setresult/1  — a set as swum
{
  "fmt": "swimzone.setresult/1",
  "id": "uuid",
  "athleteId": "user-uuid",
  "swumOn": "2026-09-26",
  "protocolId": null,           // set → this is a recognised test; null → ad-hoc training
  "set": { /* swimzone.set/1 snapshot — generic, as written */ },
  "conditions": { "rpe": 15, "location": "…", "poolType": "25SC" },
  "reps": [
    { "repNo": 1, "distM": 100, "stroke": "FS",
      "timeSec": 74.2, "startedAt": "…",   // startedAt captured at "go"; rest is derived, not stored
      "targetTime": "1:20", "pbAtSwim": 72.0 }   // resolved target + PB-at-swim, frozen for later comparison
  ]
}
```

`startedAt` + `timeSec` per rep is all Poolside records; achieved rest is
`startedAt[n+1] − (startedAt[n] + timeSec[n])`, **derived for display only** (like
pool conversion). A `fixed` set and a `rest` set produce the **same captured
data** — the interval type only changes what the clock prompts the coach to do.

---

## Database

New SQL goes in a **separate dated migration** (never edit an applied one), and
is tested with the accounts PGlite harness. RLS mirrors the accounts pattern:
read/add/edit gated by `has_log_access(athlete, …)` via SECURITY DEFINER
helpers — **no direct subqueries on RLS tables.**

### Additions to `performance_results` (dated migration)
```
+ client_uuid   uuid unique         -- idempotent sync / dedup key
+ effort        text  maximal|submaximal|unknown   (default 'unknown', check)
+ effort_id     uuid  null  → set_efforts(id)       -- rep of a set; null = single swim
+ rep_no        int   null                          -- rep index within the set
+ pb_at_swim_sec numeric null                       -- athlete PB when this was swum
+ sanctioned    bool  null
+ awarding_body text  null
+ country       text  null
+ meet_name     text  null
+ import_ref    text  null                          -- unique-ish; part of dedup
  -- dedup index: unique (athlete_user_id, stroke, dist_m, swum_on, coalesce(meet_name,''))
  --              for source='import'; plus unique(client_uuid) globally
```

### New parent table `set_efforts`
```
set_efforts   id, athlete_user_id, swum_on, protocol_id null,
              set_json jsonb,            -- swimzone.set/1 snapshot
              conditions jsonb,          -- rpe, location, pool
              client_uuid uuid unique, source, created_by, created_at
              -- RLS: readable/writable when has_log_access(athlete_user_id, …)
              -- reps live in performance_results with effort_id = this id
```

`protocol_id` will reference a future `test_protocols` table (the library) —
nullable now, no table yet.

### Query hygiene (important)
- **PB / CS / "best 100 FS" queries must exclude set reps and non-maximal swims:**
  filter `effort_id IS NULL AND effort = 'maximal'` (single maximal swims only).
- **Progression graphs** read *all* rows for an event ordered by `swum_on`.
- **Test comparison** reads `set_efforts` by `protocol_id` (or by identical
  `set_json` shape) and overlays their reps.

---

## Persistence mapping (repository tier)

| App object | Rows written |
|---|---|
| `swimzone.result/1` | one `performance_results` row (`effort_id` null) |
| `swimzone.setresult/1` | one `set_efforts` row + one `performance_results` row per rep (`effort_id`, `rep_no`, `pb_at_swim_sec`, `effort` from the set's intensity) |

Layering unchanged: **page/app → service → RepositoryFactory → repository →
Supabase**. Only repositories know column names, RPC names, and the
`swimzone.*` ↔ table translation.

**Results get a `Local` repository** — the documented exception to
"results are Supabase-only." Poolside capture writes to **IndexedDB + an
outbox**; a `SyncService` flushes to `SupabaseResultsRepository` when online,
deduping by `client_uuid`. Reads of *who my athletes are* still need the network
(the Reg grab).

---

## Service API (additions to `services/results.js`)

```js
// existing (stable): getResults, addResult, addResults, updateResult,
//                     deleteResult, validateResult

// single swims
getResultHistory(athleteId, { stroke, distM })   // all rows, oldest→newest (progression)
importResults(athleteId, rows)                    // dedup by event+date+meet, append-only
                                                  // → { added, skipped }

// sets as swum
addSetResult(athleteId, setResult)                // parent + rep rows, one client_uuid
getSetResults(athleteId, { protocolId, from, to })
getSetResultsByProtocol(protocolId, athleteId)    // side-by-side test comparison

// offline (Local repo + SyncService)
captureLocally(record)      // result | setresult → IndexedDB + outbox
listOutbox()  flushOutbox() // → { flushed, alreadyPresent }
attributeCaptured(localId, athleteId)   // logged-out capture → real athlete before flush
```

All return `{ data, error }` and degrade safely when Supabase isn't configured.
Signatures, once here, stay stable (accounts rule 6).

---

## Status (2026-09-26)

| Piece | State |
|---|---|
| `performance_results` base table | ✅ exists (Accounts migration) |
| Append-only comp import (dedup + keep history) | ❌ not built — **urgent, stops ongoing data loss** |
| `performance_results` additions (client_uuid, effort, provenance, effort_id…) | ❌ migration not written |
| `set_efforts` parent table + RLS | ❌ not built |
| `swimzone.result/1` / `swimzone.setresult/1` in repository | ❌ not built |
| Local results repo + outbox + SyncService | ❌ not built |
| Set format (`swimzone.set/1`) | ⏳ see `SET-FORMAT-CONTEXT.md` |
| Benchmarks / capability models / protocol library | ❌ deliberately later |

---

## Gotchas (carried from Accounts + new)

1. **`numeric` arrives as a string** — the results repo already converts
   `time_sec`; do the same for `pb_at_swim_sec`.
2. **Never overwrite.** No `updateResult` path may mutate a swim's time — edits
   are for notes/flags. Improvement lives in *new* rows.
3. **Reps aren't PBs.** Any query feeding targets/PB/CS must filter
   `effort_id IS NULL AND effort='maximal'`, or set reps poison the numbers.
4. **Idempotent sync.** `client_uuid` is the dedup key; flushing twice is safe.
5. **RLS via helpers only** — no subqueries on RLS tables (accounts rule 2 →
   HTTP 500).
6. Embedding `users` from a table with >1 FK needs the column hint
   (`users!athlete_user_id(...)`).

---

## Next steps (build order)

**Parts A and B are independent; C needs both.**

- **A — Records store.** Write the dated migration (additions + `set_efforts` +
  RLS + dedup index). Extend the results repository/service for both shapes and
  `importResults` append-only. **Do the comp-import fix first** — it's the live
  data-loss bug. Manual entry + comp import land here.
- **B — Set format.** Freeze `swimzone.set/1` in one shared module; Set Builder
  exports it, Poolside imports it. (See `SET-FORMAT-CONTEXT.md`.)
- **C — Poolside capture.** Local repo + IndexedDB outbox + `SyncService`;
  capture per-rep start/finish (fixed + rest modes, count-up clock is UI only);
  flush to Records; logged-out-then-attribute-later.
- **Then (separate work, on top of accounts):** Reg — grab athletes for a
  session, post back what they did; register → each athlete's log.
- **Later:** protocol library (named test sets, comparison views); benchmarks /
  capability models feeding target times.

---

## Rules for chats on this module

1. Rules in "The rules" above are decided — raise changes, don't just make them.
2. **Append-only.** Never overwrite or dedup-by-replace a swim.
3. New SQL = separate dated migration; test with `accounts.test.mjs` harness.
4. Permission logic stays in the DB (`has_log_access`); UI checks only show/hide.
5. Keep layering: page/app → service → RepositoryFactory → repository → Supabase.
6. Service signatures stay stable.
7. Set snapshots use `swimzone.set/1` verbatim — don't re-model the set here.
