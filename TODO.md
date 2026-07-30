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

### P — Theme polish (governing doc: THEME_POLISH.md — gate PASSED 2026-07-29)
- [x] (2026-07-29) Owner answered §7: blue #1565C0 approved; keep both grays;
  gray screen background yes (eye strain/contrast); StatTile worth doing but
  at a reconvene. Answers + build deviations logged in THEME_POLISH §8.
  Tier 2 (one-tap fast path) REJECTED — DECISIONS 2026-07-29, not a ticket.
- [x] **P1 — Tokens, zero visual diff.** (2026-07-29, P1–P4 run in ONE
  owner-approved session — same deviation grant as 8b-iv.) `src/theme.ts`
  added (§2 + three census additions: `font.emphasis` 16, `font.note` 14,
  `color.onFill`); all nine styled files swept — hex, radius, font sizes.
  AuditCard's 18/11 tile sizes stay literal until P5 (zero-diff rule).
  Spacing literals untouched (off-scale values; normalization is a future
  deliberate change). Grep-verified: no `"#` outside theme.ts.
- [x] **P2 — Screen chrome.** (2026-07-29) Stack `contentStyle` → gray
  `color.screen` everywhere; `headerTintColor` brand; header titles 600;
  History header link off inline-style onto StyleSheet in brand blue.
- [x] **P3 — Actions go brand.** (2026-07-29) `src/components/PrimaryButton.tsx`
  (named export; label/onPress/disabled; pressed-opacity feedback; a11y role +
  label) adopted at all four sites. SyncBar's button unified to the shared
  style — deliberate deltas: paddingVertical 12→16, weight 700→600, disabled
  fill #999→#ccc, a11y label now tracks "Syncing…". Dev Reset button stays
  its dev-red outline self.
- [x] **P4 — Semantic results.** (2026-07-29) Item screen selected segment
  fills pass→green / fail→red / na→neutral-gray with white text (was: black
  for pass AND na). Checklist + history-detail result columns color
  PASS/FAIL/NA semantically; unanswered "—" stays muted. (History detail was
  a build-time scope add — same bug, same rendering; THEME_POLISH §8.)
  AC pending: owner diff review, device visual pass, Windows eslint sweep.
  tsc clean ✓ (no jest changes — no tests touched).
- [x] **P5 — StatTile.** (2026-07-29, after owner approved P1–P4.) The three
  Count copies (review, history detail, AuditCard) → `src/components/
  StatTile.tsx`. Unified on the bordered white tile with NO size variant —
  AuditCard's hand-rolled compact version (subtle fill, 18/11) adopts the
  standard look (visible: History cards ~14pt taller, tiles bordered,
  22/12 text). `color.subtle` + `radius.tile` died with it and were removed
  from theme.ts (dead tokens are drift bait). Resolves the extraction
  DECISIONS 2026-07-17 deferred. Details in THEME_POLISH §8. AC pending:
  owner diff review + device look at the History list. tsc clean ✓.

### Signature: implement or remove (raised 2026-07-29, undecided)
- [x] RESOLVED: IMPLEMENTED 2026-07-30 via `react-native-signature-canvas`
  (owner's call — practical package over hand-rolled). Design doc
  `SIGNATURE_CAPTURE_PROPOSAL.md`; rationale + the legacy-file-API Expo Go
  quirk in DECISIONS 2026-07-30. Full-screen modal capture, PNG at completion,
  URI rides completeAudit's txn; schema gate requires signature. Retest PASSED
  on device 2026-07-30 (the legacy writeAsStringAsync swap was the fix — the
  SDK 54 File API was the Expo Go thrower).
- [x] STORAGE WIRE-IN (same day, follow-on): signature PNG uploads to the
  public `signatures` bucket inline in the flush, before row upserts;
  `signature_path` gets `<auditId>.png` (null for pre-feature audits). Doc =
  `STORAGE_WIREIN_PROPOSAL.md` (gate passed, owner took all three recs);
  DECISIONS 2026-07-30 has the four calls (inline-in-flush, object path,
  public-bucket posture, seam growth). Owner-side dashboard work DONE: bucket
  (1MB, image/png), both anon policies. Device pass DONE (found the
  select-policy gotcha — three policies now; jest green on Windows).
- [x] HISTORY DISPLAY (same day, doc-lite follow-on in
  SIGNATURE_CAPTURE_PROPOSAL.md §Follow-on): History detail renders the
  signature from the LOCAL file as a ListFooterComponent card below the
  stations (paper-form semantics); `getAudit`/`Audit` gained signatureUri
  (+ alias rename a/l → audits/locations per SQL standard); pre-feature
  audits omit the section. AC pending: owner device look.
  Original ticket text follows for posterity:
- The review screen's Signature section WAS a dashed "coming soon" placeholder
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
- [x] Reanimated polish — built as THEME_POLISH §5/P6 (2026-07-30, pulled
  forward: the badge flip is the demo's money shot, so it lands before the
  recording). History sync-badge pending→synced color transition
  (`AuditCard.tsx`, Reanimated 4 CSS-transition API) + segment-selection scale
  spring (new `src/components/SegmentButton.tsx`, `withSpring`). The
  originally sketched status-button press / list transitions were superseded
  by the P6 spec — state-change feedback only, nothing decorative.
  Implementation plan + build log: THEME_POLISH §9/§8; idiom tradeoff in
  DECISIONS 2026-07-30. AC pending: owner diff review, jest + eslint on
  Windows, §9 device pass. tsc clean ✓.
- [ ] EAS dev build; re-record the demo on it.
- [ ] 8a — Photo capture + Storage-bucket upload (cut 2026-07-21; adds a third
  request type to the flush sequence — full spec preserved in TODO_ARCHIVE.md).
