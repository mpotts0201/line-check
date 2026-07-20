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
