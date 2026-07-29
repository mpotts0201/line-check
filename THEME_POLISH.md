# THEME_POLISH — LineCheck visual pass (Tier 1)

Status: **PROPOSAL — gated.** No styling code lands until the owner reads this,
pushes back, and passes it the same way REFACTOR_PROPOSAL.md and
SYNC_STATUS_FIX.md were passed. After the gate, the P-tickets in §5 are copied
into TODO.md and run one bullet per session as usual.

Scope guard: this is **cosmetics and consolidation only** — colors, spacing,
shared style primitives. Zero behavior changes, zero navigation changes. The
one interaction-level question that came up (a one-tap fast path on the item
screen) was considered and **rejected** — see DECISIONS.md 2026-07-29
("Deliberate friction"). It is out of scope here and stays out.

---

## 1. Design direction (agreed 2026-07-29)

**Style: field-ops utility, done well.** The fictional user is a manager in a
bright kitchen or a walk-in cooler — gloved, hurried, one-handed. The real
audience is an interviewer watching a 90-second demo. Both want the same
things: high contrast, big targets, color-as-status, no decorative chrome.

- **Light theme only.** Kitchens are bright; dark mode is deliberately out of
  scope for the POC (worth one line in the README's scoping notes — cut
  decisions read as senior).
- **Brand color is BLUE, not green.** Owner's call, and the reasoning is the
  interview answer: green is already the semantic color for "pass" and
  "synced." A green brand would hand out false positives at a glance — every
  branded button would read as "something succeeded." Blue is neutral,
  contrasts well, and leaves the semantic channel clean.
- **Semantic colors do the heavy lifting.** Pass/fail/na and synced/pending are
  the app's actual information. Green / red / gray, applied consistently.
  Today this is instinct, not system — see the gaps in §3.
- **System font, deliberate scale.** No custom fonts: authentic to the genre,
  zero Expo Go risk, one less thing to defend.
- **No gradients, no glassmorphism, no shadows-as-decoration.** Flat cards,
  hairline borders, one accent color. It's a tool.

---

## 2. The token file — `src/theme.ts`

Godot framing: today every node carries per-node style overrides; this creates
the project-wide Theme resource. Per-use overrides stay possible but become
the exception you can point at.

**Deliberately just a module of named constants.** No ThemeProvider, no
context, no hook, no styled-system — a screen imports `color.brand` the same
way it imports a function. That's the whole comprehension story: a token is a
value with a name, and `StyleSheet.create` keeps working untouched.

```ts
// src/theme.ts — single source of truth for visual constants.
export const color = {
  // brand
  brand: "#1565C0",     // primary actions, header accent, links
  // semantic — the app's real information channel
  success: "#2E7D32",   // pass results, synced badge
  danger: "#C0392B",    // fail results, error text
  neutral: "#616161",   // N/A selected fill
  // text
  ink: "#1A1A1A",       // primary text, stat values
  text: "#666666",      // secondary text (addresses, notes, dates)
  muted: "#999999",     // placeholders, pending badge, empty states
  label: "#888888",     // uppercase section/overline labels
  // surfaces
  card: "#FFFFFF",
  screen: "#F2F2F7",    // screen background — cards pop instead of floating on white
  subtle: "#FAFAFA",    // stat-tile fill
  border: "#DDDDDD",
  disabled: "#CCCCCC",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const radius = { card: 12, tile: 10 } as const;

export const font = {
  title: 20,      // item heading
  body: 15,       // labels, buttons, inputs
  secondary: 13,  // addresses, dates, overlines
  caption: 12,    // badges, tile labels (collapses today's 11/12 split)
  stat: 22,       // count-tile values (collapses today's 18/22 split)
} as const;
```

Notes on the values:

- Every hex above except `brand`, `neutral`, and `screen` already exists in
  the codebase — adoption is mostly a rename, not a redesign.
- `label` (#888) and `muted` (#999) are kept as two tokens even though they're
  close: collapsing them is a visible diff, and P1 is defined as zero-visual-
  change (see §5). If the owner wants them merged, that's a P2-class deliberate
  change, decided at the gate.
- **Contrast (checked):** white text passes WCAG AA (≥4.5:1) on all four fill
  colors — brand #1565C0 ≈ 5.8:1, success #2E7D32 ≈ 5.1:1, danger #C0392B
  ≈ 5.4:1, neutral #616161 ≈ 5.7:1. Another ready-made interview line.

---

## 3. Current state (inventory, 2026-07-29)

Nine files carry hardcoded hex (`app/index`, `_layout`, `audit/[locationId]`,
`audit/item/[itemId]`, `audit/review/[auditId]`, `history/index`,
`history/[auditId]`, `src/components/history/AuditCard`, `.../SyncBar`).
The census: `#c0392b` ×8, `#1a1a1a` ×6, `#fff`/`#ddd`/`#999`/`#666`/`#888`
scattered, `#2e7d32` ×1. The code-review standards already flag hardcoded hex
as [Warning]; AuditCard's own comment says the theme file is "still parked."
This proposal un-parks it.

**Semantic gaps found while auditing** (these are bugs against §1's system,
not taste):

- **Item screen segmented control** (`audit/item/[itemId].tsx`): selected
  *Fail* fills red, but selected *Pass* fills **black** — identical to
  selected *N/A*. Pass never gets its green; at a glance "pass selected" and
  "na selected" are indistinguishable.
- **Checklist status column** (`audit/[locationId].tsx`): `PASS` renders in
  the same gray (#999) as an unanswered `—`. A fully-passing checklist and an
  untouched one look the same until you read the glyphs. FAIL is red (correct).
- **Primary buttons are black** (#1a1a1a: Save, Review & Complete, Complete
  Audit, Sync now). Black is the text color, not an action color — the brand
  blue takes this role.
- **`_layout.tsx` History link** uses an inline style object (standards
  violation) with ink instead of a link color.

---

## 4. Explicit non-goals

- **No dark mode.** README scoping note instead.
- **No new dependencies.** Everything here is StyleSheet + existing packages.
- **No ThemeProvider/context/styled-components.** Constants module only.
- **No layout or flow changes.** Tier 2 rejected (DECISIONS 2026-07-29); the
  review screen's signature placeholder is a separate open TODO decision.
- **No custom fonts, no icon library.**
- **Reanimated motion stays parked post-7/31** — but §5/P6 specifies WHAT the
  two moments are, so the parked bullet has a spec when its time comes.

---

## 5. Tickets (one bullet per session, after the gate)

Sequencing: P1 first; P2–P4 are independent of each other after P1 and can
land in any order; P5 optional-but-cheap; P6 parked. **Every ticket leaves the
app tsc-clean and demo-able.** With README + demo recording still owed before
7/31, the high-value core is **P1 + P3 + P4** — P2 and P5 can slip past the
deadline without hurting the demo.

- **P1 — Tokens, zero visual diff.** Add `src/theme.ts` exactly as §2. Sweep
  all nine files: every hex literal, `borderRadius: 12/10`, and font size maps
  to its token. **The app must render pixel-identical** — this diff is pure
  mechanical substitution, so the owner can review it as "names replaced
  values" without re-judging any visual. (`screen`, `brand`, `neutral` are
  defined but unused until P2–P4.)
  AC: tsc clean; `grep -rn '"#' app src --include='*.tsx'` returns nothing
  outside `theme.ts`; device spot-check shows no visible change.
- **P2 — Screen chrome.** `_layout.tsx`: set `contentStyle` background to
  `color.screen` on all screens (cards now sit on the iOS grouped-gray
  instead of white-on-white); History header link becomes a proper
  StyleSheet style in `color.brand`; header titles get weight 600.
  AC: tsc clean; every screen shows gray background / white cards; link blue.
- **P3 — Actions go brand.** Extract `src/components/PrimaryButton.tsx`
  (named export; props: `label`, `onPress`, `disabled?` — the four call sites
  are style-identical today, so this is consolidation, not abstraction). Fill
  is `color.brand`, disabled stays `color.disabled`, pressed keeps the
  existing opacity idiom. Adopt at all four sites (item Save, checklist
  Review & Complete, review Complete Audit, SyncBar Sync now — the dev-only
  Reset button deliberately stays its dev-red self).
  AC: tsc clean; all primary actions blue; disabled Complete still reads
  disabled; SyncBar's syncing/disabled states unchanged in behavior.
- **P4 — Semantic results.** The §3 gap fixes, now trivial with tokens:
  segmented control selected fills become `success`/`danger`/`neutral` with
  white text (pass finally green, na visibly distinct); checklist status
  column colors PASS `success`, FAIL `danger`, NA `neutral`, `—` stays
  `muted`.
  AC: tsc clean; device pass — an audit with mixed results shows four
  distinguishable states in the checklist and the selected segment is
  color-coded on the item screen.
- **P5 — StatTile.** Extract the ~10-line Count block (AuditCard, review
  screen, history detail — the three copies DECISIONS 2026-07-17 explicitly
  deferred "to a separate cleanup"; this is that cleanup) into
  `src/components/StatTile.tsx` (named export; `label`, `value`, `tint?`).
  AC: tsc clean; the three screens render identically to pre-extraction.
- **P6 — Motion (PARKED post-7/31; spec only).** Two moments, both reanimated,
  both state-change feedback, nothing decorative: (1) the History sync badge
  animates its pending→synced flip (color/opacity transition on the
  `flushCount`-driven re-render) — this is the demo's money shot, the whole
  offline-first architecture made visible in one frame; (2) a subtle scale
  spring on segmented-control selection. Folds into the existing parked
  "Reanimated polish" bullet.

---

## 6. Interview gate — the owner should be able to answer

1. Why blue and not green for the brand? (Semantic channel stays clean —
   green already means pass/synced; a green button is a false positive.)
2. Why is `theme.ts` a plain module and not a ThemeProvider? (One theme, no
   runtime switching — a provider adds indirection with zero payoff; dark
   mode was cut on purpose, and if it ever arrives, the import site is the
   seam you'd swap.)
3. Why did P1 have to be pixel-identical? (So the review of a 9-file diff is
   "did the names match the values," not 9 screens of visual re-judgment —
   deliberate changes each get their own reviewable diff.)
4. Why is pass-green on the segmented control a bug fix and not a restyle?
   (The app's stated system is color-carries-status; black-for-pass broke the
   system, it didn't predate it.)
5. Why no dark mode? (Bright-kitchen users, POC scope; cutting it is a
   decision, not an omission — it's written down.)

## 7. Open questions for the gate

1. Approve `#1565C0` as the brand blue, or nominate another? (Constraint:
   ≥4.5:1 with white text; avoid anything teal enough to read green.)
2. `label` #888 vs `muted` #999 — keep both (zero-diff P1) or merge to one
   gray as a deliberate P2 change?
3. `color.screen` #F2F2F7 background — want it, or keep white-on-white?
4. P5 StatTile: worth a session, or leave the three copies until they next
   change for another reason?
