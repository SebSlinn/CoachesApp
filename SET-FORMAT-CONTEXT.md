# SwimZone — Set Format Context (updated 2026-09-29)

Upload this file at the start of a chat about **the shared set format**: how a
set is serialized so it can be saved, exported, imported, and swum in a
different part of the app. Set Builder **writes** it; the Poolside App **reads**
it; Athlete Records **stores a snapshot** of it inside a set-result (see
`ATHLETE-RECORDS-CONTEXT.md`).

It sits below all three of those. Change it here, in one place, or the field
names drift into aliases the way the rest of the app once did.

**Update "Status" and "Open items" after each completed step.**

---

## The one rule that shapes everything

**A saved set never bakes in a *per-athlete* target.**

A coach can still type a flat IN that's the same for every swimmer — that's the
`absolute` base below, and it's one set, no explosion. What's forbidden is
taking `PB+10`, resolving it into one swimmer's `1:26`, and saving *that*: a
`PB+(6–12)` set stays `PB+(6–12)` for everyone, and the per-swimmer number is
**resolved at read time** against whoever is loaded. This is what stops a
million near-identical rows of the same set, and it's what makes a set
comparable line-by-line across athletes, months, and seasons.

So a plain set with literal IN and ON typed straight in still works exactly as
today (`absolute` target + `fixed` interval). PB±, zones and best-average are
*additional* target modes, not a replacement for typing a time.

Two consequences follow, and they're the whole reason the format looks the way
it does:

1. **Target is a rule, not a number** — `targetRule`, resolved per athlete.
2. **Interval is a type, not a bare clock** — `interval`, because "everyone
   leaves on 1:50" and "10 s rest after each swimmer finishes" are different
   departure styles (see below).

Seasons differ only in the rule/interval and the note — e.g. `on 1:50` tightening
to `on 1:30` a season later, note moving from `100fs pb 1:12–1:40` to
`100fs pb <1:12`. Same six lines, directly comparable.

---

## The contract — `swimzone.set/1`

```jsonc
{
  "fmt": "swimzone.set/1",         // versioned envelope — bump on breaking change
  "id": "uuid",                    // stable set id (client-generated)
  "name": "Thursday AT set",
  "note": "Set for 100fs pb 1:12–1:40",   // first-class coach context, not decoration
  "poolType": "25SC",              // 25SC | 50LC | 25Y — the pool the set is written for
  "blocks": [
    {
      "repeats": 1,
      "lines": [ /* line objects */ ]
    }
  ]
}
```

### Line object

```jsonc
{
  "type": "swim",                  // swim | rest | note
  "stroke": "FS",                  // FS | BK | BR | Fly | IM | Kick
  "distM": 100,                    // metres (number)
  "qty": 6,                        // reps (number)
  "targetRule": { … },             // how fast — see below (absent for rest/note lines)
  "interval": { … },               // when the next rep starts — see below
  "intensity": "AT",               // zone label for display/classification (A1…HVO, AT, CS…)
  "modifier": "Full",              // Full | Drill | Tech | …
  "note": ""                       // per-line free text (drill name etc.)
}
```

### `targetRule` — three bases, extensible

| Base | Shape | Means |
|---|---|---|
| Absolute | `{ "base":"absolute", "inTime":"1:26" }` | A literal IN time typed by the coach, **same for every swimmer**. No resolution — stored and shown as typed. This is the plain "type a time" case; it's still one generic set. |
| PB offset | `{ "base":"PB", "plusFrom":6, "plusTo":12 }` | PB + a **band** of seconds (per rep distance). Result is judged against the band, not a point. |
| Zone | `{ "base":"A1" }` … `{ "base":"HVO" }` | A prescribed energy zone; pace comes from the athlete's CSS/profile via the Classifier. |
| Best average | `{ "base":"bestAverage" }` | Maximal, hold an even average across the reps. **No pace prescribed** — the coaching point is the spread, so consistency/drop-off is what's captured, not adherence to a number. |

`plusFrom`/`plusTo` may be equal for a single-value target (`PB+10` → `6`/… no,
`plusFrom:10, plusTo:10`). A single number is just a zero-width band.

### `interval` — two departure types

| Type | Shape | Means |
|---|---|---|
| Fixed | `{ "type":"fixed", "onTime":"1:50" }` | Everyone leaves on the same pace clock. Today's default. |
| Rest | `{ "type":"rest", "restSec":10 }` | A gap after **each swimmer finishes**, so departures float per athlete and per rep (e.g. `6×200 best average, 10 s rest`). |

Not yet needed, reserve the names if they come up: `restRule` (scaling rest),
per-lane fixed intervals, rolling send-offs. Add them as new `interval.type`
values, don't overload the two above.

---

## Resolution — who turns rules into numbers, and when

The stored set never contains a *per-athlete* target. `absolute` needs no
resolution (it's already a literal time for everyone); PB±, zone and best-average
are resolved by each **reader**:

- **Set Builder** resolves rule-based `targetRule`s against the loaded athlete
  (`KEYS.ATHLETE`) for display, exactly as the screenshots show `PB+x` becoming
  a concrete IN time. An `absolute` line just shows its typed time. With no
  athlete loaded, a rule shows itself (`PB+(6–12)`, `on 1:50`).
- **Poolside App** resolves against the picked athlete when a set is opened to
  swim.
- **Athlete Records** does **not** resolve — it stores the generic set snapshot
  plus the *achieved* times and the athlete's **PB-at-time-of-swim**, so a
  comparison months later still means something after the PB has moved.

`restSec` for the Classifier:
- `fixed` → derive as now: `restSec = max(0, onTime − resolvedTargetTime)`.
- `rest` → taken **directly** from `interval.restSec`; nothing to derive.
  (This is cleaner — the app already runs on `restSec` internally.)

---

## Mapping to the live line object (what changes in code)

The live in-memory line in `session/` today carries **absolute** `targetTime`
and `onTime` strings. The serialized format above replaces those two with
`targetRule` and `interval`. So:

| Live field today | Serialized field | Change |
|---|---|---|
| `targetTime` (abs, e.g. `"1:26"`) | `targetRule` | A typed IN time maps to `{base:"absolute", inTime}` — so typing a time still works. The line editor *adds* rule modes (PB band / zone / best-average) alongside it; it doesn't remove the type-a-time box. |
| `onTime` (abs, e.g. `"1:50"`) | `interval` | `fixed` keeps `onTime`; new `rest` mode exposes `restSec`. |
| `distM` `qty` `stroke` `intensity` `modifier` `note` `type` | same | unchanged. |

`sbNewLine()` / `sbNewBlock()` (`session/utils.js`) gain `targetRule` +
`interval` defaults (`{base:"PB",plusFrom:0,plusTo:0}`, `{type:"fixed",onTime:""}`)
so old behaviour is the zero case. A tiny **loader shim** upgrades any legacy
saved set (bare `targetTime`/`onTime`) to the new shape on read, so nothing
already stored breaks.

Keep the `distM`/`targetTime` **dead-alias** discipline from `CLAUDE-CONTEXT.md`:
`e.target` is still the DOM API — never renamed.

---

## Worked examples

**Your seasonal AT set** (season A):
```jsonc
{ "fmt":"swimzone.set/1", "name":"AT 100s", "note":"Set for 100fs pb 1:12–1:40",
  "poolType":"25SC",
  "blocks":[{ "repeats":1, "lines":[
    { "type":"swim","stroke":"FS","distM":100,"qty":6,
      "targetRule":{"base":"PB","plusFrom":6,"plusTo":12},
      "interval":{"type":"fixed","onTime":"1:50"},"intensity":"AT" },
    { "type":"swim","stroke":"BK","distM":200,"qty":1,
      "targetRule":{"base":"A1"},
      "interval":{"type":"fixed","onTime":"4:00"},"intensity":"A1" },
    { "type":"swim","stroke":"FS","distM":100,"qty":6,
      "targetRule":{"base":"PB","plusFrom":6,"plusTo":12},
      "interval":{"type":"fixed","onTime":"1:50"},"intensity":"AT" },
    { "type":"swim","stroke":"BK","distM":200,"qty":1,
      "targetRule":{"base":"A1"},
      "interval":{"type":"fixed","onTime":"4:00"},"intensity":"A1" }
  ]}]}
```
Season B is the same file with `onTime:"1:30"` and `note:"Set for 100fs pb <1:12"`.

**Best-average set with rest departures** (`6×200, best average, 10 s rest`):
```jsonc
{ "type":"swim","stroke":"FS","distM":200,"qty":6,
  "targetRule":{"base":"bestAverage"},
  "interval":{"type":"rest","restSec":10},"intensity":"AT" }
```

---

---

## Optional line fields (added 2026-09-29 — additive, no `fmt` bump)

Used by the Test Set Library (`TEST-PROTOCOLS-CONTEXT.md`); any set may carry
them, and readers that don't know them ignore them.

| Field | Shape | Means |
|---|---|---|
| `measures` | `["time","sc"]` | What to record per rep on this line; overrides the protocol default. `[]` = prompt for nothing. Values: `time, splits, sc, sr, hr, rpe, lactate`. |
| `constraints` | `{ scMax, scMin, hrMin, hrMax, srMin, srMax }` | Prescribed limits. Shown to the coach and flagged if broken — never block a save. |
| `interval.param` | `"sendOff"` | This line's `onTime`/`restSec` is controlled by the protocol param of that name. |

## Open items

- Set Builder line editor: rule-input mode (base picker + band / zone / best-avg).
- Loader shim for legacy `targetTime`/`onTime` sets → `targetRule`/`interval`.
- Resolver helper (pure JS, in `zones/` or `session/`): `(targetRule, athlete,
  distM) → resolved IN band` and `(interval, resolvedTarget) → restSec`. Keep it
  zero-import if it lands in `zones/`.
- Decide where the shared format module lives so all three apps import one copy
  (candidate: `session/setFormat.js`, re-exported from `session/index.js`).

---

## Rules for chats on the set format

1. The set is **generic** — never add absolute target times to the stored shape.
2. New target/interval kinds are **new `base` / `type` values**, not overloads.
3. Bump `fmt` (`swimzone.set/1` → `/2`) only on a breaking change; add optional
   fields without bumping.
4. One shared module defines this; Set Builder, Poolside and Records import it —
   no local re-declarations.
5. Keep the canonical field names above; honour the dead-alias list in
   `CLAUDE-CONTEXT.md`.
