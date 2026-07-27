# TODO for humans — LineCheck in plain words

This is the plain-words twin of TODO.md. Same plan, no jargon, no walls of text.
TODO.md stays dense because it's written as instructions to Claude Code; this file is
for the human. The two are updated together, in the same commit.

**The deadline: applications go out July 31. That's a date, not a state — whatever is
done on the 31st is what ships.**

---

## Where things stand (July 22)

The app works fully offline, end to end: pick a location, run the checklist, save
temps and notes, sign off, see past audits. Everything saves to the phone's own
database instantly, so no wifi is ever needed to do the work.

The sync engine is built and tested. When you complete an audit, it goes on a
waiting list (the "outbox"). The app sends the waiting list to the server when it
can, deletes each entry only after the server confirms, retries failures with
growing delays, and gives up on an entry after 3 failed tries so it can't hammer
the server forever.

The History screen now tells the truth per audit: **Synced ✓** (server confirmed),
**Pending — N waiting** (still on the list, will retry by itself), or **Not synced**
(gave up; needs a manual retry, which is the next ticket).

---

## What's left before the 31st

### DONE this week
- ~~Per-audit sync status under the hood~~ (July 22)
- ~~Real status badge on each History card~~ (July 22)
- ~~Send right away when you submit an audit~~ (July 22) — submitting now pushes
  immediately if there's signal. No signal? It doesn't even try (so no retry
  chances get wasted in the walk-in cooler) — it just waits, and sends by itself
  the moment signal returns. No button pressing either way.

### Next up
- **Retry button for stuck audits.** After 3 failed tries the app stops retrying
  an audit on its own — and right now there's no way to kick it again. This adds
  a "Retry sync" button on just that audit's card (resets its counter, tries
  again), and removes the big global "Sync now" button, which this replaces.
- **Tidy up.** The History screen file got too long; split the sync header into
  its own file. Write the two big design decisions into DECISIONS.md (why sync
  status is looked up separately instead of one mega-query, and why retry is
  per-audit instead of global). Maybe: rewrite the sync-status lookup the simple
  flat way (three small queries plus a loop) instead of the current nested one.
- **README + demo video.** The write-up and a screen recording of the airplane-mode
  demo. Include the known weakness on purpose: one bad row can currently poison a
  whole sync batch — found it, understood it, wrote up the fix; better interview
  story shown than hidden.

### Chores (not blocking)
- Run eslint on Windows over the recent commits (it can't run on the Linux side).

### Cut / only if time miraculously appears
- Photo capture and upload (8a) — cut for the deadline window.
- Automatic test runs on GitHub, animations, a proper dev build (T9) — after the 31st.
