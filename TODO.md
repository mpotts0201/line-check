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
- [ ] New route `app/history.tsx` (or tab — my call at build time).
- [ ] List completed audits: location name, date, pass/fail counts via one GROUP BY aggregate query (no N+1).
- [ ] Sync status text, hardcoded "Not synced" for now.
- AC: counts match the review screen for the same audit; query is a single aggregate, verified in the repository function.
- Files: `app/history.tsx`, `src/db/audits.ts`. Depends: T5.

### T7 — Sync engine (crown jewel — split, do not merge tickets)
**After 7b lands: one extra session where Claude Code walks me through the flush loop line by line — queue draining, idempotency, backoff, and what happens on a mid-flush crash. This is the piece I'll be asked about.**

- [ ] **7a** — `sync_queue` table migration; enqueue audit + items rows on `completeAudit`. AC: completing an audit inserts queue rows in the same transaction.
- [ ] **7b** — NetInfo listener + flush loop: drain queue on connectivity, upsert to Supabase keyed on device UUIDs (idempotent — re-running a flush is a no-op), retry with backoff, per-row status. AC: airplane mode → complete audit → disable airplane mode → rows appear in Supabase without duplicates, including after a forced mid-flush kill.
- [ ] **7c** — Photo capture on item detail + upload to `audit-photos` bucket in the flush path. AC: photo path stored locally offline; file lands in the bucket on sync.
- [ ] **7d** — History shows real "Synced ✓" badge backed by queue state. AC: badge flips only after Supabase rows confirmed. **MILESTONE: recruiter email goes out this day.**

### T8 — Week 3 polish
- [ ] Reanimated touches (status button press, list transitions — small).
- [ ] README: demo GIF, architecture diagram, link DECISIONS.md.
- [ ] EAS dev build; record airplane-mode demo end-to-end.

---

## Done
- [x] Locations screen (SQLite → FlatList → typed route push).
- [x] Checklist screen renders; `getOrCreateTodaysAudit` resumes today's draft across restarts.
- [x] Provisioning down-sync (locations + templates from Supabase, fire-and-forget).
- [x] Migrations, WAL mode, repository layer scaffolding.