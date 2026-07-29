# History screen refactor proposal

**Status:** PROPOSAL — no code changed yet. Owner reviews, answers the open
questions in §5, then we execute §6 one step per session.

**What this is:** the plan for shrinking `app/history/index.tsx` (316 lines,
flagged in LINE_AUDIT.md) into a screen that reads top-to-bottom as "load the
list, render the list." This is ticket **8b-iv** (TODO.md:119) executed in
full, so it also picks up the decisions DECISIONS.md parked with that ticket.

---

## 1. The problem, concretely

`app/history/index.tsx` is three things braided into one file:

| Concern | Lines (approx) | What it is |
| --- | --- | --- |
| The screen itself | ~110 | load audits + sync states, FlatList, focus/flushCount refresh |
| The sync bar | ~120 | Sync now button, status line, dev reset button, `formatSyncError`, their handlers and styles |
| The audit card | ~85 | per-audit Pressable, `Count` tiles, `formatDate`, `syncBadge`/`BADGE_COLOR`, card styles |

Reading the file today means holding all three at once — the sync handlers sit
between the data loading and the render, and the badge helpers sit above both.

Godot framing: this is one script doing the job of a parent node and two child
scenes. The fix is the usual one — cut the children into their own scenes, let
the parent instance them, and keep signals (the Zustand store's `flushCount`)
as the only cross-talk.

## 2. Target file layout

```
app/history/index.tsx                 ~120 lines  the screen: data + list
src/components/history/SyncBar.tsx    ~130 lines  button, status, dev reset
src/components/history/AuditCard.tsx  ~100 lines  card + Count + badge helpers
src/sync/formatSyncError.ts            ~35 lines  pure fn, unit-testable
src/sync/__tests__/formatSyncError.test.ts        logic tests (see §4, step 1)
```

**Deviation from the ticket's wording, flagged:** 8b-iv says "co-located
`app/history/SyncBar.tsx`." A component file inside `app/` becomes an expo-router
route — `/history/SyncBar` would exist as a navigable path (and trip typed-routes
codegen). The repo's own review standard already says "Screens live in `app/`;
everything else lives outside it," and the existing precedent is
`src/components/ScreenWrapper.tsx`. So: **`src/components/history/`** — co-located
with each other, named for the screen they serve, outside the router's reach.

## 3. What moves where

### 3a. `src/sync/formatSyncError.ts` (new)

Moves verbatim from index.tsx lines 21–47:
- `formatSyncError(error: unknown): string` — named export.

Why `src/sync/` and not next to SyncBar: it's a pure error→string function with
real branching (Error-first ordering, Postgrest shape, JSON.stringify fallback,
circular-reference catch). That's logic core — the kind of thing we unit test
(and the kind of thing we do NOT test through component rendering). It also
stays importable by the screen for its own load-error path (§3d).

### 3b. `src/components/history/AuditCard.tsx` (new)

Moves from index.tsx:
- `formatDate` (lines 15–19)
- `BADGE_COLOR` + `syncBadge` (lines 49–67) — presentational mapping, so it
  lives with the card that renders it. A shared theme file is still out of
  scope (unchanged from the current in-file comment).
- The `renderItem` card JSX (lines 219–238), becoming the component body.
- `Count` (lines 243–258) — stays a private (non-exported) helper in this
  file; it has exactly one consumer.
- Styles: `card`, `pressed`, `headerRow`, `name`, `date`, `countsRow`,
  `count`, `countValue`, `countLabel`, `sync`.

Props — data in, one event out, no store access:

```tsx
type AuditCardProps = {
  audit: AuditSummary;
  syncState: AuditSyncStateRow | undefined;
  onPress: (auditId: string) => void;
};
export function AuditCard({ audit, syncState, onPress }: AuditCardProps)
```

Side benefit: the screen's `renderItem` becomes a small `useCallback`-wrapped
function returning `<AuditCard …/>`, which retires the current inline-closure
renderItem (a standing lint-standard smell: "no anonymous functions passed as
props to list items").

### 3c. `src/components/history/SyncBar.tsx` (new)

Moves from index.tsx:
- `syncing` + `syncStatus` state (lines 74–75)
- `onSyncNow` + `runSync` (lines 119–146)
- `onResetLocalData` (lines 148–172)
- The `ListHeaderComponent` JSX (lines 180–216), becoming the component body,
  including the `__DEV__` reset button and its comment block.
- Styles: `syncBar`, `syncBtn`, `syncBtnDisabled`, `syncBtnText`,
  `syncStatus`, `resetBtn`, `resetBtnDisabled`, `resetBtnText`,
  `resetBtnTextDisabled`, plus its own `pressed`.

SyncBar is self-contained: it calls `useSQLiteContext()` itself (same pattern
as the screen), imports `syncNow`, `getSyncQueueStats`, `resetAuditData`, and
`formatSyncError` directly. One prop:

```tsx
type SyncBarProps = {
  // Parent re-reads audits + sync states after an action that changed local
  // data outside the flush path (reset always; manual sync — see Q2).
  onDataChanged: () => Promise<void>;
};
export function SyncBar({ onDataChanged }: SyncBarProps)
```

Why a callback and not "SyncBar pokes the store": reset is not a flush.
`flushCount` means "a flush ended" and reset must not fake one — the parent's
refresh is the honest channel. One prop is not DI plumbing; it's the same
shape as `onPress`.

While it's being moved, the Sync now button gains the `accessibilityRole` /
`accessibilityLabel` the reset button already has (standards gap, free fix
during the move — no logic change).

### 3d. `app/history/index.tsx` (slimmed)

Keeps:
- `audits` / `syncStates` state, `refresh`, the focus effect, the
  `flushCount` effect (the store subscription stays in the screen — it
  refreshes list + badges, which the screen owns).
- The FlatList shell: `ListHeaderComponent={<SyncBar onDataChanged={refresh} />}`
  (extracted via `useMemo`/`useCallback` per the list-props rule),
  `renderItem` → `AuditCard`, `ListEmptyComponent`.
- Styles: `list`, `empty`, plus a new `loadError` text style.

**One deliberate behavior change:** today a *load* failure writes into
`syncStatus` and renders inside the sync bar. After the split that would mean
threading screen state down into SyncBar — exactly the multi-owner state this
refactor exists to kill. Instead the screen keeps its own `loadError: string |
null` and renders it as its own `<Text>` above the list (still built with
`formatSyncError`). Sync bar status becomes sync-only. Net UX difference: a
load error appears one line lower, and is no longer overwritten by pressing
Sync now — arguably more correct, since the two messages answer different
questions ("did the read work" vs "did the push land").

## 4. What does NOT move / change

- No sync-engine, flush, queue, or repository changes. This is a UI-file
  reorganization; `src/sync/` gains one pure function only.
- `syncBadge` semantics, badge copy, colors: byte-identical.
- The `flushCount` subscription and refresh-on-focus behavior: unchanged.
- No theme/constants file (still parked), no `isOnline` offline indicator
  (parked in DECISIONS with 8b-iv — proposing it stays parked; it's new
  surface, not cleanup, and the 7/31 clock is real).

## 5. Owner decisions — RESOLVED 2026-07-29

These two were parked "owner decides at ticket time" (TODO.md:124–127,
DECISIONS.md:482–484). Both were reviewed and decided; both land in step 3's
diff.

**Q1 — DECIDED: the button reads the store's `status`.** Local `syncing`
state is deleted; `const isSyncing = useSyncStore((s) => s.status ===
"syncing")`. Background flushes (reconnect edge, completion poke) now show
"Syncing…" and disable both buttons. Deciding factor: the Reset button's
mid-flush disable currently only covers manual flushes — a background flush
on reconnect can be mid-upsert while Reset is still tappable, which is
exactly the sync_queue-wipe hazard the disable comment warns about. Reading
the store closes that gap and removes the `finally { setSyncing(false) }`
cleanup obligation (the engine owns resetting its status). Accepted
tradeoff: a brief unprompted "Syncing…" flicker on reconnect.

**Q2 — DECIDED: drop `runSync()`'s trailing `refresh()`.** Since S1, the
engine's `finally` bumps `flushCount` and the screen's effect already
refreshes on every bump, so the explicit call was a second delivery of the
same message. The no-op-poke path was checked: a guarded early return
(offline/busy) doesn't bump the counter, but it also changes nothing in
SQLite, so there is nothing to re-read — and the status message still comes
from `getSyncQueueStats`, which stays. Result: badges refresh through
exactly one channel (the signal), and SyncBar's `onDataChanged` fires only
after dev reset.

## 6. Execution steps — one per session, per working agreement

Each step compiles and ships alone; the screen works after every one.

- [ ] **Step 1 — `formatSyncError` extraction + tests.** Create
  `src/sync/formatSyncError.ts` (verbatim move, named export), point
  index.tsx's import at it, delete the in-file copy. Add
  `src/sync/__tests__/formatSyncError.test.ts`: Error instance, empty-message
  Error, Postgrest shape (all four fields / partial fields), numeric-code
  object → JSON, circular object → String fallback, plain string/number.
  Gate: tsc clean; human runs jest on Windows.
- [ ] **Step 2 — `AuditCard` extraction.** Create
  `src/components/history/AuditCard.tsx` per §3b; index.tsx's `renderItem`
  becomes a `useCallback` returning `<AuditCard/>`. Zero behavior change.
  Gate: tsc clean; visual check on device (cards + badges identical).
- [ ] **Step 3 — `SyncBar` extraction.** Create
  `src/components/history/SyncBar.tsx` per §3c, apply the Q1/Q2 answers,
  move the load-error display per §3d, add the missing accessibility props.
  Gate: tsc clean; device pass — manual sync, dev reset, airplane-mode
  reconnect (badge still flips with no tap, per SYNC_STATUS_FIX §8).
- [ ] **Step 4 — close-out.** DECISIONS.md entry (the ticket's required note:
  sync state is a separate query, not a join — GROUP BY fanout — plus the Q1/Q2
  outcomes and the `src/` vs `app/` placement call). Check off 8b-iv in place
  in TODO.md. Update LINE_AUDIT.md counts. Run the code-reviewer agent across
  the accumulated diff before the final commit if not already done per-step.

Each step ends with the code-reviewer agent before its commit (CLAUDE.md
rule), and Windows eslint for each commit joins the standing carry-over sweep
in TODO.md.

## 7. Expected outcome

| File | Before | After (est.) |
| --- | --- | --- |
| app/history/index.tsx | 316 | ~120 |
| src/components/history/SyncBar.tsx | — | ~130 |
| src/components/history/AuditCard.tsx | — | ~100 |
| src/sync/formatSyncError.ts | — | ~35 |

Every file under the 200-line guideline, one component per file, and the
screen file reads as: state → refresh → two effects → FlatList. The sync bar
and the card each become the kind of file you can read whole.
