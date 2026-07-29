# TODO — LineCheck

Refreshed 2026-07-28. Everything completed through 2026-07-27 (T1–T7, 8b-i/ii/ii.5,
the interview-story notes) is preserved verbatim in **TODO_ARCHIVE.md** — reread it
before interviews.

Workflow rules (for me and for Claude Code):
- **One bullet per session, not one ticket.** Claude Code implements exactly one
  `- [ ]` checkbox, then stops — even if the next bullet is obvious, even if it's a
  one-line change. No batching, no "while I'm here." I set the pace, not the agent.
- Start in Plan Mode. Approve the plan before any file changes.
- Stop conditions per session: the single bullet is done, `npx tsc --noEmit` clean,
  nothing outside the ticket's listed files touched, checkbox marked `[x]`.
- A ticket's AC line is checked only when its last bullet lands — that session runs
  the full AC before closing the ticket.
- I read every diff before merging. The bar: I can explain any line if asked.
  Anything I can't explain, I ask Claude Code to walk me through before merge.
- Finished bullets are marked `[x]` **in place** and stay put — no Done section,
  no moving tickets.
- Architecture is settled (DECISIONS.md). The sync-trigger design is settled too
  (**REFACTOR_PROPOSAL.md v3, comprehension gate passed 2026-07-27**). Tickets do
  not relitigate either.
- **TODO_PLAIN_ENGLISH.md is the plain-words twin of this file.** Whenever a ticket
  here changes state or gets added, update the twin in the same commit.

---

## Up Next

### R — Sync trigger rewrite (governing doc: REFACTOR_PROPOSAL.md v3)
The trigger layer (`autoSync.ts` + `createSyncScheduler` + `requestFlush.ts` + the
`_layout.tsx` wiring) becomes ONE explicit two-state machine,
`src/sync/syncEngine.ts`. Timed backoff, `attempts`, give-up, and quarantine are
all dropped — trade acknowledged in proposal §4. End state: `src/sync/` is two
files, the worker (`flush.ts`) and the trigger (`syncEngine.ts`); old 8b-iii
dissolves with the stuck state. **Every bullet below leaves the app tsc-clean and
demo-able** — if the 31st arrives mid-refactor, ship from wherever we are.

- [x] **R1 — Engine, unwired.** (2026-07-28) Add `src/sync/syncEngine.ts` exactly as proposal
  §5, plus `syncEngine.test.ts` with §7's six cases: reconnect edge syncs exactly
  once; steady still-online events don't re-sync; offline events never sync;
  `syncNow()` while offline is a no-op; `syncNow()` during an in-flight push
  doesn't double-run; after cleanup, pokes do nothing. Mocking per §7:
  `jest.mock("./flush")` + `jest.mock("@react-native-community/netinfo")`, no fake
  timers. NOTHING else changes — the old trigger layer still runs the app.
  AC: tsc clean; new suite green (human runs jest on Windows); no other files touched.
- [x] **R2 — The swap.** (2026-07-28; two planning decisions logged in
  REFACTOR_PROPOSAL §10 — status line went console-only, and the flush.ts
  failure-branch `console.warn` was pulled forward out of R3 so no session
  shipped with silent flush failures.) `app/_layout.tsx`: `AutoSync` becomes §5b's small effect
  (`startSyncEngine(db)`, return its stop function); imports for `createAutoSync`,
  `createSyncScheduler`, `registerFlushRequester`, NetInfo, `supabase`, and
  `flushSyncQueue` all go. `app/audit/review/[auditId].tsx`: `requestFlush()` →
  `void syncNow()` (direct import). `app/history/index.tsx`: the Sync now button
  calls `syncNow()` (gains the shared single-flight guard — today it bypasses it).
  DELETE `src/sync/autoSync.ts` + its test and `src/sync/requestFlush.ts`.
  `retry.ts` deliberately survives until R4 (`flush.ts` and History still import
  `MAX_ATTEMPTS`). Side effect: resolves the waived 8b-ii.5 review finding W1
  (unhandled rejection on the fire-and-forget completion flush) by deleting that
  path. AC: tsc clean; remaining suites green; device sanity: all three pokes
  (reconnect edge, Submit, manual button) reach the engine.
- [x] **R3 — Worker stops counting.** (2026-07-28, merged with R4 in one
  session — owner call, deadline lever from the refresh plan.) `src/sync/flush.ts`: delete the
  `attempts < MAX_ATTEMPTS` eligible filter and the `incrementSyncQueueAttempts`
  call; error result becomes `{ status: "error"; error: unknown }`. (The
  failure-branch `console.warn` — the gate-Q3 fix — already landed in R2;
  keep it when reshaping the branch.)
  Delete `incrementSyncQueueAttempts` from `src/db/syncQueue.ts`. Update
  `flush.test.ts`: attempts assertions out; idempotency, FK ordering,
  delete-on-confirm, crash recovery all stay. Sequencing note (found in R2):
  `createSyncScheduler` reads `result.attempts`, so the `FlushResult` change
  breaks it — R3 also deletes the scheduler (unwired since R2) and its
  describe block, leaving retry.ts = the `MAX_ATTEMPTS` export only until R4.
  (History stopped reading the flush result in R2 — no screen changes here.)
  AC: tsc clean; flush suite green; a failing push warns once at the choke
  point regardless of trigger.
- [x] **R4 — Badge simplifies; retry.ts dies.** (2026-07-28, same session as
  R3. retry.test.ts went with it — deleting the scheduler and backoffDelay
  left it empty.) `src/db/syncQueue.ts`:
  `getAuditSyncStates` returns synced/pending only (no `maxAttempts`, no threshold
  param); `getSyncQueueStats` drops the gave-up split. `app/history/index.tsx`:
  badge becomes "Synced ✓" / "Not synced — N waiting"; `MAX_ATTEMPTS` import gone.
  DELETE `src/sync/retry.ts` + its test (nothing imports it after R3's filter
  removal and this bullet's badge change). Update the 8b-i/8b-ii tests (stuck
  cases out). AC: tsc clean; FULL suite green; proposal §9 device pass — complete
  online → Synced ✓ with no tap; airplane-mode complete → Not synced → reconnect
  → Synced ✓; forced failure → badge stays Not synced, error in console, manual
  Sync now retries.
- [x] **R5 — Docs.** (2026-07-28. DECISIONS entry supersedes the 7d/7e entries
  and parts of the 7/21 entry; README gained the merged known-limitations
  story; CLAUDE.md architecture now describes the engine. README's photo
  mentions left for the README/demo session.) DECISIONS.md entry: state machine over DI plumbing; backoff
  AND attempts dropped with §4's analysis and the acknowledged quarantine trade;
  alternatives rejected (rename-only, XState, no-tests); `attempts` column left
  dead deliberately (drop is parked below). CLAUDE.md: backoff line removed from
  the architecture section; `sync_queue` model loses `attempts`; retry story =
  "queue stays intact; every trigger re-attempts." README known-limitations:
  merge the poison-batch weakness and the no-quarantine trade into ONE story,
  with fail-then-split bisection named as the production remedy (never bisect a
  network throw; batch-level codes skip the split). AC: docs match shipped code;
  no stale references to autoSync/retry/requestFlush anywhere in the repo.
- Decision (2026-07-28, owner): the `attempts` column stays in the schema, dead —
  zero-risk for the deadline window. Dropping it is parked below.

### S1 — Live badge signal (governing doc: SYNC_STATUS_FIX.md; un-parked 2026-07-29)
- [x] (2026-07-29) The engine gets a `sync_finished` signal: new `src/sync/syncStore.ts`
  (Zustand — first use in the repo; owner installed it this session), the engine's
  `status` module var MOVES into the store (one copy in the app; the single-flight
  guard reads it there), and `flushCount` bumps in `syncNow`'s `finally` — on failure
  too, the signal means "ended," not "succeeded." `app/history/index.tsx` subscribes
  to `flushCount` and re-runs its existing `refresh()` on each bump, so a background
  flush flips the badge with no refocus. Store carries the signal, never query
  results — SQLite stays the only read path. Four new engine test cases: bump on
  success, bump on failure, no bump on a guarded no-op poke, status observable
  mid-flight. AC: tsc clean; engine suite green (human runs jest on Windows);
  device pass per SYNC_STATUS_FIX §8 (airplane-mode complete → sit on History →
  reconnect → badge flips with no tap).

### 8b-iv — History cleanup (after R4; shrunken)
- [x] (2026-07-29) Extract `formatSyncError` + the (post-R4, much smaller) sync header into a
  co-located `app/history/SyncBar.tsx` — the screen passed the ~200-line guideline
  on 2026-07-21. DECISIONS entry: sync state is a separate query, not a join
  (GROUP BY fanout). The old entry's other half (per-audit vs global retry)
  dissolved with 8b-iii. Parked here from SYNC_STATUS_FIX §9 (owner decides at
  ticket time): the button's `syncing` state could read the store's `status`
  so background flushes show "Syncing…" too, and `runSync()`'s now-redundant
  `refresh()` can go.
  - Built per `HISTORY_SCREEN_REFACTOR_PROPOSAL.md` (owner-reviewed same day).
    Components landed in `src/components/history/` (SyncBar + AuditCard), NOT
    `app/history/` — a file under `app/` becomes a route (deviation flagged in
    proposal §2). `formatSyncError` → `src/sync/` + 7-case logic test. Both
    parked decisions taken: button reads store `status` (closes the
    Reset-tappable-during-background-flush gap); trailing `refresh()` dropped
    (flushCount signal is the only badge channel). DECISIONS 2026-07-29 entry
    written. AC pending: jest on Windows, §3 device pass (manual sync, reset,
    airplane-mode reconnect badge flip).

### P — Theme polish (proposal 2026-07-29 — governing doc: THEME_POLISH.md, GATED)
- [ ] Owner reads THEME_POLISH.md and answers its §7 open questions (brand blue
  value, gray merge, screen background, StatTile worth-it). Same process as
  REFACTOR_PROPOSAL/SYNC_STATUS_FIX: **no styling code before the gate passes.**
  After the gate, copy its P1–P5 tickets here as bullets (P6 motion is already
  parked below under Reanimated). Tier 2 (one-tap fast path) was REJECTED —
  DECISIONS 2026-07-29 — and does not become a ticket.

### Signature: implement or remove (raised 2026-07-29, undecided)
- [ ] The review screen's Signature section is a dashed "coming soon" placeholder
  (`app/audit/review/[auditId].tsx`). Decide: **implement** real capture or
  **remove** the section so the demo shows no stubs. Owner leans IMPLEMENT — the
  signature is the credibility beat of the whole "signed food-safety record"
  concept. If implementing: `react-native-signature-canvas` is NOT installed
  (the CLAUDE.md stack line is aspirational, like Zustand was pre-S1); human
  runs `npm install react-native-signature-canvas` + `npx expo install
  react-native-webview` (its peer dep; webview is Expo Go-compatible) on
  Windows. Scope sketch: capture → local URI into `audits.signatureUri` at
  completion; remote upload stays deferred exactly like photos (schema.sql's
  `signature_path` mapping is 8a-class work). Not scheduled — Send-out
  essentials come first.

### Send-out essentials (was T9 — deadline scope)
- [ ] README: demo GIF, architecture diagram, link DECISIONS.md, note the test
  suite. (The known-limitations story lands in R5.)
- [ ] Demo recording: airplane-mode end-to-end.

### Carry-over debt (not blocking)
- [ ] Windows eslint sweep: commits `2f9d336`, `d963d56`, 8b-ii (`9d96ff1`),
  8b-ii.5 (`47b003c`), plus each R commit as it lands — ESLint can't execute in
  WSL2, so Gate 0 is only half-verified from this side.

**Deadline (set 2026-07-21): applications go out 2026-07-31 — a DATE, not a
state. If work is unfinished on the 31st, send anyway. Every R bullet leaves the
app demo-able for exactly this reason.**

---

## Parked (post-7/31)
- [ ] Drop the dead `attempts` column (small migration). Sites to touch (from
  the R3+R4 review): the schema comment (`src/db/index.ts`), enqueue's INSERT +
  comment and the `SyncQueueRow` comment (`src/db/syncQueue.ts`), the two test
  helpers that still INSERT the column, and `getPendingSyncQueue`'s `SELECT *`
  (list columns explicitly while there).
- [ ] CI: GitHub Actions running `tsc --noEmit` + `jest` on push/PR (GitHub's
  Linux runners sidestep the Windows/WSL local-command constraint).
- [ ] Reanimated polish (status button press, list transitions — small).
- [ ] EAS dev build; re-record the demo on it.
- [ ] 8a — Photo capture + Storage-bucket upload (cut 2026-07-21; adds a third
  request type to the flush sequence — full spec preserved in TODO_ARCHIVE.md).
