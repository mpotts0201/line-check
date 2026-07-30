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

---

## 2026-07-20 — Auto-sync: edge-triggered NetInfo flush; manual button → 7e give-up fallback

**Decision:** T7d wires a NetInfo listener that auto-runs the flush worker when connectivity
returns, via a pure controller `createAutoSync({ flush })` (`src/sync/autoSync.ts`).
1. **Edge-triggered + in-flight guard.** Flush only on a `false → true` connectivity edge,
   never on a steady 'connected' event; a re-entrant trigger while a flush runs is dropped.
   Initial state is 'disconnected', so the first confirmed connection (incl. the event NetInfo
   emits on subscribe) drains a queue left from a prior offline session.
2. **Pure injectable controller.** It takes only a `flush` thunk — imports neither NetInfo nor
   `supabase` — so it's unit-tested with a fake flush; the app root (`app/_layout.tsx`,
   `<AutoSync/>` inside `SQLiteProvider`) is the only place NetInfo + the singleton are wired.
3. **Standalone guard, no shared coordinator.** The 7c manual button keeps its own flag rather
   than sharing a mutex with the listener.
4. **Manual button becomes a give-up fallback in 7e** (not this bullet). It stays an always-on
   control during 7d; in 7e it converts to a **per-audit** "Retry sync" shown only when an audit
   is stuck (`attempts >= 7`, unsynced).

**Why:**
- **Edge + guard:** "sync when connectivity returns" is a transition, not a level; flushing on
  every 'connected' event would spam. The guard makes overlapping/rapid triggers a no-op —
  exactly the AC.
- **Pure controller:** keeps NetInfo (a native module) out of the test graph entirely — no mock
  needed — and mirrors the worker's DI seam.
- **Standalone guard is safe:** the worker is idempotent (upsert-by-id + delete-on-confirm), so
  a rare manual+auto overlap can't duplicate; and once the button is a give-up fallback it only
  appears after auto-sync has stopped retrying, so overlap effectively can't happen. A shared
  coordinator would be extra coupling (rewiring the shipped button) for no real gain.
- **Give-up = 7:** bounds retries so a permanently-failing audit stops burning battery/network
  and instead surfaces a manual escape hatch. The threshold + per-audit surfacing belong with
  7e's `attempts` machinery and 8b's badge, so building the fallback there (not in 7d) keeps
  each bullet coherent.

**Alternatives considered:**
- **Flush on every 'connected' event (no edge)** — rejected: redundant flushes on every
  NetInfo emit.
- **Shared flush coordinator (single mutex for manual + auto)** — rejected for 7d: more scope
  (rewires the 7c button), unnecessary given worker idempotency + the give-up-fallback model.
- **Build the give-up fallback button now** — rejected: it needs 7e's `attempts`/give-up state,
  which doesn't exist yet; forcing it into 7d would smear two bullets together.

---

## 2026-07-20 — Retry/backoff: per-row attempts, give-up at 3, injected-timer scheduler

**Decision:** T7e adds the flush failure path — the last piece of the sync engine.
1. **Give-up threshold = 3** (revises the tentative "7" in the 7d entry). Eligible-to-flush =
   `sync_queue` rows with `attempts < 3`; the worker skips the rest, so auto-sync stops retrying
   a stuck audit. The user's reasoning: because the backoff delay doubles each try, 3 attempts
   already spans a sensible window.
2. **Per-row `attempts`, persisted.** On any flush failure the worker bumps `attempts` for every
   row in the batch (all-or-nothing preserved — nothing is deleted on failure). Because it lives
   in `sync_queue`, backoff progress + give-up survive an app restart.
3. **Exponential `backoffDelay(attempts)`** (`src/sync/retry.ts`): base 2s × 2^(attempts−1),
   capped at 30s. Pure and unit-tested. The **freshest eligible row's** new count drives the
   cadence (`min(attempts)+1`); for the common single-audit case that's just its attempts.
4. **`createSyncScheduler({ flush, schedule })`** — one flush entry point with an in-flight guard
   that self-reschedules on failure (under the limit) via an **injected** `schedule`. Production
   passes a `setTimeout` wrapper (timers tracked + cleared on unmount); tests pass a controllable
   fake, so the retry loop is verified without real timers. The 7d `createAutoSync` feeds its
   connectivity edges into `scheduler.trigger`.
5. **Engine-only; per-audit fallback deferred to 8b.** The global "Sync now" button is untouched
   in 7e (and, like auto-sync, skips given-up rows). The per-audit "Retry sync" that surfaces a
   stuck audit and resets `attempts` lands in 8b, alongside the per-audit sync-state badge it
   needs.

**Why:**
- **attempts as one counter for two jobs** (backoff clock + give-up bound) keeps the state
  minimal and durable; a stuck audit converges to a bounded, persisted state rather than
  retrying forever.
- **Injected schedule** mirrors the DI seam used everywhere in the sync engine: the decision
  logic (when/how long to retry, when to give up, overlap guard) is pure and tested; only the
  `setTimeout` glue is untested, and it lives at the app root like the NetInfo wiring.
- **Engine-only split:** the fallback button fundamentally needs per-audit sync-state surfacing,
  which is 8b's job — building it in 7e would duplicate that work and smear two bullets.

**Alternatives considered:**
- **A separate in-memory backoff counter (not per-row attempts)** — rejected: wouldn't survive a
  restart and would need reconciling with the persisted give-up count; one column does both.
- **Timer owned inside the scheduler (real `setTimeout`)** — rejected: untestable without fake
  timers; injecting `schedule` keeps the loop deterministic in tests.
- **Backoff off the max (or a global) attempts instead of the freshest row** — rejected: the
  freshest failing row deserves the shortest wait; max would over-delay newly-queued work.

---

## 2026-07-21 — Remote schema checked in; sync errors surfaced (dev-only detail)

**Context:** the first real end-to-end sync failed silently. Every completed audit reported
"Sync failed — will retry" and nothing reached Supabase. Root cause: `toRemoteAudit` wrote
`signature_uri`, but the remote column is `signature_path` (likewise `photo_path`, which 8a
must respect). PostgREST returned `PGRST204`; the `audits` upsert runs before `audit_items`,
so the batch failed at the first request and the all-or-nothing path correctly re-queued
everything. The engine behaved exactly as designed — it just had no way to say why.

**Decisions:**
1. **`supabase/schema.sql` is checked in.** Transcribed from the live project via
   `information_schema` AFTER the tables were hand-created in the dashboard. It documents the
   remote contract rather than provisioning it — the dashboard is still the source of truth.
2. **Flush errors are surfaced, not discarded.** `onSyncNow` previously dropped a fully
   populated `result.error` for a fixed string. The raw object now always goes to
   `console.warn`; the decoded Postgrest code renders on-device **only under `__DEV__`**.
3. **`status: 'empty'` is disambiguated.** It conflated "nothing queued" with "rows queued but
   all given up"; the latter rendered as "Up to date", which misstated whether the user's work
   was durable. `getSyncQueueStats` splits them.
4. **`resetAuditData` (`src/db/dev.ts`) + a `__DEV__`-gated reset button.** Clears audits,
   audit_items, and sync_queue in one transaction; keeps locations/checklist_templates so a
   reset works **offline**.
5. **`getSyncQueueStats` takes the threshold as a parameter.** Importing `MAX_ATTEMPTS` into
   `src/db` would invert the layering (sync depends on db) and close a
   `syncQueue → retry → flush → syncQueue` loop.

**Why:**
- **The unit tests could not have caught this.** `flush.test.ts`'s fake stores rows in a `Map`
  keyed on `id` and never asserts column names — any shape passes. The DI seam that makes the
  worker testable also makes it blind to the remote contract. Schema drift needs a schema
  artifact or an integration test, not more unit tests against a permissive fake. This is the
  main lesson of the incident and the reason for decision 1.
- **`__DEV__` splits the audience.** `PGRST204 · Could not find the 'signature_uri' column` is
  what a developer needs and noise to a manager in a walk-in cooler. Silence was the actual
  bug; a raw Postgrest code in production would be a different one.
- **Offline reset (4)** matches the app's premise: dropping the seed tables would make the app
  unusable until the next successful `provision()` round-trip.

**Alternatives considered:**
- **Revert the diagnostics once the bug was fixed** — rejected: the original code violated the
  project's own "no silently swallowed errors" standard. The value isn't this bug, it's the
  class (RLS changes, FK violations, dropped columns).
- **Keep resetting `attempts` on every manual "Sync now"** — rejected: it silently defeats the
  7e give-up threshold, making `MAX_ATTEMPTS` decorative. 8b's per-audit retry is the right
  home for a deliberate reset.
- **Generating `schema.sql` as a real migration and applying it** — rejected for now: the
  tables already exist with data; a migration path is a production-readiness item, not a
  same-day fix.
- **Renaming the local column to `signaturePath`** — rejected: local holds a device `file://`
  URI and remote holds a Storage object path. They are genuinely different things, and 8a must
  map the post-upload path rather than passing the local URI through.

---

## 2026-07-28 — Sync trigger rewrite: one explicit state machine; backoff, attempts, and give-up removed

**Supersedes:** the 2026-07-20 "Auto-sync: edge-triggered NetInfo flush" and "Retry/backoff:
per-row attempts" entries (their code is deleted), and items 3/5 of the 2026-07-21 entry
(`getSyncQueueStats` no longer splits given-up rows or takes a threshold). Full working
document: `REFACTOR_PROPOSAL.md` (v3, comprehension gate passed 2026-07-27); built as
R1–R4, 2026-07-28.

**Decision:** The trigger layer (`autoSync.ts` + `createSyncScheduler` + `requestFlush.ts` +
~30 lines of wiring in `_layout.tsx`) is replaced by ONE file, `src/sync/syncEngine.ts`: an
explicit two-state machine (`idle | syncing`, module-level state) that every trigger pokes
through a single `syncNow()`. Timed retry/backoff, the `attempts` counter, and the give-up
threshold are removed entirely. On failure the queue stays intact and every subsequent poke
— reconnect edge, audit completion, manual Sync now — simply re-attempts it. Failures are
surfaced by one `console.warn` at the worker's failure branch (the choke point every trigger
flows through) plus the badge staying "Not synced". Tests mock modules (`jest.mock`) instead
of production code carrying DI seams. The dead `attempts` column stays in the schema to
avoid a migration (drop parked post-7/31).

**Why:**
- **Comprehension is the bar.** The old layer failed the project's own rule ("I can explain
  any line if asked"): three files handing closures to each other, `flush` naming three
  different things, behavior existing only once everything was composed — test-induced
  design damage. The state machine version is readable top to bottom and the trickery lives
  in the test file, where trickery belongs.
- **Backoff auto-healed almost nothing.** Three attempts at 2s/4s spacing only fixed
  sub-6-second blips while accelerating permanent failures into give-up within ~6 seconds.
  Event-driven re-attempts fire at moments where success is newly plausible (signal back,
  user present) — better failure behavior with zero machinery.
- **The counter never diagnosed anything.** "Failed 3 times" says nothing about why; the
  actual diagnostic is the surfaced error (7/21 incident). And give-up's original job —
  stopping a battery-burning timer loop — evaporated when the timer went. A record that
  never syncs is an app bug or bad data the Zod gate should catch, not something a counter
  fixes: post-fix, a no-give-up queue drains itself on the next poke, whereas the give-up
  design needed a manual reset (the 7/21 incident proved it).
- **The acknowledged trade:** `attempts` had quietly become a quarantine — after 3 failures,
  poison rows were skipped so later audits could sync around them. Without it, one
  permanently-rejected row blocks the whole all-or-nothing batch until the underlying bug is
  fixed (then everything drains automatically). Accepted because poison sources are rare
  here (single-writer backend, client-side Zod validation), it collapses into the already-
  documented poison-batch limitation (see README known limitations), and the production
  remedy has a name: fail-then-split bisection.
- **Findings the process surfaced (logged in REFACTOR_PROPOSAL §10):** the comprehension
  gate found flush failures on the auto/Submit paths were fully silent (warn was only in the
  History button handler → moved to the worker's failure branch); R2 planning found the
  engine's ignore-the-result contract killed History's result-driven status text (owner
  call: console-only — the status line now reads queue stats); R2 review found
  `flushSyncQueue` can throw past its own error handling, so `syncNow` swallows-and-warns
  rather than rejecting through fire-and-forget call sites.

**Alternatives considered:**
- **Rename-only refactor** (keep the three files, better names) — rejected: the problem was
  indirection, not naming; the behavior would still only exist in composition.
- **XState (or any FSM library)** — rejected: a 2-state machine with one guard line does not
  need a dependency; the library's ceremony would exceed the entire engine.
- **Dropping the trigger tests instead of the DI plumbing** — rejected: the tests are
  valuable; what had to go was production code shaped for tests. `jest.mock` moves the
  seams into the test file.
- **Keeping attempts as quarantine only** (no backoff, skip rows after N failures) —
  rejected: keeps the counter, the threshold, the reset UX, and the stuck state for a
  poison scenario that is rare here and better handled by the documented production remedy.

---

## 2026-07-29 — Sync store carries the signal, not the data

**Working document:** `SYNC_STATUS_FIX.md` (proposal approved 2026-07-29, built same day).

**Decision:** The engine's `idle | syncing` status moves out of `syncEngine.ts`'s module
variable into a ~12-line Zustand store (`src/sync/syncStore.ts` — first Zustand use in the
repo), alongside a `flushCount` counter that `syncNow()` bumps in its `finally`. The bump is
the `sync_finished` signal: History subscribes to `flushCount` and re-runs its existing
`refresh()` (an SQLite re-query) whenever it changes, so a background flush — reconnect edge
while the user is sitting on History — flips the badge live instead of on the next focus.
The signal fires on failure too (`finally`, deliberately): it means "a flush attempt ended,
re-read the world," not "success," matching the engine's existing ignore-the-result contract.
The store never holds query results — SQLite remains the only read path; the store is a
doorbell, not a filing cabinet.

**Why:**
- **The badge data had no push path.** `syncStates` is component state filled by a query;
  focus, the manual button, and dev reset were the only writers. Background syncs updated
  SQLite and told no one.
- **One `status`, one home.** Mirroring engine status into a store while keeping the module
  var would be two copies that can drift; moving it keeps the single-flight guard reading
  the same value the UI watches.
- **A counter, not a boolean or timestamp.** Every emission is a change (5→6→7), so effect
  dependencies see back-to-back flushes; a boolean can repeat and be missed, a timestamp
  drags in clock reads.

**Alternatives considered:**
- **expo-sqlite `addDatabaseChangeListener`** — a real push mechanism, wrong event shape:
  fires per row (a 12-row drain = 12+ callbacks → needs a debounce), fires for unrelated
  `sync_queue` writes (enqueue), only sees its own connection, and needs a global
  `enableChangeListener` flip for one screen. The event we care about — "a flush ended" —
  already exists at exactly one line in the engine.
- **Hand-rolled listener set on the engine** (`onSyncFinished(cb)`) — bespoke pub/sub is the
  hand-rolled plumbing the comprehension rule exists to avoid; Zustand is the stack's blessed
  version of the same thing.
- **Polling** — the battery-burning timer loop the 2026-07-28 rewrite just deleted.

**Parked with 8b-iv (not forgotten):** the Sync now button reading `status` from the store
(background flushes would show "Syncing…" and disable the buttons — a semantics change that
belongs with the SyncBar extraction), and `isOnline` in the store for an offline indicator.

## 2026-07-29 — History screen split: SyncBar + AuditCard out of the route file (8b-iv)

**Working document:** `HISTORY_SCREEN_REFACTOR_PROPOSAL.md` (proposal reviewed and both
parked decisions resolved 2026-07-29, built same day).

**Decision:** `app/history/index.tsx` (316 lines — flagged in the 2026-07-29 line-count
audit) splits into
the screen (~105 lines: two queries, two refresh effects, the FlatList) plus
`src/components/history/SyncBar.tsx` (sync button, status line, dev reset),
`src/components/history/AuditCard.tsx` (card + badge helpers), and
`src/sync/formatSyncError.ts` (pure error→string, now unit-tested). Components live in
`src/components/history/`, NOT `app/history/` as the original ticket wording said — any
file under `app/` becomes an expo-router route, and `/history/SyncBar` should not be a
navigable path. Named for the screen they serve; precedent `src/components/ScreenWrapper.tsx`.

**Sub-decisions (parked from SYNC_STATUS_FIX §9 to "8b-iv ticket time", resolved now):**
- **The button's `syncing` reads the store's `status`** (`useSyncStore((s) => s.status ===
  "syncing")`); local tap-state deleted. Any flush — manual, reconnect edge, completion
  poke — shows "Syncing…" and disables both buttons. Deciding factor: the Reset disable is
  flush-safety (wiping `sync_queue` mid-upsert pushes rows for locally-deleted audits), and
  local tap-state only covered manual flushes — a background reconnect flush left Reset
  tappable during exactly the window the disable exists for. Accepted tradeoff: an
  unprompted "Syncing…" blink on reconnect.
- **`runSync()`'s trailing `refresh()` dropped.** The engine's `flushCount` bump already
  triggers the screen's re-read, so the explicit call was a second delivery of the same
  message. Checked before dropping: a guarded no-op poke (offline/busy) doesn't bump the
  counter, but it also changes nothing in SQLite — nothing to re-read — and the status
  message still comes from `getSyncQueueStats`. Flush results now reach the badges through
  exactly one channel (the signal); SyncBar's `onDataChanged` prop fires only after dev
  reset, which is not a flush and must ask for its re-read explicitly.

**Also recorded here per the ticket:** per-audit sync state is a SEPARATE query
(`getAuditSyncStates`), merged with `getCompletedAudits` by audit id in the screen — joining
`sync_queue` into the summaries query would fan out the GROUP BY that builds the
pass/fail/na counts. (The old entry's other half — per-audit vs global retry — dissolved
with the retry removal.)

**Behavior changes shipped with the split (beyond the two above):**
- Load failures render as the screen's own error line under the header, styled as an error,
  instead of writing into the sync bar's status text. "Did the read work" and "did the push
  land" are different questions; a load error is no longer overwritten by tapping Sync now,
  and a successful read now retires a stale one.
- The Sync now button and each audit card gained `accessibilityRole`/`accessibilityLabel`
  (standards gap; the reset button already had them).

**Alternatives considered:**
- **Co-locate components in `app/history/` per the ticket's wording** — rejected: route
  pollution + typed-routes codegen churn for files that are not screens.
- **SyncBar as a dumb component (props: syncing, status, three callbacks)** — rejected:
  five-prop plumbing to move state one level up for no reader's benefit; the bar owns its
  own concern end-to-end and the parent's contract is one named callback.
- **Threading the screen's load error down into SyncBar's status line** (status quo
  behavior) — rejected: exactly the multi-owner state the split exists to remove.

**Still parked:** `isOnline` in the store for an offline indicator (new surface, not
cleanup); the shared theme/constants file (`BADGE_COLOR` stays in AuditCard).

---

## 2026-07-29 — Item entry keeps its dedicated screen and explicit Save; one-tap fast path rejected

**Context:** While planning the theme/polish pass (THEME_POLISH.md), a "Tier 2"
interaction redesign was on the table: for items that don't require a temperature,
tapping Pass could save immediately and pop back to the checklist — collapsing
tap item → tap Pass → tap Save into two taps, across ~20 items per line check.

**Decision:** Rejected. Recording a result stays a three-step, deliberately
"cumbersome" flow: navigate into the item screen, pick a result, explicitly Save.
The polish pass is cosmetics only; no interaction changes.

**Why:**
- **The friction is a failsafe, not a defect.** The user is walking a line with the
  phone in one hand — wet hands, gloves, bumps. A dedicated screen plus an explicit
  Save means a stray touch can't silently record a result on a food-safety record.
  Fat-fingering an option while moving is the likely error mode; the extra step is
  what absorbs it.
- **Intention fits the domain.** An audit is an attestation, item by item. A flow
  that makes each entry a deliberate act matches what the record claims to be —
  speed-running pass marks is exactly what a paper-whipped line check looks like.
- **The fast path forks the flow.** Notes and temps still need the full screen, so
  one-tap creates two entry modes keyed on item type — the same multi-mode shape
  this log already rejected for the review screen (2026-07-17). And putting three
  pressables on every checklist row alongside row-tap navigation crowds the row
  into competing targets.
- **POC honesty:** yes, this is a portfolio piece and nobody audits with it. But
  "what would I build if it were real" is the stated design priority, so it's
  designed as if real — and the rejection itself is the demo-able judgment.

**Alternatives considered:**
- **One-tap save-and-pop for non-temp items** — rejected: forked flow, fat-finger
  exposure, weaker record semantics (above).
- **Inline pass/fail/na buttons on checklist rows** — rejected: crowded rows,
  three small targets next to a navigation target, worst-case for gloved use.
- **Confirm-on-exit instead of a Save button** (auto-save drafts on back) —
  rejected: blurs "recorded" vs "abandoned" for no tap savings.

---

## 2026-07-30 — P6 motion: two Reanimated idioms on purpose; press-driven, not effect-driven

**Context:** The parked "Reanimated polish" bullet, built per THEME_POLISH §5/P6
(implementation plan in §9, build log in §8). First use of react-native-reanimated
in the app — already installed, and babel-preset-expo auto-injects the worklets
plugin (see the 2026-07 babel entry), so no config or jest work. Pulled forward
from post-7/31 because the badge flip is the demo recording's centerpiece.

**Decision:** The two animation moments use two different Reanimated idioms:

- **Badge flip → the CSS-transition API** (`transitionProperty: "color"` on
  `Animated.Text` in AuditCard). The badge color is *derived state* — it arrives
  from data (flushCount → refresh → new prop), not from a gesture. A transition
  declares "when this property changes, tween it," and by web-CSS semantics it
  animates **changes only, never the initial value** — so "no animation on first
  mount / FlatList recycle" is guaranteed by construction, with no first-mount
  ref guard. The whole diff is one constant and `Text` → `Animated.Text`.
- **Segment pop → `useSharedValue` + `useAnimatedStyle` + `withSpring`**
  (new `SegmentButton`). A spring is physics responding to an impulse (the
  tap); CSS timing functions can't express one. Two idioms is not
  inconsistency — it's the declarative/imperative line the framework itself
  draws: transitions for state that changes, springs for events that happen.

**The spring is press-driven, not a `selected` effect.** The item screen seeds
its selection from SQLite on reopen; an effect watching `selected` would pop the
saved segment on screen open — a mount animation the spec's "state-change
feedback only" rule forbids. Selection can only change via press, so
`if (!selected)` inside the press handler is exactly "on becoming selected,"
and it keeps a tap on the already-selected segment silent for free.

**Alternatives considered:**
- **One idiom everywhere (classic shared-value for both)** — rejected: the badge
  would need a shared value, `interpolateColor`, an effect watching the prop,
  and a first-mount guard — five pieces of machinery to reimplement what the
  transition annotation gives in two style keys.
- **CSS keyframe animation for the pop** — rejected: approximating a spring
  with keyframes trades real physics for a hand-tuned curve and reads worse.
- **`Animated.createAnimatedComponent(Pressable)`** instead of an
  `Animated.View` wrapper — rejected: an extra concept to explain for zero gain.
- **Animating badge opacity alongside color** — rejected: the label text swaps
  instantly ("Not synced — N waiting" → "Synced ✓"); one `Text` can't crossfade
  two strings, so an opacity dip would just flicker. Color-only; adding
  `"opacity"` later is a one-word change if the sweep reads too subtle on
  device.

**Addendum (2026-07-30, same day):** on-device, both moments read as invisible —
owner asked for a bump. Segment pop flipped from compress (0.95) to enlarge
(1.12): a fingertip covers the button, so shrinking hides under it while growing
escapes it. The badge gained a scale bump (grow 1.15 ~120ms, spring back) on the
pending→synced flip. That one IS effect-driven — unlike the segment there is no
gesture to hang the spring on, so a `wasSynced` ref guard supplies the
changes-only semantics the CSS transition gets for free (mounts and FlatList
recycles stay static). The bump rides on a wrapper `Animated.View` that hugs the
word and scales from its left edge; CSS-transition props and `useAnimatedStyle`
stay on separate components.

**Second addendum (2026-07-30): `ReduceMotion.Never` on the spring/timing cues.**
Even after the amplitude pass, nothing moved on device. Diagnosis (via a
UI-thread log stream and a forced `ReduceMotion.Never` test spring): the
animation runtime treats the system reduce-motion flag as ON even though the
iOS global toggle is off — every default-mode `withSpring`/`withTiming` was
snapping straight to its end value. Likely culprits: iOS 26 per-app
accessibility settings for Expo Go, or an iOS 26/Expo Go detection quirk.
Decision: the segment pop and badge bump pin `reduceMotion: ReduceMotion.Never`
— they are brief (~150–300ms), small-amplitude, state-carrying cues, and the
flag is demonstrably unreliable in this environment; a flag that misreports ON
would otherwise kill the demo's centerpiece. The CSS color transition needs no
override — reanimated's CSS module doesn't consult the flag at all (verified in
the installed source). Revisit if the app ever ships to real users: honoring
reduce motion for the scale cues (while keeping the color sweep) would be the
accessible production behavior.

## 2026-07-30 — Signature capture: signature-canvas package over hand-rolled; legacy file API over the SDK 54 class API

**Decision 1 — `react-native-signature-canvas` (WebView) over hand-rolled gesture
capture.** The package brings signature_pad's mature stroke smoothing and a
clear/read API for two installs and ~zero custom gesture code; hand-rolling
(gesture-handler + SVG + view-shot) was a day-plus of edge cases during demo
week. Owner's explicit call: "a good senior wants practical, not always
hand-rolled." Capture happens in a full-screen RN `Modal`
(`src/components/review/SignatureModal.tsx`) — a real signing area for a
finger, and no ScrollView underneath to steal downward strokes. The components
live in `src/components/review/`, NOT under `app/` (Expo Router registers
every file there as a route — CLAUDE.md's convention lines were corrected to
say so). Design doc: `SIGNATURE_CAPTURE_PROPOSAL.md`.

**Decision 2 — signature is held in screen state and persisted only at
completion, inside `completeAudit`'s transaction.** `completeAudit` snapshots
the `audits` row into `sync_queue` within its transaction, so the signature
URI must ride the same UPDATE — a post-completion write would freeze `null`
into the queued payload. `completeAudit` gained a required third parameter.
Corollary accepted on purpose: a signature abandoned with the screen is
discarded (sign-then-complete is one ceremony; no draft-signature semantics,
no orphan files). The completion gate lives in `auditCompleteSchema`
(`signature: z.string().min(1)`), not in the screen. Remote upload of the PNG
stays deferred alongside photo upload — `flush.ts` passes the local `file://`
URI to `signature_path` as a documented placeholder.

**Decision 3 — legacy `writeAsStringAsync` over the SDK 54 `File` class API.**
The first cut used `new File(Paths.document, …).write(base64, { encoding:
"base64" })` — typings check out, and the option is real in the native module —
but on device in Expo Go the completion path threw (generic Alert, exception
not yet captured; the catch now `console.warn`s it). Rather than burn demo-week
round-trips debugging the new SharedObject layer inside Expo Go — this
project's third Expo Go quirk after the reduce-motion misreport and the header
capsule — `src/files/signature.ts` uses `expo-file-system/legacy`'s
`writeAsStringAsync` with `EncodingType.Base64`: the years-proven path for
exactly this base64→PNG case. Alternatives: debugging the class API on device
(deferred — revisit on a dev build), or storing base64 in SQLite (bloats rows
~20–100KB and diverges from the photoUri file pattern).

## 2026-07-30 — Storage wire-in: signature upload inline in the flush; public bucket accepted for the POC

**Decision 1 — upload inside `flushSyncQueue`, before the row upserts.** One
sync ceremony: the existing no-retry model covers the upload for free (any
failure → choke-point warn → queue intact → next poke retries everything), and
uploading first means a synced row never references an object that doesn't
exist. The deterministic path (`<auditId>.png`) plus `upsert: true` makes every
retry an overwrite — the storage twin of the row upserts' merge-on-id.
Alternatives rejected: a second upload phase after row sync (doubles the sync
states for a ~20KB file; the refactor's whole point is one legible machine) and
upload-at-completion (breaks offline-first). Accepted partial state: upload
lands, row upsert fails, audit never re-syncs → one orphaned ~20KB object.
Owner accepted at gate.

**Decision 2 — remote stores the in-bucket object path, not a URL.**
`signature_path` gets `<auditId>.png`; the bucket name is a code constant.
URLs derive from paths at read time; paths can't be recovered from stale URLs.
Audits predating the signature feature sync `signature_path: null`.

**Decision 3 — public `signatures` bucket with anon write policies, accepted
as the POC posture.** Public-read + THREE RLS policies on `storage.objects`
(insert + update + select, `to anon`, all scoped `bucket_id = 'signatures'`) —
the storage twin of RLS-off on the tables, documented in README
known-limitations. The select policy was not optional: with only insert +
update, plain inserts succeeded but any `x-upsert: true` upload failed with
"new row violates row-level security policy" — the storage API's upsert path
needs the object row to be *visible* (curl-isolated on device day; the
proposal's gotcha section predicted exactly this). The select policy exposes
object *metadata rows* to anon; image readability was already public via the
bucket toggle. Risk
reasoning: the public toggle affects reads only (no listing, no writes);
object paths are client-generated UUIDs — capability URLs; the bucket caps
files at 1MB and `image/png` only, bounding anon-key abuse; only demo data is
signed. Production shape is named: private bucket, authenticated policies,
signed URLs.

**Decision 4 — the seams stayed, no new plumbing.** `SyncClient` grew a
`storage.from().upload()` slice mirroring the real client structurally (the
real client satisfies it unchanged; the test fake scripts a storage branch).
The PNG read lives in `src/files/signature.ts` (`readSignatureBase64`) so
flush.ts keeps zero native imports — flush tests `jest.mock` that module, the
precedent syncEngine.test set. base64→ArrayBuffer via the `base64-arraybuffer`
package (Supabase's documented RN pattern; owner's standing practical-over-
hand-rolled call). Gotcha pinned in code: `contentType: "image/png"` is
load-bearing — the bucket's MIME restriction rejects the inferred
octet-stream without it.
