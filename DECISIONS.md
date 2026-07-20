# DECISIONS — LineCheck

Running log of non-obvious architectural tradeoffs. One entry per decision:
date, decision, why, alternatives considered.

---

## 2026-07-16 — Zod for validation; no form library

**Decision:** Validate item saves (and, later, audit completion) with a Zod schema in a
domain-layer module (`src/validation/audit.ts`). No form-state library.

**Why:** The item-detail screen is three fields (result, optional temp, note) with a
single Save — form-state management buys little. The real need is *domain* validation
("no blank submissions"; temp required when the item requires it), which belongs in a
UI-agnostic, unit-testable schema that mirrors the existing repository-layer split. The
same schema module will back T5's "can't complete an audit with unanswered items" gate,
so the rules live in one place rather than being duplicated across screens. Zod's
schema-inferred types (`z.infer`) keep the validated shape and the TypeScript type in
sync from a single source. Zod is pure JS and Expo Go SDK 54-compatible.

**Alternatives considered:**
- **Formik + Yup** — rejected. Formik is effectively stagnant and re-renders the whole
  form per keystroke (worse on RN); Yup's TypeScript inference is weaker than Zod's.
- **React Hook Form + Zod** — considered. The modern mainstream form stack, but its
  uncontrolled-input model adds ceremony against RN's controlled `TextInput`s (already
  seeded from SQLite here) for a payoff that a three-field screen doesn't justify.
- **Hand-rolled inline checks** — rejected. Fastest to ship but not centralized or
  reusable for T5, and a weaker architecture signal.

---

## 2026-07-16 — Complete disabled while unanswered items exist

**Decision:** The review screen's Complete button is disabled until every audit item is
answered (and any temp-required item has a reading), enforced by `auditCompleteSchema`
in `src/validation/audit.ts` — the same Zod module T3 introduced.

**Why:** A signed-off line check with blank items is a meaningless food-safety record —
completion should assert "every station was checked." Enforcing it through the shared
validation module (rather than an inline screen check) keeps the "no blank submissions"
rule in one place: item-level saves and audit-level completion apply the same rule, and
a null `result` failing `z.enum` is exactly the gate with no extra branching.

**Alternatives considered:**
- **Allow completion with unanswered items** — rejected; defeats the audit's purpose.
- **Inline count check in the screen** — rejected; duplicates the rule already living in
  the validation module and drifts from the item-save path.

---

## 2026-07-16 — Same-day re-audit allowed; post-complete nav to Locations

**Decision:** Completing an audit sets `status = 'complete'` + `completedAt` and returns
to the Locations list. Because `getOrCreateTodaysAudit` filters on `status = 'draft'`,
reopening the same location later that day starts a **fresh draft** rather than resuming
the completed one — same-day re-audits are allowed.

**Why:** Restaurants can legitimately run more than one line check per day (shift
changes, re-inspections after a failed item is fixed). The draft-only resume filter
already yields this behavior for free — no extra flag needed. Post-complete navigation
goes to Locations for now because the History screen (T6) doesn't exist yet; T6 will
switch the target to `/history`.

**Alternatives considered:**
- **Block same-day re-audit / resume the completed audit** — rejected; would require
  reopening a completed record and contradicts the immutable-once-signed intent.
- **Navigate straight to History now** — rejected; the route doesn't exist until T6, so
  it would land on Expo Router's "Unmatched Route" screen.

---

## 2026-07-17 — Read-only audit detail is a separate screen, not a review-screen mode

**Decision:** A completed audit opened from History renders in a dedicated read-only
screen (`app/history/[auditId].tsx`). History was promoted to a route directory —
`history/index.tsx` (list) + `history/[auditId].tsx` (detail). The review screen
(`app/audit/review/[auditId].tsx`) is unchanged and stays draft→sign only. This reverses
T6.5's original sketch of reusing the review screen in a read-only mode branched on audit
`status`.

**Why:** The two screens have genuinely different jobs — the review screen mutates (gate +
Complete) a draft; the detail screen is an immutable, full-record view of a signed audit.
Folding both into one component branched on `status` produces a multi-mode component whose
every control needs a "which mode am I in" guard — exactly the kind of state-heavy screen
that rots. Two single-responsibility screens are easier to read and change. This does sit
in tension with CLAUDE.md's "no extra screens"; the tension is deliberate and the
maintainability win justifies it here.

**Alternatives considered:**
- **Reuse the review screen, branch on `status`** — rejected: multi-mode component; dead
  controls (Complete/gate/signature) hidden by conditionals; the read path and the
  mutate+sign path drift within one file.
- **Extract a shared `Count` (and item-row) presentational component now** — deferred. The
  duplication is a ~10-line stateless block across three screens; extracting it is a
  separate cleanup, not part of shipping the detail screen (YAGNI + one-bullet discipline).

---

## 2026-07-20 — sync_queue: full-row snapshot payload, enqueue at completion only

**Decision:** T7a adds the `sync_queue` table and starts feeding it. Three choices:
1. **Payload is a full-row JSON snapshot.** Each queue row stores `JSON.stringify` of the
   local row (`SELECT *`) captured at completion, in the `payload` column CLAUDE.md already
   specifies. The 7c flush worker deserializes and upserts it — it never re-reads the main
   tables.
2. **Only `completeAudit` enqueues.** `getOrCreateTodaysAudit` and `updateAuditItem` are
   untouched; draft edits stay local. LineCheck syncs a *finished* audit as a unit.
3. **Enqueue lives in a new `src/db/syncQueue.ts` repository module** (`enqueue(db, row)`),
   called from `completeAudit` inside its transaction — the UPDATE and the queue inserts
   commit atomically.

**Why:**
- **Snapshot** is safe here because a completed audit and its items are immutable — the
  snapshot is final, so there's no staleness risk that a re-read would fix. It keeps the
  queue self-contained: each row is a complete, frozen instruction, which makes 7c's
  crash-recovery/idempotency story easier to reason about and to unit-test (the worker is
  stateless w.r.t. the audits/audit_items tables).
- **Completion-only** matches the app's model — a half-filled draft is not a record worth
  syncing, and the T5 gate already guarantees a completed audit is fully answered. Fewer
  queue rows, no churn on every keystroke.
- **Repository module** keeps all sync_queue SQL in one place (the existing repository-layer
  pattern; screens/functions never inline sync SQL). 7c reuses it for delete-on-confirm.
- The `status = 'draft'` guard on the UPDATE does double duty: a re-tap changes 0 rows, so
  the enqueue is skipped — completion and enqueue are idempotent together, no dup queue rows.

**Alternatives considered:**
- **entityId pointer + re-read at flush** — rejected. Leaves the documented `payload` column
  unused and couples the worker to re-reading the main tables at flush time, for a freshness
  benefit that doesn't exist here (the rows are frozen once complete).
- **Enqueue on every mutation** (per CLAUDE.md's "every mutation appends a sync_queue row")
  — rejected for this slice: syncs half-filled drafts and multiplies queue churn for no demo
  value. Revisit only if per-edit sync becomes a requirement.
- **Inline the sync_queue SQL in `completeAudit`** — rejected: scatters queue read/write SQL
  (7c's dequeue would then live apart from the enqueue), against the repository-layer split.

---

## 2026-07-20 — Testing strategy: jest-expo, sync + validation, no UI tests

**Decision:** Add an automated test suite (`jest-expo` preset). Scope is deliberately narrow:
the **sync engine** (`src/sync/`) and the **validation layer** (`src/validation/audit.ts`).
Repository tests (`src/db/`) are cheap follow-ons on the same seam, added if time allows.
**No component/screen/UI tests.** Two seams make this possible without a device:
- **DB seam** — the repository/sync code depends on a small TS *interface* of the db methods
  used (`runAsync`, `getAllAsync`, `getFirstAsync`, `withTransactionAsync`, `execAsync`).
  Production injects expo-sqlite; tests inject an in-memory `better-sqlite3` adapter, so tests
  exercise **real SQL** against a throwaway DB (never the device, never Supabase).
- **DI seam** — the sync worker receives `db` and the Supabase client as parameters (never
  imports the `supabase` singleton the way `provision.ts` does), so tests inject a scripted
  fake client (success / network error / die-mid-flush). Mirrors the existing repository
  pattern where every function already takes `db`.
CI (T8) runs `tsc --noEmit` + `jest` on GitHub's Linux runners — also sidesteps the
Windows/WSL rule that Claude can't run local commands.

**Why:** Test where correctness risk actually lives. The offline sync engine has properties
that are effectively impossible to hand-verify reliably — idempotency, FK-ordered upserts,
delete-on-confirm, crash recovery (kill mid-flush → no duplicates), exponential backoff — and
those same properties are the senior-level story this project exists to tell. Validation is
pure and near-free to cover. A crash-recovery unit test is both better engineering and a
stronger portfolio signal than any coverage percentage. UI tests are excluded on purpose:
in this author's experience they are brittle and low-ROI, and *real* UI verification belongs
in a browser/device-rendering E2E harness (Puppeteer / Cypress / Playwright), not Jest —
which this POC does not need. Manual airplane-mode checks remain the demo, not the safety net.

**Alternatives considered:**
- **Vitest** — faster and modern, but `jest-expo` handles Expo/RN module transforms out of the
  box and is what a reviewer expects in an Expo SDK 54 repo. Rejected for lower ecosystem fit.
- **Fake in-memory db object** (hand-rolled) — rejected: validates logic but never runs the
  actual SQL, so a broken JOIN/aggregate passes tests and only breaks on-device. The
  better-sqlite3 adapter runs the real queries for a one-dependency cost.
- **Mock `expo-sqlite` directly** — rejected: brittle, couples tests to native-module shape.
- **Full test pyramid incl. screen/component tests** — rejected per the UI-testing stance
  above; reads as junior (testing the easy surface) rather than the risky core.

---

## 2026-07-20 — Test harness build-out: jest-expo, canonical babel.config, SqlDb via Pick

**Decision:** T7b implements the harness the 2026-07-20 testing strategy describes. Concrete
build choices:
1. **`SqlDb` is `Pick<SQLiteDatabase, 'runAsync'|'getAllAsync'|'getFirstAsync'|'withTransactionAsync'|'execAsync'>`** (`src/db/types.ts`), and every repository function retypes its `db` param from `SQLiteDatabase` to `SqlDb`. Pure type change — a real `SQLiteDatabase` is assignable to `SqlDb`, so app callers are untouched.
2. **The in-memory better-sqlite3 adapter lives in `test/`** (not `src/`) so the native-only dependency never enters the app bundle. Its `withTransactionAsync` drives `BEGIN`/`COMMIT`/`ROLLBACK` by hand.
3. **A canonical `babel.config.js`** (`presets: ['babel-preset-expo']`) is added.
4. **jest config is just `{ preset: 'jest-expo' }`** — the default env is kept.

**Why:**
- **Pick over a hand-written interface:** the signatures (overloads + generics) stay auto-synced with expo-sqlite, so the seam can never drift from the real API, and `SQLiteDatabase → SqlDb` is provably a no-op. The adapter is checked against these exact signatures at compile time.
- **Adapter in `test/`:** better-sqlite3 is a native Node addon that must never ship to the device; keeping it out of `src/` makes that boundary structural. Manual BEGIN/COMMIT is required because better-sqlite3's `.transaction()` helper only wraps *sync* functions, while the seam is async — and real ROLLBACK semantics are exactly what the crash-recovery test needs.
- **babel.config.js:** not required (jest-expo self-supplies `expo/internal/babel-preset`), but adding the canonical file is the conventional Expo setup and makes babel a single explicit source of truth for Metro + jest. It's behaviorally identical to Metro's prior implicit default — babel-preset-expo auto-injects `react-native-worklets/plugin`, so reanimated is unaffected. Naming the preset by bare name in the config required adding `babel-preset-expo` as a direct dependency — it was previously only nested under `expo`, resolved via the internal path, so bare-name resolution from the project root failed until it was installed top-level.
- **Default test env kept:** jest-expo's env is already node-based (with the `react-native` export condition + RN setup mocks); better-sqlite3 loads fine under it. Forcing `testEnvironment: 'node'` would break jest-expo's `setup.js`.

**Alternatives considered:**
- **Hand-written `SqlDb` interface** — rejected: duplicates expo-sqlite's overloaded signatures and drifts.
- **Adapter under `src/db/`** — rejected: risks bundling a native-only dependency into the app.
- **No babel.config.js** (rely on jest-expo's internal preset) — viable and needs no Metro restart, but rejected for the explicit/conventional setup; the one-time restart cost is trivial in this solo workflow.
- **Inline babel in jest's `transform` with `configFile:false`** — rejected: more moving parts than the canonical file for no benefit here.

---

## 2026-07-20 — Flush worker: snake_case mapping, all-or-nothing flush, idempotent upsert

**Decision:** T7c's `flushSyncQueue` (`src/sync/flush.ts`) drains `sync_queue` to Supabase.
Concrete choices:
1. **Remote is snake_case; the worker maps camelCase → snake_case per entity** (`toRemoteAudit`
   / `toRemoteItem`). The mapper also drops the local-only `syncStatus` and omits `photoUri`
   (deferred to 8a's Storage upload).
2. **All-or-nothing per flush.** Read all pending → upsert audits (awaited to completion) →
   upsert audit_items → then, only on confirmed success, delete the flushed queue rows and flip
   `audits.syncStatus` → `synced`, in one local transaction. Any returned error or thrown
   network failure returns `{ status: 'error' }` early, leaving the queue fully intact.
3. **Idempotency via `upsert(rows, { onConflict: 'id' })` + delete-on-confirm.** A drained queue
   re-runs to a no-op; a mid-flush crash re-upserts the same ids (merge, never duplicate).
4. **The worker is singleton-free** — it takes `db: SqlDb` and a narrow `SyncClient` param
   (`PromiseLike`-typed so the real thenable Postgrest builder and a Promise fake both fit).
   The History screen is the composition root that injects the real `supabase` singleton.

**Why:**
- **snake_case + explicit mapper:** matches the existing remote `locations`/`checklist_templates`
  convention (idiomatic Postgres) and makes the local↔remote boundary an explicit, testable
  layer rather than leaking camelCase column names into the database.
- **All-or-nothing:** the simplest correct model. Partial deletes would need per-entity success
  tracking for no real gain here; leaving the whole batch queued on any failure is trivially
  safe to retry and is exactly what 7e's backoff will build on.
- **onConflict id + delete-on-confirm:** together they give idempotency and crash recovery for
  free — the two properties the unit tests (in-memory better-sqlite3 + a fake Supabase that
  models upsert-by-id) actually assert.
- **Singleton-free worker:** the whole point of the 7b DI seam; the fake client is injectable
  only because the worker never imports `supabase` (unlike `provision.ts`).

**Alternatives considered:**
- **camelCase remote columns (upsert payload verbatim, no rename)** — rejected: unidiomatic
  quoted Postgres identifiers, inconsistent with the existing snake_case tables; the mapper is
  cheap and doubles as the place local-only columns are dropped.
- **Per-entity partial delete** (delete audit queue rows after audits succeed, item rows after
  items succeed) — rejected: more bookkeeping, no benefit; all-or-nothing re-runs cleanly.
- **Re-reading rows at flush instead of the snapshot payload** — already rejected in 7a; the
  worker deserializes the queue payload and never touches the main tables to build the upsert.
