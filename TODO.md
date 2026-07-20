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
**After 7e lands: one extra session where Claude Code walks me through the flush loop line by line — queue draining, idempotency, backoff, and what happens on a mid-flush crash. The full loop (idempotency + backoff + crash recovery) only exists once 7e lands, so the walkthrough waits for it. This is the piece I'll be asked about.**

- [x] **7a** — `sync_queue` table migration; enqueue audit + items rows on `completeAudit`. AC: completing an audit inserts queue rows in the same transaction.
- [x] **7b — Test harness (foundation; build after 7a, before the worker).** Install & configure `jest-expo` (human runs on Windows: `npx expo install jest-expo` + `npm install -D jest @types/jest better-sqlite3`). Add the **DB seam**: a TS interface for the db methods the repo/sync use (`runAsync`, `getAllAsync`, `getFirstAsync`, `withTransactionAsync`, `execAsync`); production keeps expo-sqlite, tests back the interface with an in-memory `better-sqlite3` adapter (real SQL, throwaway DB — never touches the device or Supabase). Prove the harness with Tier-1 **validation tests** (`itemSaveSchema`, `auditCompleteSchema` in `src/validation/audit.ts`) — pure, no mocks. Scope for this whole suite: **sync engine + validation** (Tier 1–2); repository (Tier 3) tests are cheap to add later on this same seam; screen tests deferred. AC: `jest` runs green on the validation suite; `tsc --noEmit` clean; the db interface compiles against existing repository signatures with no behavior change.
- [x] **7c** — Flush worker (manual trigger). Create `src/sync/`; the flush function reads pending `sync_queue` rows, buckets by `entity`, then upserts per table in FK order (audits → audit_items) as batched array-upserts keyed on `id`. This is TWO sequential requests to two auto-generated table endpoints (`.from('audits')` then `.from('audit_items')`) — the audits request is `await`ed to completion before the items request, so parents exist server-side before children reference them via `auditId` (the worker owns the ordering; Supabase only validates the FK). Deletes queue rows ONLY on confirmed success, flips `audits.syncStatus` → `synced`. **Testability seam:** the worker receives its `db` and the Supabase client (or a narrow `{ from, storage }` interface) as params — it must NOT import the `supabase` singleton — so tests can inject a fake. Wire a manual "Sync now" control to call it (no listener yet — that's 7d). AC: online, tapping Sync pushes queued rows to Supabase; re-running is a no-op (no duplicates); forced mid-flush kill → re-sync leaves no duplicates (idempotency + delete-on-confirm proof). **Verified by unit tests** (in-memory better-sqlite3 + a scripted fake Supabase): idempotency, FK ordering (audits resolves before items), delete-on-confirm, crash recovery (fake succeeds on audits, throws on items → re-run drains cleanly, no dupes).
- [x] **7d** — NetInfo auto-trigger. Add the listener that calls the 7c worker when connectivity returns; guard against overlapping flushes. AC: airplane mode → complete audit → disable airplane mode → rows appear in Supabase automatically, no manual tap. **Verified by unit test:** a simulated connectivity-regained event triggers exactly one flush; overlapping/rapid triggers do not double-flush.
- [ ] **7e** — Retry with backoff (failure path). On upsert error: increment `attempts`, leave the row queued, schedule retry with exponential backoff; **give-up threshold = 7**. AC: simulate a server failure → rows stay queued, `attempts` climbs, retries space out; on recovery the queue drains. **Verified by unit tests** (scripted fake Supabase failures): `attempts` increments, the row is NOT deleted on failure, backoff delay grows per attempt, and a later success drains the queue. **UX (decided in 7d):** at give-up (attempts ≥ 7, still unsynced) auto-sync stops retrying that audit and the 7c global "Sync now" button converts into a **per-audit** manual "Retry sync" fallback shown only for stuck audits; manual retry resets `attempts`. Dovetails with 8b's per-audit sync surfacing.

### T8 — Sync, surfaced (make the machine visible) — depends on T7
- [ ] **8a** (optional / stretch — build only if it stays simple) — Photo capture on item detail + upload to the `audit-photos` bucket in the flush path. NOTE: the bucket is a SEPARATE endpoint type — Supabase **Storage**, not the auto-generated PostgREST table endpoints used by the 7c worker — so this adds a THIRD request to the flush sequence (audits → audit_items → photo upload), via the storage client (`supabase.storage.from('audit-photos').upload(...)`) rather than `.from(table).upsert(...)`. Idempotency via a deterministic object path keyed on the item id (re-upload overwrites, no duplicate objects). AC: photo path stored locally offline; file lands in the bucket on sync; re-sync creates no duplicate objects.
- [ ] **8b** — History shows real "Synced ✓" badge backed by queue state. AC: badge flips only after Supabase rows confirmed. **MILESTONE: recruiter email goes out this day.**

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