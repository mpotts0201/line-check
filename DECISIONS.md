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
