# SYNC_STATUS_FIX — live sync badges on History

**Status: approved and built 2026-07-29 (ticket S1). §3–§6 below are the plan
as written; the shipped code matches it.** Agreed direction (2026-07-29
discussion): Option A — a tiny Zustand store as the engine's signal bus. This
unparked the TODO item "History badge updates in real time instead of on focus."

---

## 1. The problem, in one paragraph

The History screen's badges come from `syncStates`, component state filled by
`refresh()` — an SQLite re-query. `refresh()` runs on focus, after the manual
Sync now button, and after a dev reset. Nothing else. So when a *background*
sync fires (you're sitting on History in airplane mode, signal returns, the
reconnect edge pokes `syncNow()`), the queue drains in SQLite but no one tells
the screen to re-read. The badge stays "Not synced" until the next focus. It is
not a FlatList rendering issue — tapping Sync now updates badges instantly with
no refocus, same list, same rows.

## 2. The design, in one paragraph

The engine gains a way to say "a flush just ended" — Godot: the singleton
finally gets a `sync_finished` signal, and the History screen connects to it.
The signal bus is a ~12-line Zustand store holding two values: the engine's
`status` (which *moves* there from the engine's module variable — one source of
truth, not a mirror) and `flushCount`, a counter bumped every time a flush
attempt ends. History subscribes to `flushCount`; when it changes, the screen
runs its **existing** `refresh()`. The store carries the *signal*, never the
*data* — SQLite stays the source of truth, and screens keep reading it through
the repository layer. Nothing about WHEN we sync changes; this is purely
"the outcome becomes observable."

Why a counter and not a boolean/timestamp: a counter changes on every emission
(5 → 6 → 7), so React's dependency comparison sees every flush, including two
back-to-back ones. A boolean can stay `false` → `false` and be missed; a
timestamp drags in clock reads we don't need.

## 3. New file: `src/sync/syncStore.ts`

The whole file, so there are no surprises at review time:

```ts
// The sync engine's observable face. The engine WRITES here (it has no React
// hooks — it uses the store's plain setState/getState statics); screens READ
// here with the hook. Godot: an autoload singleton whose exported state the
// engine owns, and whose changes ARE the signals screens connect to.
import { create } from "zustand";

// Mirrors the engine's two modes. Lives here now (not in syncEngine.ts)
// because the store is the single home of engine status.
export type SyncStatus = "idle" | "syncing";

type SyncStoreState = {
  status: SyncStatus;
  // How many flush attempts have ENDED (success or failure). This is the
  // sync_finished signal, shaped as a number so every emission is a change.
  flushCount: number;
};

export const useSyncStore = create<SyncStoreState>()(() => ({
  status: "idle",
  flushCount: 0,
}));
```

Notes for review:

- `create()` returns a hook, but that hook also carries `getState` / `setState`
  / `subscribe` as statics — that is why the engine (a plain module, no React)
  can write to it. One import works on both sides of the React boundary. This
  is Zustand's intended use, not a trick.
- No actions/methods on the store. The engine is the only writer and it's two
  `setState` calls; wrapping them in named actions would be ceremony for an
  audience of one.
- Named export, no default (repo convention). No test file of its own — it's a
  declaration with zero logic; it gets exercised through the engine tests (§6).

## 4. Changes to `src/sync/syncEngine.ts`

Three edits, all small. The engine's *decisions* (when to sync, the guards, the
edge detection) do not change.

**(a) The `status` module variable moves into the store.** Today:

```ts
type EngineStatus = "idle" | "syncing";
let status: EngineStatus = "idle";
```

Both lines go. The type now lives in the store file (`SyncStatus`); the value
lives in the store. `db` and `isOnline` stay as module variables — they are
inputs the UI has no claim on (yet; see §9).

**(b) `syncNow()` reads and writes status through the store, and emits the
signal in `finally`.** After:

```ts
export async function syncNow(): Promise<void> {
  if (!db || !isOnline || useSyncStore.getState().status === "syncing") return;

  useSyncStore.setState({ status: "syncing" });
  try {
    await flushSyncQueue(db, supabase);
  } catch (error) {
    console.warn("[sync] unexpected failure", error);
  } finally {
    // One atomic write: the busy flag comes down AND sync_finished fires.
    // In finally on purpose — subscribers re-read SQLite either way, and on
    // failure the re-read simply shows the queue still intact.
    useSyncStore.setState((s) => ({ status: "idle", flushCount: s.flushCount + 1 }));
  }
}
```

Things to notice:

- The single-flight guard is the same guard, reading the same value from its
  new home. There is exactly one `status` in the app.
- The counter bumps **only when a flush attempt actually ran**. The early
  return (offline / not started / already syncing) emits nothing — no flush
  ended, so no signal. This matters: if the guard path emitted, a poke arriving
  mid-flight would trigger a pointless refresh.
- It bumps on **failure too** (that's why it's in `finally`). The signal means
  "the world may have changed, re-read it," not "success." On failure the
  re-read shows the same pending counts — a wasted-but-cheap query, and far
  simpler than teaching the signal to carry meaning the engine deliberately
  doesn't track (DECISIONS 2026-07-28: the engine ignores the flush result).

**(c) The stop function resets the store** alongside the other module state:

```ts
return () => {
  unsubscribe();
  useSyncStore.setState({ status: "idle", flushCount: 0 });
  isOnline = false;
  db = null;
};
```

Same contract as today: after cleanup, the engine left nothing behind. (This
also gives tests a clean store between cases for free — `afterEach` already
calls `stop()`.)

## 5. Changes to `app/history/index.tsx`

Two additions; nothing existing moves.

**(a) Subscribe to the signal:**

```ts
const flushCount = useSyncStore((s) => s.flushCount);
```

The selector means this component re-renders only when `flushCount` changes —
not on `status` flips, which History doesn't read (yet, §9).

**(b) React to it, next to the existing focus effect:**

```ts
// The engine's sync_finished signal: a background flush ended (reconnect
// edge, or a completion poke from another screen) — re-read badges from
// SQLite. Manual syncs also land here, making their runSync() refresh
// redundant but harmless (two cheap reads of the same truth).
useEffect(() => {
  refresh();
}, [flushCount, refresh]);
```

Behavior notes, for the "explain any line" bar:

- **On mount this effect fires once** (every effect does), so first load runs
  `refresh()` twice — once here, once from the focus effect. Both are cheap
  SELECTs of the same data; the second setState is a no-op re-render at worst.
  Suppressing the initial run needs a `useRef` first-run latch — cleverness
  with a lifecycle footnote, to save one read. Not worth it; the comment says
  so and we move on.
- **History stays mounted behind pushed screens** (it's in the Stack), so this
  effect keeps working while a detail screen is on top — return to History and
  the badges are already right, no focus-flash from stale to fresh.
- The existing focus effect **stays**. It covers the cases the signal can't:
  first mount and audits completed while History was unmounted.
- `runSync()`'s own `refresh()` call could now be deleted (the signal covers
  it), but leaving it is one less behavior change to reason about in this
  diff. Removing it is a natural part of 8b-iv's SyncBar extraction instead.

## 6. Tests (`src/sync/syncEngine.test.ts`)

The existing seven cases stand unchanged — they observe the engine through
`mockFlush`, and the guard behaves identically. The store needs **no mocking**:
Zustand is plain JS and works in Jest as-is, and `stop()` in the existing
`afterEach` already resets it (§4c). New cases, reading
`useSyncStore.getState()` directly:

1. **A completed flush bumps `flushCount` and returns status to idle** —
   poke while online, settle, expect `flushCount` to be 1 and status `"idle"`.
2. **A failed flush still bumps `flushCount`** — `mockRejectedValueOnce`,
   await `syncNow()`, expect the bump (the signal fires from `finally`).
3. **A guarded no-op poke does not bump** — `syncNow()` while offline,
   expect `flushCount` still 0.
4. **Status is observable mid-flight** — reuse the existing gate pattern
   (hold the flush open): status reads `"syncing"` before `release()`,
   `"idle"` after. This replaces indirect inference with a direct read.

No UI tests for the History effect, per the standing rule: the effect is one
line of glue; the logic worth testing lives in the engine, and real UI
verification is the device pass (§8).

## 7. Install step (owner, Windows Terminal)

Zustand is in CLAUDE.md's stack list but is **not actually in package.json** —
nothing has needed it until now. Before the implementation session:

```
npx expo install zustand
```

Pure JS, no native code — Expo Go (SDK 54) compatibility is unaffected, no
Metro config changes, though restart Metro after the install as usual. This is
the project's first Zustand usage, so the CLAUDE.md stack line finally becomes
true.

## 8. Device verification (definition of done)

1. Complete an audit in airplane mode → History shows "Not synced — N waiting."
2. **Stay on the History screen.** Turn airplane mode off.
3. Within a beat of NetInfo noticing: badge flips to "Synced ✓" — **no tap, no
   navigation, no refocus.** This is the scenario that fails today.
4. Regression: manual Sync now still works; forced failure (bad Supabase key)
   still warns once in console and leaves the badge "Not synced"; the next
   reconnect drains it.

## 9. Explicit non-goals (parked, not forgotten)

- **Sync now button reading `status` from the store** — would make background
  flushes show "Syncing…" and disable the buttons, replacing the local
  `syncing` state. Real improvement, but it changes button semantics
  (background syncs would briefly disable Reset) and belongs with 8b-iv's
  SyncBar extraction, where that header is already being reshaped. Not in this
  ticket.
- **`isOnline` in the store** (an offline indicator in the UI) — same story:
  trivially enabled by this design, deliberately not now.
- **Store carrying badge data** — rejected permanently, not parked. Screens
  read SQLite through the repository layer; the store is a doorbell, not a
  filing cabinet.

## 10. Alternatives already rejected (2026-07-29 discussion)

- **expo-sqlite `addDatabaseChangeListener`** — real push mechanism, wrong
  event shape: fires per row (a 12-row drain = 12+ callbacks, needs a
  debounce), fires for unrelated `sync_queue` writes (enqueue), only sees its
  own connection, and needs a global `enableChangeListener` flip for one
  screen. We want "a flush ended," which exists at exactly one line in the
  engine.
- **Hand-rolled listener set on the engine** (`onSyncFinished(cb)`) — bespoke
  pub/sub is the hand-rolled plumbing the comprehension rule exists to avoid;
  Zustand is the stack's blessed version of the same thing.
- **Polling** — the battery-burning timer loop the R-refactor just deleted, in
  a party hat.

## 11. Bookkeeping (same session as the implementation)

- **TODO.md**: move the parked badge bullet into Up Next as a ticket (suggest
  **S1 — live badge signal**, governing doc: this file), mark it `[x]` when
  done; mirror in TODO_PLAIN_ENGLISH.md, same commit.
- **DECISIONS.md** entry, drafted so the session just appends it:
  > **2026-07-XX — Sync store carries the signal, not the data.** The engine's
  > `status` moves into a Zustand store and a `flushCount` counter becomes the
  > `sync_finished` signal; History re-queries SQLite when it fires. The store
  > never holds query results — SQLite remains the only read path.
  > Alternatives rejected: SQLite change listener (per-row noise, debounce,
  > per-connection caveat), hand-rolled emitter (bespoke pub/sub), polling.
- **CLAUDE.md**: no changes needed — the architecture section's "sync state is
  always visible" line simply becomes more true, and Zustand is already listed.

## 12. Size and pace

One `- [ ]` bullet, one session: new store file (~12 lines), ~6 changed lines
in the engine, ~5 added lines in History, 4 new test cases, docs per §11.
`npx tsc --noEmit` clean from WSL; jest and eslint run on Windows as usual.
