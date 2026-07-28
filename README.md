# LineCheck

**A digital clipboard for restaurant food-safety line checks — built to work in the walk-in cooler, where there's no wifi.**

## The problem

Before opening each day, restaurant managers perform a "line check": a station-by-station food-safety walkthrough. Cooler temperatures, prep-line fridges, fryer oil, sanitizer levels — each item is checked, recorded, and signed off, because health inspectors and corporate audits require proof it happened.

Today this mostly happens on paper. Paper gets lost, can't hold photo evidence, and can't be reviewed remotely by a district manager. And the obvious fix — a mobile app — usually fails in the exact place the check happens: a walk-in cooler is a sealed metal box with no connectivity. Any tool that assumes a network connection dies mid-audit.

LineCheck is offline-first by design: every action works instantly with no connection, and the app syncs automatically when the device comes back online.

## How it works

The app mirrors the manager's actual morning walk:

1. **Locations** — Select the restaurant being audited. (Managers and district managers may cover several.)
2. **Audit checklist** — Today's line check, grouped by station (walk-in cooler, prep line, fryers). This is home base during the walk; each item shows its status at a glance.
3. **Item detail** — Standing at a station, the manager records the result: pass/fail, a temperature reading, an optional photo (e.g., a damaged door seal), and notes. Save, and back to the checklist for the next station.
4. **Review & sign** — At the end of the walk: a summary of results and a signature capture. Signing is the compliance moment — the manager's formal attestation that the check was completed.
5. **History** — Past audits with their sync status. An audit completed offline shows as *pending* until connectivity returns, then flips to *synced* — no user action required.

## Offline-first architecture (summary)

All writes go to a local SQLite database immediately — the app is fully functional in airplane mode. Completing an audit appends snapshot rows to a sync queue (the outbox pattern), which a small two-state engine (`idle | syncing`) flushes to the backend (Supabase) at three moments: when connectivity returns, when an audit is completed, and on a manual Sync now tap. The flush pushes audits first, then items, keyed on client-generated UUIDs so re-runs merge instead of duplicating. There is deliberately no retry counter or backoff: a failed push leaves the queue intact, and the next natural trigger simply tries again. Conflicts resolve last-write-wins on `updatedAt`. Sync state is always visible in the UI rather than hidden.

The demo in one toggle: enable airplane mode, complete an entire audit — checklist, photos, signature — then re-enable wifi and watch the pending badge flip to synced.

![alt text](./assets/images/app-flow.png)

![alt text](./assets/images/network-flow.png)

## Known limitations (deliberate)

**One poisoned row can block the whole sync batch.** The flush is all-or-nothing: every pending audit goes up in one batched upsert, then every item in a second. If the server permanently rejects a single row — a schema mismatch, a constraint violation — that request fails, and nothing syncs until the underlying bug is fixed (at which point the entire queue drains on the next trigger with no user action). This isn't hypothetical: an early schema-drift bug (`signature_uri` vs. the remote's `signature_path`) blocked every sync exactly this way, and finding it is why flush errors are now loudly surfaced instead of swallowed.

This weakness is accepted rather than fixed, twice over:

- An earlier design quarantined failing rows after three attempts so later audits could sync around them. It was removed on purpose: the counter never explained *why* something failed, quarantined rows required a manual reset even after the underlying bug was fixed, and poison sources are rare here — a single-writer backend plus client-side Zod validation ahead of every enqueue.
- The production-scale remedy is known and named: **fail-then-split bisection**. On a batch failure, split the batch in half and retry each half, recursively — isolating a bad row in about 2·log₂(n) requests while healthy rows still land. It needs only one bit per request ("did this batch fail"), so it works without parsing server error strings, and it distinguishes one bad row from a systemic outage for free. Doing it right also means: never bisect a *network* throw (only a server rejection), skip the split on batch-level error codes (bad column, RLS denial — splitting can't help), and mark an audit synced only when its own row *and* all its items have landed. That's out of scope for this POC — but it's the first thing I'd build at production scale.