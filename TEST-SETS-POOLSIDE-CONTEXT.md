# SwimZone — Test Sets & Poolside Round-Trip Context (2026-09-29)

Upload this at the start of a new chat to build **(1) the Test Set Library** and
**(2) sending a test set + athlete to the Poolside App, capturing, returning and
saving**. It is a self-contained handoff: current state, data shapes, the
decisions already made, the bugs already hit, and the design for the two new
pieces.

Also upload, when the chat needs them:
- `ATHLETE-RECORDS-CONTEXT.md` and `SET-FORMAT-CONTEXT.md` (the frozen contracts).
- `LOGIN-MEMBERSHIPS-CONTEXT.md` (auth, log sharing, guardians, RLS).
- The specific source files a task touches (listed per task below).

---

## Where the project is now (all built & verified)

**Stack:** React + Vite + Supabase. Repo: `D:\AlsCode\swimzone_v2`. Poolside is a
static page at `public/poolside/index.html` (no build step). Layering stays:
page → service → RepositoryFactory → repository → Supabase. Only repositories
import `supabaseClient`.

**Applied to Supabase and working:**
- `performance_results` extended: `client_uuid` (unique, non-partial), `effort`
  (maximal|submaximal|unknown, check), `effort_id` → `set_efforts`, `rep_no`,
  `pb_at_swim_sec`, `sanctioned`, `awarding_body`, `country`, `meet_name`,
  `import_ref`. Existing meet/time_trial rows backfilled to `effort='maximal'`.
- `set_efforts` table (parent of a set-as-swum): `id, athlete_user_id, swum_on,
  protocol_id (nullable, reserved), set_json jsonb, conditions jsonb,
  client_uuid unique, source, created_by, created_at`. RLS via `has_log_access`.
- **The old `performance_results_import_dedup` partial/expression index was
  DROPPED** — Supabase upsert `onConflict` can't target a partial/expression
  index (it 409s). Dedup is now the plain `client_uuid` unique index only.

**Migrations (in `supabase/migrations/`):**
- `20260927120000_athlete_records.sql` — the additions + `set_efforts` + RLS.
  (It still CREATES the import_dedup index in section 4 — applied migrations are
  never edited. `20260928120000_drop_import_dedup.sql` drops it, so a fresh setup
  from the chain ends up correct. The live DB had it dropped by hand already.)
- `20260928120000_drop_import_dedup.sql` — drops that index (idempotent).
- `20260929120000_test_protocols.sql` — Test Set Library; see
  `TEST-PROTOCOLS-CONTEXT.md`.
- Test harness: `supabase/tests/athlete_records.test.mjs` — **self-contained**
  (stubs `users` / base `performance_results` / `has_log_access`, applies just
  the athlete-records migration). Run: `node supabase/tests/athlete_records.test.mjs`
  (23/23). Needs `npm i @electric-sql/pglite`.

**Features working end-to-end:**
- **Load an athlete** into the coaching tools: Dashboard "My Athletes" (you +
  anyone whose log is shared with you — a parent's children via guardianship, no
  org needed) and Organisations members each have a **Load** button →
  `navigate('/athlete-setup', { state:{ loadAthlete:{ athleteId, name } } })`.
  Athlete Setup pre-fills from that athlete's records (shell if none).
- **Persist times to the DB**: Athlete Setup "Save times to records" — parsed
  (dated) SwimmingResults times save as **official meets**; typed (undated) times
  as **time trials**; append-only, idempotent.
- **SwimmingResults parsing** (`src/athlete/swimmingResults.js`): `parsePaste()`
  auto-detects the page — Individual Best Times (PBs, all strokes, LC+SC) vs a
  single-event All-Times page (every swim for one event) — and parses either.
  Rows parse whether copied as **tabs or spaces**. Captures date, meet, venue,
  licence, level, WA points. **Use page copy, not PDF** (PDF loses columns,
  wraps meet names, mangles ligatures).
- **Bests with a window filter** (`getAthleteBests(id, { windowMonths })`):
  fastest maximal per event within 1 / 6 / 12 months / all-time. Official and
  time-trial rank on **time alone** — the window is the only selector.
- **Athlete Records / training-log page** (`src/pages/AthleteRecords.jsx`, route
  `/athlete-records`): bests (window chips), per-event progression, sets/tests.
- **Poolside integration** (file-based, offline): Poolside's Results → "SwimZone"
  export emits `swimzone.import/1` (per-rep `swimzone.result/1`, stroke/pool
  mapped, splits kept). Athlete Setup ingests it back (`ingestPoolsideExport`),
  recognising the athlete by the id stamped in the file. Identity round-trips via
  `?aid=&name=&se=` on the Poolside URL.

---

## Data shapes (the contracts everything speaks)

- **`swimzone.set/1`** — a generic prescribed set (Set Builder writes, Poolside
  reads). Blocks → lines; each line: `stroke, distM, qty, targetRule` (absolute |
  PB±band | zone | bestAverage), `interval` (fixed onTime | rest restSec),
  `intensity`, `modifier`, `note`. No per-athlete times stored; resolved at read
  time. Module: `src/session/setFormat.js` (zero-import; also copied to
  `public/poolside/setFormat.js` via a prebuild script). Full spec in
  `SET-FORMAT-CONTEXT.md`.
- **`swimzone.result/1`** — one swim: `{ fmt, id (client uuid), athleteId, kind
  (training|meet|time_trial), effort, swumOn, stroke, distM, poolType, timeSec,
  splits, source (manual|stopwatch|import), provenance{sanctioned, meetName,
  venue, country, awardingBody, importRef}, note }`.
- **`swimzone.setresult/1`** — a set as swum: `{ fmt, id, athleteId, swumOn,
  protocolId, set (swimzone.set/1 snapshot), conditions{rpe,location,poolType},
  reps:[{repNo, distM, stroke, timeSec, startedAt, targetTime, pbAtSwim}] }`.
  Persists as one `set_efforts` + one `performance_results` row per rep
  (`effort_id`, `rep_no`, `effort='submaximal'`).
- **`swimzone.import/1`** — Poolside export envelope: `{ fmt, athlete{id,
  seNumber, name}, session{date,location}, records:[swimzone.result/1], skipped }`.

---

## Service API (stable — `src/services/results.js`)

```
getResults(id,{stroke,distM,kind,from,to})           list single swims (excludes set reps)
getResultHistory(id,{stroke,distM})                  progression, oldest→newest
getAthleteBests(id,{windowMonths})                   {pbByEvent, bests[]}, window = classify filter
addResult / addResults / updateResult / deleteResult
importResults(id, rows)                              append-only, dedup on deterministic client_uuid
importOfficialRecords(id, records)                   SwimmingResults records → importResults
persistAthleteTimes(id, times)                       grid → official (dated) + trials (undated)
ingestPoolsideExport(id, envelope)                   swimzone.import/1 → idempotent bulk insert
addSetResult(id, setResult)                          set_efforts + rep rows
getSetResults(id,{protocolId,from,to})               parent efforts
getSetResultsByProtocol(protocolId, id)              efforts + reps, side-by-side comparison
```
Repo (`SupabaseResultsRepository`): `list, listHistory, add, addMany,
addManyIdempotent (onConflict client_uuid), importMany (legacy, unused),
addSetResult, listSetEfforts, listSetEffortsByProtocol`.

---

## Gotchas already hit (don't rediscover these)

1. **Supabase `upsert` onConflict can't target a partial or expression index** —
   only a plain unique index (e.g. `client_uuid`). A partial index → 409 "no
   unique or exclusion constraint matching". This is why import_dedup was dropped.
2. **Deterministic dedup key = the swim's NATURAL identity**: `swim|athlete|
   stroke|distM|date|timeSec` → `stableUuid()` → `client_uuid`. So the SAME swim
   dedups whether it came from the best-times page (has a licence) or a
   single-event page (no licence); a heat and final same day differ by time and
   both survive. Licence is stored in `import_ref` for traceability only.
3. **UK dates**: parse `DD/MM/YYYY` explicitly, never via JS `Date` (which reads
   `12/03` as US December → mis-orders/mis-dedups PBs).
4. **RLS enforces writes**: `has_log_access(athlete,'add')`. A save to a swimmer
   you're not the athlete of / not an accepted guardian/sharer of → 403 "new row
   violates row-level security policy". Not a bug — a permission.
5. **409 vs 401**: a 409 means the request authenticated and hit a constraint; a
   401 "No API key found" is the gateway (env/anon-key). Don't conflate them.
6. **Set reps must never leak into PB/CS queries**: filter `effort_id IS NULL AND
   effort='maximal'`. Already done in `list`/`listHistory`.
7. **PowerShell**, not bash: line-continuation is a backtick, not `\`.
8. **The self-contained test** doesn't need the accounts migration chain.

---

## PIECE 1 — Test Set Library (`test_protocols`)

**The idea (already discussed & agreed in principle):** separate the *protocol*
(a test's definition) from the *result* (one performance of it). `set_efforts`
already reserves `protocol_id`; `getSetResultsByProtocol` already pulls every
performance of a test for side-by-side comparison. The missing half is the
`test_protocols` table the id points at.

**A protocol IS a `swimzone.set/1`** — that format already models multi-piece,
varying rest (fixed/rest interval), stroke per line, target pace/zone/best-average.
So most complexity is handled. What it doesn't yet carry: prescribed stroke rate
/ heart rate, and *measured* SR/HR/pace per rep.

**Don't build a fully general test engine.** The key insight: "finite
perturbations — coaches share the same tests." So it's a *library you reference*,
not a schema that expresses everything.

**Proposed schema:**
```
test_protocols
  id, name, owner_org_id (null = root/global library), set_json (swimzone.set/1),
  measures text[]        -- what each rep records: ['time','sr','hr','sc','rpe']
  visibility via the grant tree (root-curated global + club-private subtree)

set_efforts.protocol_id → test_protocols.id     (already reserved)
performance_results (a rep):
  time_sec first-class,
  + metrics jsonb        -- { sr, hr, sc, rpe, pace } — only what `measures` declares
```
- **Time stays first-class** (indexed; every test has it). Everything else lives
  in a `metrics` jsonb the protocol *declares* via `measures[]` — flexible without
  a column-per-metric migration, but structured.
- **Identity is by TAG, not by shape**: the coach picks the protocol from the
  library when running it; `protocol_id` stamps it; comparison is exact.
  Shape-matching ("this looks like your 7×200 test — tag it?") can come later as a
  *suggestion*, never the source of truth.
- **Sharing** = the grant tree: root owns the shared library everyone sees; a club
  owns private protocols visible to its subtree. Seed ~a dozen standard tests at
  root (CSS 400+200, T30, step tests, 20×100 @ turnaround) so most coaches never
  define their own.
- **Deliberately later**: prescribed SR/HR targets (measurement matters more than
  prescription for a test); and the analysis that turns test results into
  capability numbers (that's the benchmarks layer — it *reads* this store, doesn't
  live in it). Non-official/test times don't out/under-rank PBs — that's a
  classify-time filter (the 1/6/12/all window), agreed.

**Build order for Piece 1:** migration for `test_protocols` + `metrics` jsonb +
RLS (owner_org via grant tree); a protocols service (list library visible to me,
create club-private, root-curated seed); a small library UI (pick/define a test);
extend `addSetResult`/rep rows to store `metrics`. Files to upload:
`ATHLETE-RECORDS-CONTEXT.md`, `SET-FORMAT-CONTEXT.md`,
`LOGIN-MEMBERSHIPS-CONTEXT.md`, `src/services/results.js`,
`src/repositories/supabase/SupabaseResultsRepository.js`,
`src/session/setFormat.js`.

---

## PIECE 2 — Send a test set + athlete to Poolside, capture, return, save

**Today** Poolside defines its own events (stroke/dist/pool) and its export maps
to `swimzone.result/1` single swims. **The new flow** sends a *prescribed set*
(a `swimzone.set/1`, ideally a `test_protocols` entry) plus the athlete, so
Poolside times *against that set* and returns a `swimzone.setresult/1` (a
set-as-swum with a `protocolId`), which saves via `addSetResult`.

**Design:**
- **Handoff Set Builder → Poolside**: extend the Poolside URL/handoff to carry a
  set (and protocolId) alongside the athlete id. Poolside already reads
  `?aid=&name=&se=`; add the set. For a big set, a URL param may be too large —
  consider: (a) the set JSON compressed in the URL, or (b) Poolside fetches the
  set by id once online, or (c) file hand-off. The set format module is already
  copied into `public/poolside/` so Poolside can resolve `targetRule`/`interval`
  against the picked athlete's `pbByEvent`.
- **Poolside capture against a set**: Poolside walks the set's lines/reps rather
  than a free event; each rep records time (and later SR/HR/SC per the protocol's
  `measures`). Its offline model (event-sourced taps, IndexedDB, the outbox) is
  already built (`LocalResultsRepository`, `resultsSync`) — reuse it.
- **Return + save**: export a `swimzone.setresult/1` (set snapshot + reps +
  protocolId + conditions), ingest via `addSetResult(athleteId, setResult)`.
  Idempotent via `set_efforts.client_uuid` (deterministic from athlete + protocol
  + date + a session id).
- **Comparison**: `getSetResultsByProtocol` already returns every performance of
  that test with its reps for the season-over-season view (Athlete Records page).

**Build order for Piece 2:** set-carrying handoff (decide URL vs fetch-by-id vs
file); Poolside "swim this set" capture mode; `swimzone.setresult/1` export;
wire `addSetResult` ingest + a confirmation like the current official/trial save;
show set/test history on the records page (the section already exists). Files to
upload: this doc, `SET-FORMAT-CONTEXT.md`, `ATHLETE-RECORDS-CONTEXT.md`,
`public/poolside/index.html`, `src/session/setFormat.js`,
`src/services/results.js`, `src/services/resultsSync.js`,
`src/repositories/local/LocalResultsRepository.js`,
`src/pages/AthleteRecords.jsx`.

---

## Suggested order

Piece 1 first (the library gives Piece 2 a real protocol to send and a
`protocol_id` to stamp results with), then Piece 2. Both are independent of the
now-working records/persistence core.

## One open decision to settle early in Piece 2
How the set travels to Poolside: URL param (simplest, size-limited), fetch-by-id
(needs Poolside online + auth at hand-off), or file (matches today's offline
model). Lean fetch-by-id when online, file as the offline fallback — mirrors how
results already come back.
