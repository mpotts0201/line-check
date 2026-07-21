# TODO — LineCheck

Workflow rules (for me and for Claude Code):
- **One bullet per session, not one ticket.** Claude Code implements exactly one `- [ ]` checkbox, then stops — even if the next bullet is obvious, even if it's a one-line change. No batching, no "while I'm here." I set the pace, not the agent.
- Start in Plan Mode. Approve the plan before any file changes.
- Stop conditions per session: the single bullet is done, `npx tsc --noEmit` clean, nothing outside the ticket's listed files touched, checkbox marked `[x]`.
- A ticket's AC line is checked only when its last bullet lands — that session runs the full AC before closing the ticket.
- I read every diff before merging. The bar: I can explain any line if asked. Anything I can't explain, I ask Claude Code to walk me through before merge.
- Move finished tickets to `## Done` in the same commit that closes them.
- Architecture is settled (see DECISIONS.md). Tickets do not relitigate it.

---

## Up Next

### T1 — Repository functions: getAuditItem + updateAuditItem
- [x] `getAuditItem(db, id)` in `src/db/audits.ts` — single row, same JOIN as `getAuditItems` so `requiresTemp` comes through, `getFirstAsync`. Comment block explaining the JOIN included.
- [x] `MutableAuditItemFields` type in `src/db/audits.ts` — `Partial<>` of the mutable columns only (`result`, `tempReading`, `note`). Callers must not be able to overwrite `id`, `auditId`, `templateId`, or snapshot columns (`station`, `label`); enforce at the type level, not runtime checks. Short comment above it stating the mutability boundary.
- [x] `updateAuditItem(db, id, fields: MutableAuditItemFields)` — UPDATE built from the provided keys, stamps `updatedAt` inside the function (callers never pass it). Short comment above it explaining the boundary + why `updatedAt` is function-owned (last-write-wins sync key).
- [x] AC: both compile, `getAuditItem` returns `requiresTemp`, passing a non-mutable column in `fields` is a type error.
- Files: `src/db/audits.ts`

### T2 — Route stubs
- [x] Create `app/audit/item/[itemId].tsx` — minimal: read param, render it in a `<Text>`.
- [x] Create `app/audit/review/[auditId].tsx` — same.
- [x] AC: `npx tsc --noEmit` clean; typed-route pushes to both targets compile; tapping a checklist row navigates without crash.
- Files: the two new route files only.

### T3 — Item detail screen
- [x] Build out `app/audit/item/[itemId].tsx`: load via `getAuditItem` on mount.
- [x] Label heading (snapshotted label, not a template lookup).
- [x] Pass / Fail / N/A segmented buttons.
- [x] Temp `TextInput` (numeric keyboard) rendered ONLY when `requiresTemp` is truthy.
- [x] Note `TextInput` (multiline).
- [x] Save button → `updateAuditItem` → `router.back()`.
- [x] Zod validation layer (`src/validation/audit.ts`, `itemSaveSchema`): blank result rejected; temp required when `requiresTemp`. Reused by T5's completion gate. (Decision in DECISIONS.md.)
- [x] AC: save a Fail with note + temp, force-quit, reopen, navigate back in — values persisted. Temp field absent on non-temp items. No SQL in the screen file (repository layer only).
- Files: `app/audit/item/[itemId].tsx`, `src/validation/audit.ts`, `DECISIONS.md`. Depends: T1, T2.

### T4 — Checklist reflects status on return
- [x] `app/audit/[locationId].tsx`: refetch items on screen focus (`useFocusEffect`). Landed early with the checklist screen — already implemented (lines 15–22).
- AC: save an item, go back, row updated without app restart. No duplicate audits created by the refetch.
- Files: `app/audit/[locationId].tsx` only. Depends: T3 — for AC verification only; the refetch code already exists.

### T5 — Review & sign screen
- [x] Build out `app/audit/review/[auditId].tsx`: counts (pass / fail / na / unanswered), failed-items list with notes, signature placeholder box.
- [x] Complete button: sets audit status = `'complete'` (matches CLAUDE.md's `'draft' | 'complete'` model — NOT `'completed'`; `getOrCreateTodaysAudit` and T6's history query must use this exact string) + `completedAt`, then navigates to History. (Navigates to Locations for now; T6 switches to History — see DECISIONS.md.)
- [x] Decision (record in DECISIONS.md): Complete is disabled while unanswered items exist. Enforced via new `auditCompleteSchema` in `src/validation/audit.ts` (Zod gate).
- [x] AC: counts match the checklist screen; completing is blocked with unanswered items; completed audit no longer returned by `getOrCreateTodaysAudit` (a new draft starts tomorrow, or same-day re-audit decision documented). Same-day re-audit allowed — documented in DECISIONS.md.
- Files: `app/audit/review/[auditId].tsx`, `src/db/audits.ts` (new `completeAudit` fn), `src/validation/audit.ts` (new `auditCompleteSchema` gate), DECISIONS.md. Depends: T2, T4.

### T6 — History screen
- [x] New route `app/history.tsx` (or tab — my call at build time). (Stack screen; reached via post-complete nav + a History header button on Locations.)
- [x] List completed audits: location name, date, pass/fail counts via one GROUP BY aggregate query (no N+1). (`getCompletedAudits`; counts include N/A to match the review screen.)
- [x] Sync status text, hardcoded "Not synced" for now.
- [x] AC: counts match the review screen for the same audit; query is a single aggregate, verified in the repository function.
- Files: `app/history.tsx`, `src/db/audits.ts` (new `getCompletedAudits`), `app/audit/review/[auditId].tsx` (post-complete nav → `/history`), `app/_layout.tsx` (History header button). Depends: T5.

### T6.5 — Read-only audit detail screen (tap a History row)
Close the vertical slice: a completed audit in History opens a **dedicated read-only detail screen** showing the full signed record. A separate screen (NOT a status-branch on the review screen) keeps each screen single-responsibility — review = draft→sign, detail = immutable record. History is promoted to a route directory to host both the list and the detail route.
- [x] Restructure + stub: move `app/history.tsx` → `app/history/index.tsx` (route `/history` unchanged); add stubbed route `app/history/[auditId].tsx` (read `auditId` param, render it in a `<Text>`). In `app/_layout.tsx`: rename `name="history"` → `name="history/index"`, add `<Stack.Screen name="history/[auditId]" title="Audit Detail">`. Make index rows tappable → `router.push('/history/${audit.id}')`. New typed route → Metro regenerates router types (human recompiles; do not hand-edit router.d.ts).
- [x] `getAudit(db, id)` in `src/db/audits.ts` — single audit row + location name (JOIN locations); returns id, status, completedAt, locationName. Detail header needs date + location.
- [x] Build `app/history/[auditId].tsx`: load audit via `getAudit` + items via `getAuditItems`; header = location + "Completed <date>"; counts (pass/fail/na) matching the History row; list ALL items with result + temp + note (full record). No Complete button, no signature capture, no completion gate — read-only.
- [x] Decision (DECISIONS.md): read-only audit detail is a **separate screen** under `app/history/`, superseding the reuse-the-review-screen approach originally sketched in this ticket. Why: avoid a multi-mode component; single-responsibility screens.
- AC: tapping a completed History row opens the detail screen showing every item's result/temp/note with no Complete button; counts match the History row and the pre-completion review; the draft review flow (`audit/review/[auditId]`) is untouched.
- Files: `app/history/index.tsx` (moved), `app/history/[auditId].tsx` (new), `app/_layout.tsx`, `src/db/audits.ts` (new `getAudit`), DECISIONS.md. Depends: T6.

### T7 — Sync engine (the invisible machine — crown jewel; one bullet per session, do not merge)
**~~After 7e lands: one extra session where Claude Code walks me through the flush loop line by line~~ — DONE 2026-07-21, as an interview-style Q&A rather than a lecture (I explained the loop, Claude graded it and probed with follow-ups). Weak spots found, worth re-reading before an interview: (1) idempotency is a stable client-generated PK + `upsert(onConflict:'id')` + delete-on-confirm — NOT any comparison against local data; (2) a lost ACK after a successful remote write leaves remote correct and local claiming "not synced" — the give-up state means "we never heard back", not "the data didn't land"; (3) the remote call can't sit inside the SQLite transaction (no shared transaction across two databases), which forces at-least-once delivery and makes idempotency mandatory rather than optional; (4) FK ordering: audits upsert to completion before audit_items; (5) this is the **outbox pattern** — use that name.**

- [x] **7a** — `sync_queue` table migration; enqueue audit + items rows on `completeAudit`. AC: completing an audit inserts queue rows in the same transaction.
- [x] **7b — Test harness (foundation; build after 7a, before the worker).** Install & configure `jest-expo` (human runs on Windows: `npx expo install jest-expo` + `npm install -D jest @types/jest better-sqlite3`). Add the **DB seam**: a TS interface for the db methods the repo/sync use (`runAsync`, `getAllAsync`, `getFirstAsync`, `withTransactionAsync`, `execAsync`); production keeps expo-sqlite, tests back the interface with an in-memory `better-sqlite3` adapter (real SQL, throwaway DB — never touches the device or Supabase). Prove the harness with Tier-1 **validation tests** (`itemSaveSchema`, `auditCompleteSchema` in `src/validation/audit.ts`) — pure, no mocks. Scope for this whole suite: **sync engine + validation** (Tier 1–2); repository (Tier 3) tests are cheap to add later on this same seam; screen tests deferred. AC: `jest` runs green on the validation suite; `tsc --noEmit` clean; the db interface compiles against existing repository signatures with no behavior change.
- [x] **7c** — Flush worker (manual trigger). Create `src/sync/`; the flush function reads pending `sync_queue` rows, buckets by `entity`, then upserts per table in FK order (audits → audit_items) as batched array-upserts keyed on `id`. This is TWO sequential requests to two auto-generated table endpoints (`.from('audits')` then `.from('audit_items')`) — the audits request is `await`ed to completion before the items request, so parents exist server-side before children reference them via `auditId` (the worker owns the ordering; Supabase only validates the FK). Deletes queue rows ONLY on confirmed success, flips `audits.syncStatus` → `synced`. **Testability seam:** the worker receives its `db` and the Supabase client (or a narrow `{ from, storage }` interface) as params — it must NOT import the `supabase` singleton — so tests can inject a fake. Wire a manual "Sync now" control to call it (no listener yet — that's 7d). AC: online, tapping Sync pushes queued rows to Supabase; re-running is a no-op (no duplicates); forced mid-flush kill → re-sync leaves no duplicates (idempotency + delete-on-confirm proof). **Verified by unit tests** (in-memory better-sqlite3 + a scripted fake Supabase): idempotency, FK ordering (audits resolves before items), delete-on-confirm, crash recovery (fake succeeds on audits, throws on items → re-run drains cleanly, no dupes).
- [x] **7d** — NetInfo auto-trigger. Add the listener that calls the 7c worker when connectivity returns; guard against overlapping flushes. AC: airplane mode → complete audit → disable airplane mode → rows appear in Supabase automatically, no manual tap. **Verified by unit test:** a simulated connectivity-regained event triggers exactly one flush; overlapping/rapid triggers do not double-flush.
- [x] **7e** — Retry with backoff (failure path). On upsert error: increment `attempts`, leave the row queued, schedule retry with exponential backoff; **give-up threshold = 3**. AC: simulate a server failure → rows stay queued, `attempts` climbs, retries space out; on recovery the queue drains. **Verified by unit tests** (scripted fake Supabase failures): `attempts` increments, the row is NOT deleted on failure, backoff delay grows per attempt, and a later success drains the queue. **Engine-only** — the per-audit "Retry sync" fallback UX moved to **8b** (needs 8b's per-audit surfacing); the 7c global "Sync now" button is unchanged here.

- [x] **7f (unplanned) — first live end-to-end sync + the schema-drift bug.** 2026-07-21, commits `2f9d336` + `d963d56`. Every sync failed silently: `toRemoteAudit` wrote `signature_uri`, the live Supabase column is `signature_path` → `PGRST204` → because audits upsert before audit_items, the whole batch failed at the first request and correctly re-queued. Fixes: corrected mapper; **`supabase/schema.sql` checked in** (a transcript of the live schema, NOT a migration — header says do not run it); flush errors surfaced (`console.warn` always, decoded Postgrest code on-device under `__DEV__` only) instead of being discarded for a fixed string; `status:'empty'` split into "nothing queued" vs "queued but gave up"; `resetAuditData` + `__DEV__`-gated reset button (`src/db/dev.ts`). **Lesson worth keeping:** `flush.test.ts`'s fake Supabase stores rows in a `Map` keyed on `id` and never asserts column names — the DI seam that makes the worker testable also makes it blind to the remote contract, so no unit test could have caught this. Schema drift needs a schema artifact or an integration test.

### T8 — Sync, surfaced (make the machine visible) — depends on T7
- [ ] **8a** (optional / stretch — build only if it stays simple) — Photo capture on item detail + upload to the `audit-photos` bucket in the flush path. NOTE: the bucket is a SEPARATE endpoint type — Supabase **Storage**, not the auto-generated PostgREST table endpoints used by the 7c worker — so this adds a THIRD request to the flush sequence (audits → audit_items → photo upload), via the storage client (`supabase.storage.from('audit-photos').upload(...)`) rather than `.from(table).upsert(...)`. Idempotency via a deterministic object path keyed on the item id (re-upload overwrites, no duplicate objects). AC: photo path stored locally offline; file lands in the bucket on sync; re-sync creates no duplicate objects.
- **8b** — History shows real per-audit sync state + the "Retry sync" fallback (moved from 7e). Split into one-per-session bullets below; they share the same per-audit surfacing. **MILESTONE: this is the send-out gate — see the T8 deadline note.**
  - [ ] **8b-i — Per-audit sync state (data layer).** New `getAuditSyncStates(db)` in `src/db/syncQueue.ts` returning one row per audit with `pendingRows` and `maxAttempts`. **Do NOT join `sync_queue` into `getCompletedAudits`** — that query already GROUP BYs to build pass/fail/na counts, and a second one-to-many join fans the rows out and silently corrupts those counts. Keep it a separate query and merge by `auditId` in the screen. Note the join is indirect for items: `sync_queue.entityId` holds the *item* id for `entity='audit_items'`, so reach the audit via `audit_items.auditId`. Derived state (compute in one place, not scattered in the UI): **synced** = `syncStatus='synced'` and no queue rows; **pending** = queue rows with `maxAttempts < MAX_ATTEMPTS`; **stuck** = queue rows with `maxAttempts >= MAX_ATTEMPTS`. Threshold is a PARAMETER, not an import — `src/db` must not depend on `src/sync` (see the note on `getSyncQueueStats`). AC: unit-tested on the better-sqlite3 adapter — a freshly completed audit reads `pending`, a drained one reads `synced`, one at the give-up threshold reads `stuck`, and pass/fail/na counts are unchanged.
  - [ ] **8b-ii — Real badge on the History card.** Replace the hardcoded `<Text>Not synced</Text>` in `app/history/index.tsx` with the 8b-i state: "Synced ✓" / "Pending — N waiting" / "Not synced". This is the bullet that makes the whole T7 engine visible — until it lands, the demo can only *assert* that sync works. AC: complete an audit in airplane mode → card reads pending; reconnect → auto-sync drains → card reads Synced ✓ on next focus.
  - [ ] **8b-iii — Per-audit "Retry sync" + remove the global button.** Shown ONLY on a stuck audit (8b-i's `stuck`). Needs a SCOPED `resetAuditAttempts(db, auditId)` (zeroes `attempts` for that audit's queue rows only — including its items, via the same indirect join as 8b-i), then triggers a flush. Deletes the 7c global "Sync now" button and its status line, which this replaces. **Note the current gap this closes:** `flushSyncQueue` filters `attempts < MAX_ATTEMPTS`, and the global button calls that same worker — so today a given-up audit is unreachable by any manual action. AC: force 3 failures → card reads stuck and shows Retry → tap → attempts reset, flush runs, card flips to Synced ✓.
  - [ ] **8b-iv — Cleanup + DECISIONS entry.** Extract `formatSyncError` + the (now much smaller) sync header into a co-located `app/history/SyncBar.tsx` — the screen hit 267 lines on 2026-07-21, past the ~200 guideline. DECISIONS entry: why sync state is a separate query rather than a join (GROUP BY fanout), and why the manual escape hatch is per-audit rather than global.

**T8 deadline (set 2026-07-21): applications go out 2026-07-31 — a DATE, not a state. If 8b is unfinished on the 31st, send anyway.** Remaining scope for the window is 8b + README + a demo recording. **Cut: 8a, and all of T9 except the README.**

**Carry-over debt from 2026-07-21 (not blocking 8b):**
- [ ] Run `npx eslint .` on Windows over commits `2f9d336` + `d963d56` — ESLint can't execute in WSL2 (native binding is the Windows build), so Gate 0 is only half-verified on both.
- [ ] **Known limitation for the README — the poison-batch weakness.** `flushSyncQueue` sends ALL pending audits in one `upsert()` and all items in a second, so a single row Postgres rejects fails the entire batch, bumps `attempts` on every row, and after 3 rounds the whole queue gives up permanently. The `signature_path` bug WAS this. Deliberately not fixed — too much for the POC. The fix if it were in scope: **fail-then-split** — on failure, bisect the batch and retry each half, isolating the bad row in ~2·log₂(n) requests while healthy rows still land. Bisection needs only one bit ("did this batch fail"), so it works without parsing Postgres error strings, and it distinguishes one bad row from a systemic failure for free. Would also need: never bisect a *network* throw (only a server rejection), skip the split on batch-level codes (`PGRST204`/`42501`), and mark an audit synced only if its own row AND all its items landed. **Write this up as a known limitation — a weakness you found and can explain is a better interview story than one you hid.**

### T9 — Week 3 polish
- [ ] CI: GitHub Actions workflow running `tsc --noEmit` + `jest` on push / PR. Runs on GitHub's Linux runners, so it executes the suite in a clean environment neither side has to babysit (sidesteps the Windows/WSL local-command constraint). AC: workflow green on a PR; a failing test blocks the check.
- [ ] Reanimated touches (status button press, list transitions — small).
- [ ] README: demo GIF, architecture diagram, link DECISIONS.md, note the test suite + CI badge.
- [ ] EAS dev build; record airplane-mode demo end-to-end.

---

## Done
- [x] Locations screen (SQLite → FlatList → typed route push).
- [x] Checklist screen renders; `getOrCreateTodaysAudit` resumes today's draft across restarts.
- [x] Provisioning down-sync (locations + templates from Supabase, fire-and-forget).
- [x] Migrations, WAL mode, repository layer scaffolding.