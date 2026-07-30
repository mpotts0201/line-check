# THEME_POLISH — LineCheck visual pass (Tier 1)

Status: **GATE PASSED 2026-07-29** (owner answered §7 same day — answers and
build log in §8). P1–P4 built 2026-07-29 in one owner-approved session; P5
built later that day; P6 pulled forward and built 2026-07-30 (plan in §9,
build log in §8).

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
- **P6 — Motion (was parked post-7/31; pulled forward and built 2026-07-30 —
  owner call, plan in §9, build log in §8).** Two moments, both reanimated,
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

## 8. Gate answers + build log (2026-07-29)

**Owner's §7 answers:** (1) `#1565C0` approved. (2) Keep both grays. (3) Yes —
gray background, explicitly for eye strain and contrast. (4) StatTile is worth
doing, but as its own reconvened session — P1–P4 built now, P5 next time.

**Deviations found and taken during the build** (each surfaced by the code
census, none changes the design's intent):

- **Tokens gained three entries** §2 didn't have: `font.emphasis: 16` (card
  titles, header link) and `font.note: 14` (notes, error/status lines) — both
  sizes existed in the code but not in the proposal's scale — and
  `color.onFill: #FFFFFF` for text on brand/semantic fills (same value as
  `card`, deliberately distinct meaning).
- **AuditCard's compact tile keeps literal 18/11 font sizes.** §2's note said
  `stat`/`caption` collapse them, but P1's zero-diff rule wins: the collapse
  happens when P5's StatTile unifies the three copies, not silently in the
  sweep.
- **P4 also covers the history detail screen.** Its result column had the
  identical gray-PASS bug as the checklist (same read-only rendering); fixing
  one without the other would leave the same record colored on one screen and
  gray on another.
- **P3's "four style-identical call sites" was three.** SyncBar's button was
  shorter (paddingVertical 12 vs 16), bolder (700 vs 600), and used #999 for
  its disabled fill instead of #ccc. Unifying on PrimaryButton makes it match
  the other three — a small deliberate visual change, accepted as the point
  of the primitive. Its accessibility label now tracks the visible label
  ("Syncing…" while in flight), which is more truthful than the old static
  "Sync now".
- **PrimaryButton adds pressed-opacity feedback** the three inline buttons
  never had (SyncBar's had it; the standards require it everywhere).
- **Spacing tokens shipped but mostly unadopted.** The real spacing values
  (2, 6, 10, 14, 20…) sit between the scale's stops; snapping them is a
  visible change, so P1 left every literal in place. `space` exists for new
  code and for a future deliberate normalization pass.
- **Header back-buttons tint brand blue** (`headerTintColor`) — P2 said
  "header accent"; this is that, made concrete.

**P5 build (2026-07-29, after owner approved P1–P4 on device):**

- `src/components/StatTile.tsx` (named export; `label`, `value`, `tint?`)
  replaces all three Count copies — the cleanup DECISIONS 2026-07-17 deferred.
- **Unified on the bordered white tile, no size variant.** The review and
  history-detail copies were identical (bordered, `font.stat`/`font.caption`);
  AuditCard's was a hand-rolled compact variant (subtle-gray fill, 10 radius,
  18/11 text). Rather than encode that fork as a `compact` prop, the History
  card adopts the standard tile — one component, one look, and the card's
  counts (its main content) get bigger, not smaller. Visible change: History
  cards grow ~14pt taller with bordered tiles.
- **Two tokens died with the compact tile and were removed**: `color.subtle`
  and `radius.tile` existed only for it. A token whose comment describes
  nothing in the app is drift waiting to happen; re-add them if a real use
  arrives.
- StatTile is new code, so it uses `space` tokens (`space.lg` padding,
  `space.xs` label gap) — first adoption beyond PrimaryButton.

**P6 build (2026-07-30, pulled forward — owner call, deadline-eve):**

Built per the §9 plan; idiom tradeoff logged in DECISIONS 2026-07-30. Three
deviations from §9's sketches, all found at build time:

- **The transition constant is typed `CSSStyle<TextStyle>`, not
  `CSSTransitionProperties`.** In a style-array position, reanimated's style
  type wants "a TextStyle that may also carry the transition keys" — which is
  exactly what `CSSStyle<TextStyle>` names. A bare `CSSTransitionProperties`
  fails to type-check inside the array.
- **`transitionDuration` is the string `"300ms"`, not the number `300`.**
  RN's own style types (New Architecture) also declare the transition keys,
  as strings; the intersection with reanimated's type makes the CSS string
  form the one that satisfies both.
- **SegmentButton gained `accessibilityRole`/`accessibilityLabel`/
  `accessibilityState({ selected })`** — not in §9's sketch, but the
  standards require them on touchables, and the extraction is the natural
  moment to close the gap (the old inline Pressables never had them).

Everything else landed as planned: color-only on the badge, press-driven
spring, `segmentPass/Fail/Na` + `SELECTED_STYLE` stay in the route. tsc
clean; jest untouched (no test imports components). AC pending: owner diff
review, Windows jest + eslint, and the §9 device pass.

## 9. P6 implementation plan (2026-07-30 — pulled forward from post-7/31)

Owner call: the badge flip is the demo's money shot, and the demo recording is
still owed — so the motion lands *before* the recording, not after the 31st.
First Reanimated use in the app. `react-native-reanimated ~4.1.1` +
`react-native-worklets 0.5.1` are already installed, and babel-preset-expo
auto-injects the worklets plugin (see DECISIONS.md babel entry) — zero config
work, zero new dependencies, no Metro restart needed. Expo Go SDK 54 runs the
New Architecture, which Reanimated 4 requires.

The trigger plumbing already exists: `flushCount` (Zustand) → `refresh()` in
`app/history/index.tsx` → new `syncState` prop on the mounted, keyed card. The
flip is a **prop change on a mounted component**, not a remount — exactly what
a transition can animate.

### The idiom decision — two idioms, on purpose

Godot framing: a Tween for a property that changes, a physics impulse for an
event that happens. Reanimated draws the same line, and each moment gets the
tool on its side of it:

- **Badge → Reanimated 4 CSS-transition API** (`transitionProperty: "color"`
  on `Animated.Text`). The badge color is *derived state* — it arrives from
  data, not a gesture. A transition declares "when this property changes,
  tween it"; the component keeps rendering exactly what it renders today.
  Decisive bonus: by web-CSS semantics a transition animates **changes only,
  never the initial value** — so "no animation on first mount / FlatList
  recycle" is solved by construction, with zero guard code. (Verified:
  `CSSTransitionProperties` is a public type export of the installed 4.1.1.)
- **Segment → `useSharedValue` + `useAnimatedStyle` + `withSpring`**. A spring
  is physics responding to an impulse (the tap); CSS timing functions can't
  express one. The classic idiom is the right tool here, and using both is
  the framework's own declarative/imperative split, not inconsistency.

Two more calls made at plan time:

- **Color-only on the badge, no opacity dip.** The label text swaps instantly
  ("Not synced — N waiting" → "Synced ✓"); an opacity dip can't crossfade two
  different strings in one `Text`, it would just add a flicker. The gray→green
  sweep *is* the moment. If it reads too subtle on device, adding `"opacity"`
  to `transitionProperty` is a one-word change — decided then, not pre-built.
- **Press-driven spring, not a `selected` effect.** The item screen seeds
  `result` from SQLite on reopen; an effect watching `selected` would pop the
  saved segment on screen open — a mount animation this spec's philosophy
  forbids. Selection can *only* change via press, so `if (!selected)` in the
  press handler is exactly "on becoming selected" — and it keeps a tap on the
  already-selected segment silent (state-change feedback only).

### File 1 — `src/components/history/AuditCard.tsx` (~6-line diff)

```tsx
import Animated, { type CSSTransitionProperties } from "react-native-reanimated";

// Module scope: one stable object across every card render (list-item prop
// rule). CSS-transition semantics animate CHANGES only — a card that mounts
// already-synced renders green statically; only the live pending→synced flip
// (flushCount → refresh → new color prop) tweens.
const syncColorTransition: CSSTransitionProperties = {
  transitionProperty: "color",
  transitionDuration: 300,
};
```

The badge line becomes:

```tsx
<Animated.Text style={[styles.sync, syncColorTransition, { color: badge.color }]}>
  {badge.label}
</Animated.Text>
```

Notes: the constant lives *outside* `StyleSheet.create` because RN's
`TextStyle` doesn't know the CSS keys — `CSSTransitionProperties` is the
reanimated-blessed way to keep it type-checked. The keys are silently dead on
a plain `Text`; `Animated.Text` is what makes them live. `syncBadge`,
`BADGE_COLOR`, and every style stay untouched.

### File 2 — `src/components/SegmentButton.tsx` (NEW, ~55 lines)

Flat in `src/components/` beside `PrimaryButton`/`StatTile` (named export).
The extraction is forced, not stylistic: each segment needs its own
`useSharedValue`, and hooks can't be called inside `RESULTS.map` in the route
body.

```tsx
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { color, font, radius } from "../theme";

// Subtle tap pop: settles in ~150ms with a hair of overshoot.
const POP = { damping: 14, stiffness: 300 } as const;

type SegmentButtonProps = {
  label: string;
  selected: boolean;
  selectedStyle: StyleProp<ViewStyle>; // caller supplies the semantic fill (pass/fail/na)
  onPress: () => void;
};

// One segment of the result control. Data in, one event out — the semantic
// color mapping stays the screen's knowledge; the pop is self-contained.
export function SegmentButton({ label, selected, selectedStyle, onPress }: SegmentButtonProps) {
  const scale = useSharedValue(1);
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  function handlePress() {
    if (!selected) {
      scale.value = 0.95;               // snap compressed…
      scale.value = withSpring(1, POP); // …spring back: feedback for the change
    }
    onPress();
  }

  return (
    <Animated.View style={[styles.wrap, pop]}>
      <Pressable onPress={handlePress} style={[styles.btn, selected && selectedStyle]}>
        <Text style={[styles.text, selected && styles.textSelected]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  btn: {
    paddingVertical: 14,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    backgroundColor: color.card,
    alignItems: "center",
  },
  text: { fontSize: font.body, fontWeight: "600", color: color.text },
  textSelected: { color: color.onFill },
});
```

Structure notes: the `Animated.View` wrapper carries `flex: 1` + the animated
transform; the inner `Pressable` keeps the visual styles moved verbatim from
the route. (`Animated.createAnimatedComponent(Pressable)` rejected — an extra
concept to explain for zero gain.) No cleanup needed: no subscriptions exist,
and Reanimated 4 detaches animations from unmounted components itself.

### File 3 — `app/audit/item/[itemId].tsx`

The `RESULTS.map` `Pressable` block becomes:

```tsx
{RESULTS.map((value) => (
  <SegmentButton
    key={value}
    label={RESULT_LABELS[value]}
    selected={result === value}
    selectedStyle={SELECTED_STYLE[value]}
    onPress={() => {
      setResult(value);
      setError(null);
    }}
  />
))}
```

Delete the now-unused `segmentBtn`/`segmentText`/`segmentTextSelected` styles
and the `Pressable` import. **Keep** `segmentPass`/`segmentFail`/`segmentNa`,
the `SELECTED_STYLE` lookup, and its comment in the route — the pass/fail/na
mapping is this screen's knowledge, not the button's. Zero behavior change:
same handler body, same styles applied.

### Docs, same commit

- **TODO.md**: the parked "Reanimated polish" bullet → `[x]` in place,
  reworded to what shipped (built as §5/P6; the originally sketched
  status-button-press / list-transitions were superseded by this spec).
- **TODO_PLAIN_ENGLISH.md**: dated bullet for the two animations; "animations"
  comes off the after-the-31st line.
- **DECISIONS.md**: short entry — two idioms on purpose; press-driven over
  effect-driven (db-seeded selection must never pop); first Reanimated use,
  no babel/jest work (cross-ref the babel entry).
- **This file**: §8-style build note appended when it lands; §5's P6 heading
  gets a "built 2026-07-30" marker.

### Jest / pitfall check (done at plan time)

No test file imports any component, directly or transitively — reanimated
never enters the jest module graph, so all suites should pass untouched.
(jest-expo ships reanimated's jest setup anyway, if that ever changes.)

### Verification

- Claude: `npx --no-install tsc --noEmit` clean; code-reviewer agent before
  commit.
- Human (Windows): `npx jest`, `npx eslint .`, then on device in Expo Go:
  1. **Money shot** — airplane mode → complete an audit → History shows gray
     "Not synced — N waiting" → reconnect → badge sweeps gray→green (~300ms)
     in place on the mounted card, no remount flicker; label swaps to
     "Synced ✓". Repeat via the manual Sync now path.
  2. **No mount animation** — cold-open History with synced audits: static
     green. Scroll a card out of the viewport and back: static on re-entry.
  3. **Segment pop** — tapping pops only the tapped segment; re-tapping the
     selected one does nothing; reopening a saved item shows its seeded
     selection with no pop.
  4. **Regression eyeball** — segment sizing/colors identical to before; no
     Reanimated warning banner at startup.

Sequencing: SegmentButton → route edit → AuditCard → tsc → docs. One small
commit.
