import { type SqlDb } from "./types";

// DEV/DEMO ONLY — clears the audit side of the local database while leaving the provisioned
// reference data (locations, checklist_templates) intact.
//
// Keeping the seed tables is the point: a reset works fully OFFLINE. Dropping them would make
// the app unusable until the next successful `provision()` round-trip, which is exactly the
// wrong failure mode for an app whose premise is "works in a walk-in cooler with no wifi".
//
// sync_queue is cleared too, and must be: its rows are JSON snapshots of the audits being
// deleted, so leaving them would push rows for audits that no longer exist locally — the
// queue would resurrect data the reset was meant to remove.
//
// One transaction, so a reset is all-or-nothing and can't strand queue rows whose audits are
// already gone. Children before parents is intent, not necessity — the local schema declares
// no foreign keys (src/db/index.ts), so SQLite accepts either order; the ordering documents
// the relationship and stays correct if constraints are added later.
//
// Local only. Rows that already reached Supabase survive, and because completing an audit
// mints a fresh UUID, a post-reset audit will not overwrite them.
export async function resetAuditData(db: SqlDb): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM sync_queue`);
    await db.runAsync(`DELETE FROM audit_items`);
    await db.runAsync(`DELETE FROM audits`);
  });
}
