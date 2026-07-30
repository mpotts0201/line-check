# TODO for humans — LineCheck in plain words

This is the plain-words twin of TODO.md. Same plan, no jargon, no walls of text.
TODO.md stays dense because it's written as instructions to Claude Code; this file is
for the human. The two are updated together, in the same commit.

**The deadline: applications go out July 31. That's a date, not a state — whatever is
done on the 31st is what ships.**

Everything finished before July 28 now lives in TODO_ARCHIVE.md. Reread it before
interviews — the schema-drift bug story, the badge that exposed a real hole, and
the sync Q&A weak spots are all in there.

---

## Where things stand (July 28)

The app works fully offline end to end, and sync works — but the plumbing that
decides WHEN to sync grew too clever to explain out loud, which breaks this
project's own rule ("I can explain any line if asked"). So we designed a
replacement (REFACTOR_PROPOSAL.md), argued it down until every line made sense,
and passed the explain-it-out-loud gate. Now we build it, one small step per
session.

## The rewrite, step by step

- **R1 — Build the new brain on the bench (done July 28).** One small file that decides when to
  sync. It's only ever doing one of two things — idle or syncing — and three
  events poke it: the phone getting signal back, submitting an audit, and the
  Sync now button. Written and tested, but not plugged in yet; the app doesn't
  change this session.
- **R2 — Swap it in (done July 28).** Unplugged the three old plumbing files,
  plugged in the new one. The sync trigger is now one file you can read top to
  bottom. Two calls made along the way: sync failures now always print an error
  in the console — before, some failed in total silence; pulled forward from R3
  so that hole never shipped — and the History screen's detailed sync-result
  text is gone. Its status line now just reads the waiting list ("Up to date"
  or "N waiting"), because the new engine deliberately doesn't report results.
- **R3 + R4 — Stop counting failures; simpler badges (done together, July 28).**
  The retry counter and the "give up after 3 tries" rule are gone. A failed sync
  just stays on the waiting list and gets tried again at the next natural
  moment. History cards now say either "Synced ✓" or "Not synced — N waiting" —
  no more "stuck" state, so no per-audit Retry button is needed; the regular
  Sync now button covers everything.
- **R5 — Write it down (done July 28).** The decision log, the project
  instructions, and the README now tell the new story. The README's honest
  known-weakness section is in: one bad row can block a whole sync batch until
  the underlying bug is fixed. Accepted on purpose, and the real fix has a name
  (split the failing batch in half and retry each half) — a weakness you found
  and can explain beats one you hid.

Each step leaves the app working and demo-able, so if the 31st lands mid-rewrite,
we ship anyway.

## Live badges (done July 29)

The History screen used to learn about background syncs only when you left and
came back. Now the sync engine rings a doorbell every time a sync attempt
finishes, and the screen re-reads its badges from the local database when it
hears the ring. Watch History with airplane mode on, turn it off, and "Not
synced" flips to "Synced ✓" by itself — no tap, no navigating away. First real
use of Zustand: the doorbell is a tiny shared store, and it carries only the
ring, never the data. (Plan and reasoning: SYNC_STATUS_FIX.md.)

## After that, before the 31st
- **Tidy up (done July 29).** Split the too-long History screen file.
- **README + demo video.** The write-up and a screen recording of the
  airplane-mode demo.

## New on July 29 — making it look good

- **The polish plan was reviewed and built (July 29).** You approved the blue,
  kept both grays, and took the gray screen background. What changed on
  device: every color and text size now comes from one shared theme file;
  screens have a soft gray background so the white cards stand out; all the
  main buttons (Save, Review & Complete, Complete Audit, Sync now) are one
  shared blue button component; and the two color bugs are fixed — a selected
  "Pass" now fills green instead of the same black as "N/A," and PASS/FAIL/NA
  on the checklist and past-audit screens read in green/red/gray instead of
  one flat gray. After you approved that on the phone, the stat-tile cleanup
  (P5) landed too: the little Pass/Fail/N/A count boxes that three screens
  each hand-rolled are now one shared component with one look — the History
  cards' counts got slightly bigger and match the other screens now. Waiting on:
  a diff review of the stat-tile change, then commit.
- **We decided the "cumbersome" item flow stays — on purpose.** Tapping into
  each item and pressing Save is three steps, and we're keeping all three: a
  manager walking a line with wet or gloved hands shouldn't be able to record
  a food-safety result with one stray touch. The friction is the safety.
  Written down in the decision log.
- **The signature box needs a call: build it or delete it.** DONE — built on
  July 30. Tap the box on the review screen, a full-screen pad opens, sign with
  a finger, Clear to retry, Done to capture. Completing the audit now requires
  a signature and saves it as a PNG on the phone; it rides the same sync path
  as everything else. The retest passed — the error was a quirk in the newer
  file-writing API under Expo Go; the older API fixed it. AND the cloud upload
  is now wired too: when the app syncs, the signature image goes up to a
  Supabase storage bucket first, then the audit rows point at it. The bucket is
  public-read on purpose for the demo (documented, with the guardrails: capped
  file size, PNG-only, unguessable names). Photos remain the future half of
  this pattern. Needs one device test: complete an audit in airplane mode,
  reconnect, then see the image appear in the Supabase dashboard.

## New on July 30 — the two animations (pulled forward)

- These were parked until after the 31st, but the badge animation is the best
  moment in the whole demo — the phone visibly going from "Not synced" to
  "Synced ✓" the instant signal comes back — so it got built before the demo
  video, not after. Two things move now, both tied to real state changes:
  the History sync badge sweeps gray→green when a background sync lands (no
  tap, no navigating away), and the Pass/Fail/N/A buttons give a small
  physical pop when you pick one. Nothing decorative; a screen that opens
  with old data doesn't animate anything. Two different animation techniques
  on purpose — one for "a value changed," one for "a tap happened" — and the
  reasoning is in the decision log.

## Chores (not blocking)
- Run eslint on Windows over the recent commits (it can't run on the Linux side).

## After the 31st (parked)
- Delete the now-unused failure-counter column from the database.
- Automatic test runs on GitHub, a proper dev build.
- Photo capture and upload (cut for the window).
