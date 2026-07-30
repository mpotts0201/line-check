# Signature Capture — Implementation Proposal

**Status: PROPOSED (owner gate pending — no code until this is reviewed)**
Resolves the TODO ticket "Signature: implement or remove (raised 2026-07-29)" as **IMPLEMENT**.

## What and why

The review screen (`app/audit/review/[auditId].tsx`) has a dashed "Signature
capture coming soon" placeholder. The signature is the credibility beat of the
whole concept — a *signed* food-safety record — so it should be real before the
demo recording. The manager signs with a finger; the signature becomes part of
the completed audit and rides the existing sync path.

## Chosen tech: `react-native-signature-canvas`

A thin React Native wrapper around **signature_pad**, the battle-tested JS
canvas library, rendered inside a `react-native-webview`.

Why this over hand-rolling with gesture-handler + SVG: the payoff of the
package is mature stroke smoothing, multi-stroke handling, and a
clear/read API for free — a day of edge-case work we don't spend the week of
the demo deadline. The senior move here is recognizing that signature capture
is a solved problem and spending the saved day on the README and demo. (The
hand-rolled option stays listed under Alternatives in the DECISIONS entry.)

**Godot analogy:** the WebView is a `SubViewport` — a separate rendering world
with its own scene (an HTML canvas) that composites into ours. We can't reach
into it directly; we talk across the boundary with messages, like signals
across a viewport. The library hides that bridge behind ordinary props and
callbacks: we call `clearSignature()` / `readSignature()`, and results come
back through `onOK(base64DataUrl)`.

### What it hands us

On "Done" we call `readSignature()`; the pad fires `onOK` with a **base64 PNG
data URL** (`data:image/png;base64,...`) of the drawn strokes. That string is
the entire interface — everything downstream is just "what do we do with this
string."

## UX flow

1. **Empty state** — the existing dashed box becomes tappable: "Tap to sign".
2. **Tap → full-screen modal** — a big signing area with two controls:
   **Clear** (wipes the canvas, stay in modal) and **Done** (captures and
   closes). Plus a Cancel/close affordance that discards.
   Full-screen matters for two reasons: a real signing area for a finger, and
   it sidesteps the ScrollView conflict entirely — the review screen scrolls,
   and an inline pad would fight it (a downward stroke scrolls the page).
3. **Signed state** — back on review, the box shows the signature image
   (rendered from the base64 data URL via `expo-image`, already installed)
   with a **"Clear & re-sign"** control. Tapping the image reopens the modal
   fresh.
4. **Completion gate** — "Complete Audit" now requires all items answered
   **and** a signature. The unanswered-items hint gains a sibling: "Signature
   required."

Portrait only — no orientation forcing, no scope creep. signature_pad handles
whatever box it's given.

## Data flow and persistence

The signature lives in **screen state (the base64 string) until Complete is
tapped**. Nothing touches disk or SQLite for a signature the user might still
redo. One persistence point:

```
onComplete:
  1. write base64 → PNG file in the app document directory (expo-file-system)
  2. completeAudit(db, auditId, signatureFileUri)   ← new third parameter
  3. void syncNow(); navigate (unchanged)
```

### Why `completeAudit` grows a parameter (the load-bearing detail)

`completeAudit` snapshots the full `audits` row into `sync_queue` **inside its
transaction** (`src/db/audits.ts`). If we wrote `signatureUri` in a separate
UPDATE after completion, the queued payload would already be frozen with
`signatureUri: null` and the remote would never see it. Stamping it in the
same `UPDATE audits SET status = 'complete', completedAt = ?, signatureUri = ?`
means the snapshot naturally carries it. Same transaction, same idempotency
guard (`AND status = 'draft'`), no new moving parts.

### Tradeoff accepted: signature does not survive leaving the screen

Sign, navigate away without completing, come back → box is empty again.
This is deliberate: sign-then-complete is one ceremony (like signing a paper
form — you don't sign Tuesday and file Thursday), and it buys us zero orphan
files and zero draft-signature cleanup logic. Consistent with "draft edits
stay local / completion is the event that matters."

### File write

`expo-file-system` (needs install — not currently a dependency). The
known-good base64 path is the legacy API:
`writeAsStringAsync(uri, base64, { encoding: 'base64' })` via
`expo-file-system/legacy`. SDK 54's new `File` class API may support base64
writes directly — **verify at implementation time**; use whichever works in
Expo Go, prefer the new API if it does. Filename: `signature-<auditId>.png`
in the document directory (deterministic — a re-completed audit can't happen
per the idempotency guard, so no collision case).

## Sync impact: none

`src/sync/flush.ts` already maps `signatureUri → signature_path`. As its own
comment documents, the remote receives a local-device file path until real
upload exists — **identical to the photo situation**. Uploading the PNG to the
Supabase storage bucket stays deferred, same bucket of 8a-class work as photo
upload. One deferred decision covers both features.

## Validation gate change

Extend `auditCompleteSchema` (`src/validation/audit.ts`) rather than adding an
ad-hoc `&& signature` in the screen — the completion rule stays in one place:

```ts
export const auditCompleteSchema = z.object({
  items: z.array(completableItemSchema).min(1),
  signature: z.string().min(1),   // base64 data URL; absent/empty → not completable
});
```

The screen feeds it `{ items, signature: signatureDataUrl ?? "" }`. Existing
tests that build `{ items }` inputs will need the field added.

## Component breakdown

Two new components in **`src/components/review/`** — NOT under `app/`, where
Expo Router would turn each file into a route. Same pattern as the History
screen's `src/components/history/{AuditCard,SyncBar}.tsx` (screen-specific,
one component per file, named exports):

- **`src/components/review/SignatureBox.tsx`** — the tappable box. Props:
  `signature: string | null`, `onPressSign`, `onClear`. Renders the dashed
  "Tap to sign" empty state or the image + "Clear & re-sign". Two *visual
  states of content*, not two modes of behavior — the branching a list cell
  does when a field is null, not the multi-mode screen pattern we avoid.
- **`src/components/review/SignatureModal.tsx`** — RN `Modal` wrapping
  `SignatureScreen` from the library. Props: `visible`, `onDone(base64)`,
  `onCancel`. Owns nothing but the canvas; the captured string flows up via
  `onDone` and lives in the review screen's state.

Why an RN `Modal` component and not an expo-router modal route: a route would
need the signature string handed back across navigation (a Zustand store or
param plumbing) — hidden handoff for zero gain. A prop callback is the
plumbing you can read. The review screen stays the single owner of the
signature state, which is also what the completion gate needs.

Styling note: the pad's interior is styled via an injected CSS string (it's a
WebView — our StyleSheet doesn't reach inside the SubViewport). Keep it
minimal (white canvas, hide the library's built-in footer since we render our
own buttons) and put theme-matching chrome (buttons, header) outside the
WebView in RN.

## Temporary dev harness (this ticket only — never committed)

Testing the pad by filling out a full audit per iteration is too slow. During
implementation, the Locations screen gets a throwaway "Test signature" button
(a `ListHeaderComponent` on the existing FlatList) that opens `SignatureModal`
directly with plain local state — sign / clear / re-sign / done, no audit, no
DB. It exists to iterate on the WebView pad, the injected CSS, and modal feel
on device.

This is working-tree scaffolding, not a feature: it is **deleted in the final
step before the diff goes to owner review**, so it never appears in the commit
or reaches the code-reviewer. No `__DEV__` gate needed — a gate is for code
that ships; this code doesn't.

## Install steps (human, Windows Terminal)

```
npx expo install react-native-webview expo-file-system
npm install react-native-signature-canvas
```

Both Expo Go (SDK 54) compatible — webview and file-system are Expo-bundled
natives; signature-canvas is pure JS on top. **Restart Metro after installing.**

## Implementation order (each step leaves the app working)

1. Installs (human) + Metro restart. App unchanged.
2. `SignatureModal` + the temporary Locations-screen harness (above). Iterate
   on pad styling and modal feel on device with zero audit setup.
3. `SignatureBox` + wire both into the review screen with local state only.
   Sign/clear/re-sign works in the real flow; Complete still ignores the
   signature.
4. `completeAudit` third parameter + file write in `onComplete`. Signature
   lands in SQLite and in the queued payload. Update `completeAudit` tests.
5. Gate: `auditCompleteSchema` signature field + "Signature required" hint.
   Update schema tests.
6. **Delete the dev harness** (Locations screen back to untouched), then the
   device pass: airplane-mode sign-and-complete, History badge behavior
   unchanged, DECISIONS.md entry appended.

## Known gotchas

- **WebView touch vs. modal**: full-screen modal avoids the classic
  scroll-steals-the-stroke issue entirely; no `onBegin`/`onEnd` scroll-locking
  needed. If we ever inline the pad, that's the mechanism.
- **`onOK` fires only via `readSignature()`** — Done explicitly triggers the
  read; an empty canvas fires `onEmpty` instead, which we treat as "nothing to
  save" (keep the modal open or close with no change — decide on device feel).
- **Expo Go on a physical iPhone**: WebView inside Modal is a well-trodden
  path, but this project has already caught one iOS 26/Expo Go quirk
  (reduce-motion misreporting, DECISIONS 2026-07-30). Step 2 goes to device
  early precisely to surface any surprise before the data plumbing lands.

## Draft DECISIONS.md entry (appended at implementation, not now)

> **2026-07-30 — Signature capture: `react-native-signature-canvas` (WebView)
> over hand-rolled gesture capture.** The package brings signature_pad's
> mature smoothing and a clear/read API for two installs and ~zero custom
> gesture code; hand-rolling (gesture-handler + SVG + view-shot) was a
> day-plus of edge cases during demo week. Signature is captured in a
> full-screen modal (avoids ScrollView/stroke conflict), held in screen state,
> and persisted only at completion: PNG to the document directory, URI stamped
> into `audits.signatureUri` inside `completeAudit`'s transaction so the
> sync-queue snapshot carries it. Signature abandoned with the screen is
> discarded by design (sign-then-complete is one ceremony; no orphan files).
> Remote upload of the PNG stays deferred alongside photo upload.

## Open questions for owner gate

1. **Signature required to complete?** Proposal says yes (it's the point of
   the feature). Confirm — flipping to optional is a one-line schema change.
2. **Discard-on-leave acceptable?** (See tradeoff above.) Alternative —
   persisting draft signatures — adds file cleanup and a draft-signature
   column semantic for little demo value.
3. **Signer name/title field?** Deliberately out of scope (no auth, no
   identity model in the POC). Flagging so its absence is a decision, not an
   oversight.
