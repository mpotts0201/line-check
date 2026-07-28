# REFACTOR PROPOSAL — Sync trigger layer → one explicit state machine

Working document, v3. We iterate on this until every line is understood, THEN we
build. Nothing here is implemented yet. Add questions anywhere as `> Q:` lines.

- v2 (2026-07-27): timed retry/backoff dropped.
- v3 (2026-07-27): **`attempts` / give-up / quarantine dropped too** (owner
  decision, trade acknowledged in §4). `flush.ts` now gets deletions as well —
  it only gets simpler.

---

## 1. Why

The current trigger layer (`autoSync.ts` + `createSyncScheduler` in `retry.ts` +
`requestFlush.ts` + the wiring in `_layout.tsx`) fails the project's own bar
(TODO.md): *"I can explain any line if asked."* Three files hand functions to each
other, `flush` names three different things, and the behavior only exists once
everything is composed.

The fix is not renaming. It's removing indirection AND removing machinery that
doesn't earn its keep in a POC: **one trigger file, one explicit two-state
machine, plain calls, no retry counters.** The style critique driving this has a
name — *test-induced design damage*; the feature critique is simpler: backoff and
give-up were lipstick on failure, not insight into it. The diagnostic that
actually helped (surfaced Postgrest error, 7/21) stays.

## 2. The design, in one paragraph

The sync engine is the state machine — the ONE actor in the app, like the Player
node in a Godot scene. Screens and the network listener don't sync anything
themselves; they *poke* the engine (`syncNow()`), and the engine decides based on
its state. Audits are not machines — a card's badge is a computed label from
queue data, the way a Godot chest has `is_open` but no state machine. Failed
pushes are not managed, counted, or scheduled: the queue simply stays intact and
the next poke tries again.

## 3. States, inputs, events

**States** (what the engine is DOING — exactly one at a time):

| State | Meaning | Godot analogy |
|---|---|---|
| `idle` | nothing happening | player standing |
| `syncing` | a push to Supabase is in flight | mid-attack animation |

**Input** (a fact about the world, NOT a state): `isOnline`.

**Events** (the pokes — each means "try a sync now, if it makes sense"):

1. Signal comes back (offline → online edge from NetInfo)
2. Submit pressed → the review screen calls `syncNow()`
3. Manual "Sync now" on History (the existing button — now a permanent fixture,
   not a placeholder for 8b-iii)

Transition behavior, complete:

| While in… | any poke, online | any poke, offline | push finishes (success OR failure) |
|---|---|---|---|
| **idle** | → syncing | ignored (audit already safe in SQLite) | — |
| **syncing** | ignored (single flight) | ignored | → idle |

That is the whole machine. Failure and success end in the same state; the
difference lives in the data (queue drained or not) and the surfaced error.

## 4. Dropped features and the acknowledged trade

**Dropped in v2 — timed retry/backoff.** With 3 attempts at 2s/4s spacing it only
auto-healed sub-6-second blips, while accelerating permanent failures into
give-up within ~6 seconds. Event-driven retries (edge, Submit, manual) happen at
moments where success is newly plausible — better failure behavior for free.

**Dropped in v3 — `attempts`, MAX_ATTEMPTS, give-up, the stuck state.** Owner's
reasoning, confirmed by analysis:

- The counter never diagnosed anything — "failed 3 times" says nothing about
  *why*. The real diagnostic is the surfaced error (console.warn always,
  decoded Postgrest code under `__DEV__`) from 7/21. That stays.
- Give-up's original job (stop a battery-burning retry loop) evaporated with the
  timer in v2. Event-driven re-attempts cost a few requests a day.
- A record that never syncs is an app bug (contract drift) or bad data the Zod
  gate should have caught — not something a counter fixes or a restaurant
  manager can act on. Post-fix, a no-give-up queue drains itself on the next
  poke; the give-up design needed a manual reset (the 7/21 incident proved it).

**The acknowledged trade (owner sign-off, 2026-07-27):** `attempts` had quietly
become a quarantine — after 3 failures, poison rows were filtered out so later
audits could sync around them. Without it, one permanently-rejected row blocks
the all-or-nothing batch, and NOTHING syncs until the underlying bug is fixed
(then everything drains automatically). Accepted because: poison sources are
rare here (single-writer backend, client-side Zod validation), the blocked-batch
weakness is already the documented poison-batch limitation, and the production
remedy has a name — fail-then-split bisection — for the README known-limitations
writeup and interviews.

## 5. The proposed file — `src/sync/syncEngine.ts` (complete)

This is the whole trigger layer. Read it top to bottom; flag any line.

```ts
// Decides WHEN to sync. The actual pushing lives in flush.ts.
// One state machine, attached to the one actor in the app (like a Godot player).
// Pokes: the phone regaining signal, a screen calling syncNow() after completing
// an audit, and the manual Sync now button.

import NetInfo from "@react-native-community/netinfo";
import { type SqlDb } from "../db/types";
import { supabase } from "../supabase";
import { flushSyncQueue } from "./flush";

// The engine is always in exactly ONE of these modes.
type EngineStatus = "idle" | "syncing";

let db: SqlDb | null = null;   // written once at startup; why screens can call syncNow() bare
let isOnline = false;          // input from the phone — a fact, not a mode
let status: EngineStatus = "idle";

// Called once from the root layout. Watches connectivity; when the phone goes
// from offline to online, syncs. Returns a stop function for unmount.
export function startSyncEngine(database: SqlDb): () => void {
  db = database;
  // addEventListener does two things in ONE call: starts listening IMMEDIATELY,
  // and hands back the OFF switch. `unsubscribe` names what the stored function
  // does WHEN CALLED later — Godot: connect() that returns its own disconnect().
  const unsubscribe = NetInfo.addEventListener((state) => {
    // The phone's report is messy (fields can be null = "don't know").
    // Count as online only if definitely connected and not definitely unreachable.
    const nowOnline =
      state.isConnected === true && state.isInternetReachable !== false;
    const cameBackOnline = nowOnline && !isOnline; // offline → online edge, the ONLY trigger
    isOnline = nowOnline;
    if (cameBackOnline) void syncNow(); // "start this, don't wait around for it"
  });
  // The engine's own, bigger off switch: stop listening AND blank the sticky
  // notes. Handed up to the caller — §5b shows who stores it and presses it.
  return () => {
    unsubscribe();
    status = "idle";
    isOnline = false;
    db = null;
  };
}

// Safe to call from anywhere, any time. Quietly does nothing when offline (the
// audit is already durable in SQLite; the reconnect trigger covers it later),
// when the engine isn't started, or when a push is already in flight.
export async function syncNow(): Promise<void> {
  if (!db || !isOnline || status === "syncing") return;

  status = "syncing";
  try {
    // On failure, flush.ts leaves the queue fully intact and surfaces the error;
    // the next poke (signal edge, Submit, manual button) simply tries again.
    // There is nothing to count and nothing to schedule.
    await flushSyncQueue(db, supabase);
  } catch (error) {
    // flush.ts returns push failures as values, so this only catches a throw from
    // its own local db reads/writes. Every poke is fire-and-forget, so rethrowing
    // would be an unhandled rejection nobody sees — warn instead. The queue is
    // untouched either way; the next poke tries again.
    console.warn("[sync] unexpected failure", error);
  } finally {
    status = "idle"; // ALWAYS comes back down, even if the push throws
  }
}
```

Line-by-line notes on the non-obvious bits:

- **`void syncNow()`** — "fire and forget": run it, don't await it. Callers have
  no reason to wait for the network.
- **`try/finally`** — the busy flag ALWAYS comes down, even if the push explodes;
  otherwise one crash would lock sync forever.
- **`ReturnType`-style tricks, timers, results** — none left. The engine ignores
  the flush result on purpose: success/failure is visible in the queue data (the
  badge) and the surfaced error, not in engine state.

## 5b. The consumer — `app/_layout.tsx` (the only place the engine starts)

The old `AutoSync` component (timer Set, scheduler wiring, requester registry —
~30 lines) is replaced entirely by this:

```tsx
// Renders nothing. Exists so the engine starts when the app mounts and stops
// if it ever unmounts. Lives inside SQLiteProvider so it can grab the db handle.
function AutoSync() {
  const db = useSQLiteContext();

  useEffect(() => {
    // _ready(): start the engine. It hands back its own off switch.
    const stopSyncEngine = startSyncEngine(db);

    // Whatever a useEffect RETURNS, React stores and calls at teardown
    // (_exit_tree()): on unmount, or before re-running if `db` ever changed.
    return stopSyncEngine;
  }, [db]);

  return null;
}
```

The off-switch chain, top to bottom — each layer hands its "undo" UP to whoever
started it, because only the caller knows when it's time to stop:

1. `NetInfo.addEventListener` starts listening, hands the engine `unsubscribe`.
2. `startSyncEngine` starts everything, hands React a bigger off switch
   (`unsubscribe` + blank the sticky notes).
3. React stores it as the effect's cleanup and presses it at teardown.

Import changes in `_layout.tsx`: `startSyncEngine` comes in; NetInfo, `supabase`,
`flushSyncQueue`, `createAutoSync`, `createSyncScheduler`, and
`registerFlushRequester` all go. `RootLayout` itself is untouched — `<AutoSync />`
stays exactly where it is inside `SQLiteProvider`.

## 6. What happens to every existing file

| File | Fate |
|---|---|
| `src/sync/syncEngine.ts` | **NEW** — the file above |
| `src/sync/autoSync.ts` + test | **deleted** (both jobs live in `syncNow`'s guard line) |
| `src/sync/requestFlush.ts` | **deleted** (screens import `syncNow` directly) |
| `src/sync/retry.ts` + test | **deleted** (backoff and MAX_ATTEMPTS gone entirely) |
| `src/sync/flush.ts` | **deletions + one line**: eligible/`attempts` filter, `incrementSyncQueueAttempts` call, and `attempts` in the error result removed; `FlushResult` error variant becomes `{ status: "error"; error: unknown }`. ADDED: `console.warn(failed)` in the failure branch — the one choke point every trigger flows through (today the warn lives only in the History button handler, so Submit/edge failures are totally silent — found during gate Q3). In production this line is where telemetry would hang. |
| `src/sync/flush.test.ts` | attempts-related assertions removed; idempotency, FK ordering, delete-on-confirm, crash recovery all stay |
| `src/db/syncQueue.ts` | `incrementSyncQueueAttempts` deleted; `getAuditSyncStates` simplifies to synced/pending (no `maxAttempts`, no threshold param); `getSyncQueueStats` drops the gave-up split |
| DB schema | new migration drops the `attempts` column from `sync_queue` (OPEN: or leave it dead — owner's call, see §10) |
| `app/_layout.tsx` | `AutoSync` rewritten — see §5b (effect starts the engine, returns its stop function) |
| `app/audit/review/[auditId].tsx` | `requestFlush()` → `void syncNow()` (direct import) |
| `app/history/index.tsx` | `MAX_ATTEMPTS` import gone; badge states become Synced ✓ / Not synced — N waiting; Sync now button stays, now calling `syncNow()` for the shared single-flight guard |
| `CLAUDE.md` | architecture: backoff line removed; `sync_queue` model loses `attempts`; retry story = "queue stays intact; every trigger re-attempts" |
| `TODO.md` | 8b-iii **dissolves** (no stuck state, no reset; button stays); 8b-iv shrinks; unplanned rewrite bullet added [x]; mirror TODO_PLAIN_ENGLISH.md (renamed from TODO_FOR_DUMMIES.md, 2026-07-28) |

End state: `src/sync/` is **two files** — the worker (`flush.ts`) and the trigger
(`syncEngine.ts`). The word "flush" exists in one file, called from one place.
Note: 8b-i/8b-ii (committed) get partially reworked — their derived-state logic
loses the `stuck` branch; their tests update accordingly.

## 7. Testing — kept, without the damage

Production code contains zero test plumbing. The trickery lives in the test file:
`jest.mock("./flush")` (stunt-double worker), `jest.mock("@react-native-community/netinfo")`
(captured listener fed fake reports). No fake timers — there are no timers.

`syncEngine.test.ts` cases:
1. offline→online edge syncs exactly once
2. steady "still online" events don't re-sync
3. offline events never sync
4. `syncNow()` while offline does nothing
5. `syncNow()` during an in-flight push doesn't double-run
6. after cleanup, pokes do nothing
7. an unexpected worker throw is swallowed (warned) and the engine returns to
   idle — added in R2 with the catch branch (see §10)

Queue behaviors stay covered where they live (`flush.test.ts`): failure leaves the
queue intact; a later successful push drains it; idempotent re-runs.

## 8. Comprehension gate (the go/no-go)

Before a line is written, Matt narrates these against §5, out loud, no notes:

1. Complete an audit while online — which lines run, in order?
2. Complete an audit in the walk-in — what happens at Submit, and what makes the
   data reach Supabase later?
3. A push fails while steadily online (server hiccup). What state is the engine
   in afterward, where did the error go, and what are the three ways this audit
   eventually syncs?
4. A row is truly poisoned (server rejects it every time). What happens to the
   rest of the queue, and why is that acceptable here? (§4's trade, in your own
   words — this is the interview question.)

If any answer doesn't come, we simplify further. We do not proceed past confusion.

## 9. Verification (after build)

1. `npx --no-install tsc --noEmit` (Claude, WSL)
2. `npx jest` on Windows — full suite green
3. code-reviewer agent; resolve Critical/Warning
4. Device: complete online → Synced ✓, no tap; airplane-mode complete → Not
   synced → reconnect → Synced ✓; failure case → badge stays Not synced, error
   in console, manual Sync now retries
5. `npx eslint .` on Windows (standing Gate-0 carry-over)

Docs in the same commit: DECISIONS.md entry (state machine over DI plumbing;
backoff AND attempts dropped with §4's analysis and the acknowledged quarantine
trade; alternatives rejected: rename-only, XState, no-tests) + CLAUDE.md edits +
TODO.md restructure (8b-iii dissolved), mirrored in TODO_PLAIN_ENGLISH.md.

## 10. Open questions / iteration log

- **GATE (§8) PASSED 2026-07-27** — four questions, interview-style. Q3 found a
  real defect (silent error path, fix folded into §6); Q4 defended the
  quarantine trade with the fail-then-split remedy named. Build is unlocked.

- v1 → v2: timed retry/backoff dropped. States 3 → 2.
- v2 → v3: `attempts`/give-up/quarantine dropped (owner decision, trade in §4).
  `retry.ts` deleted entirely; `flush.ts` gains deletions; 8b-iii dissolves;
  global Sync now button is now permanent (resolves v2's OPEN question).
- Gate Q3 finding (2026-07-27): auto/Submit-triggered flush failures are silent
  today — the 7/21 `console.warn` lives only in the History button handler.
  Fix folded into the plan: warn moves to `flush.ts`'s failure branch (the
  choke point), History keeps its `__DEV__` display. The comprehension gate
  found a real defect — the process works.
- R2 planning finding (2026-07-28): the line above contradicts §5 — "History
  keeps its `__DEV__` display" can't survive the swap, because the button now
  calls `syncNow()`, which by design returns nothing. Owner decisions: (1) the
  status line goes **console-only** — after a manual sync History derives
  "Up to date / N waiting / gave up" from queue stats; `formatSyncError` stays
  for the screen's own catch paths (load/reset/unexpected throw); (2) the
  `flush.ts` failure-branch `console.warn` was pulled forward from R3 into R2
  so no session ships with fully-silent flush failures.
- R2 review finding (2026-07-28): `flushSyncQueue` can THROW past its own
  error handling — `getPendingSyncQueue` and the success-path drain
  transaction sit outside its try — and every poke is fire-and-forget, so
  that rejection would be unhandled at all three call sites. Fix: `syncNow`
  gains a catch branch (warn + swallow; the §5 code above is updated), which
  finally makes "safe to call from anywhere, any time" literally true. Test
  case 7 covers it. This is the residue of 8b-ii.5's waived W1, now resolved
  at the engine rather than per call site.
- OPEN: `attempts` column — drop via a small migration (cleaner) or leave dead
  in the schema (zero-risk)? Owner's call at build time.
- OPEN: README known-limitations wording — merge the poison-batch note and the
  no-quarantine trade into one story (fail-then-split bisection as the
  production remedy).
- PARKED (post-7/31 polish, owner request 2026-07-27): History badge updates in
  real time instead of on focus — needs a data→UI notification (small Zustand
  store or refetch-on-sync-complete signal). Explicitly NOT part of this
  refactor.
