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

## After that, before the 31st
- **Tidy up.** Split the too-long History screen file.
- **README + demo video.** The write-up and a screen recording of the
  airplane-mode demo.

## Chores (not blocking)
- Run eslint on Windows over the recent commits (it can't run on the Linux side).

## After the 31st (parked)
- Delete the now-unused failure-counter column from the database.
- Badges updating live instead of when you revisit the screen.
- Automatic test runs on GitHub, animations, a proper dev build.
- Photo capture and upload (cut for the window).
