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
