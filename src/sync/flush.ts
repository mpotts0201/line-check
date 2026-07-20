import { type SqlDb } from "../db/types";
import {
  deleteSyncQueueRows,
  getPendingSyncQueue,
  incrementSyncQueueAttempts,
} from "../db/syncQueue";
import { markAuditsSynced } from "../db/audits";
import { MAX_ATTEMPTS } from "./retry";

// The narrow slice of the Supabase client the worker needs — its DI seam. Typed with
// PromiseLike so BOTH the real (thenable) Postgrest builder and a Promise-returning test fake
// satisfy it. The worker takes this as a param and never imports the `supabase` singleton, so
// tests inject a scripted fake and the composition root (the screen) injects the real client.
export interface SyncClient {
  from(table: string): {
    upsert(
      values: Record<string, unknown>[],
      options?: { onConflict?: string }
    ): PromiseLike<{ error: unknown }>;
  };
}

export type FlushResult =
  | { status: "empty" }
  | { status: "synced"; audits: number; items: number }
  | { status: "error"; error: unknown; attempts: number };

// camelCase local payload → snake_case remote row (the remote convention, matching the
// existing locations/checklist_templates tables). Also drops the local-only `syncStatus`;
// `photoUri` is deferred to 8a (Storage upload), so it is not sent here.
function toRemoteAudit(p: any): Record<string, unknown> {
  return {
    id: p.id,
    location_id: p.locationId,
    status: p.status,
    started_at: p.startedAt,
    completed_at: p.completedAt,
    signature_uri: p.signatureUri,
  };
}
function toRemoteItem(p: any): Record<string, unknown> {
  return {
    id: p.id,
    audit_id: p.auditId,
    template_id: p.templateId,
    station: p.station,
    label: p.label,
    result: p.result,
    temp_reading: p.tempReading,
    note: p.note,
    updated_at: p.updatedAt,
  };
}

// Drains sync_queue to Supabase. Reads all pending rows, upserts parents (audits) to
// completion BEFORE children (audit_items) so FKs resolve server-side, then — only on
// confirmed success — deletes the flushed queue rows and flips syncStatus, atomically.
// Any returned error or thrown network failure returns early with the queue untouched, so
// the whole batch is safe to retry (7e adds backoff). Upserts key on `id`, so a re-run after
// a mid-flush crash merges rather than duplicating.
export async function flushSyncQueue(db: SqlDb, client: SyncClient): Promise<FlushResult> {
  const pending = await getPendingSyncQueue(db);
  // Skip rows that have given up (attempts hit the threshold) — auto-sync stops retrying them
  // until 8b's per-audit manual retry resets attempts.
  const eligible = pending.filter((r) => r.attempts < MAX_ATTEMPTS);
  if (eligible.length === 0) return { status: "empty" };

  const auditRows = eligible.filter((r) => r.entity === "audits");
  const itemRows = eligible.filter((r) => r.entity === "audit_items");

  let failed: unknown | null = null;
  try {
    if (auditRows.length > 0) {
      const { error } = await client
        .from("audits")
        .upsert(auditRows.map((r) => toRemoteAudit(JSON.parse(r.payload))), {
          onConflict: "id",
        });
      if (error) failed = error;
    }
    if (failed === null && itemRows.length > 0) {
      const { error } = await client
        .from("audit_items")
        .upsert(itemRows.map((r) => toRemoteItem(JSON.parse(r.payload))), {
          onConflict: "id",
        });
      if (error) failed = error;
    }
  } catch (error) {
    // Network throw (or a fake that throws mid-flush): nothing has been drained yet.
    failed = error ?? new Error("flush failed");
  }

  if (failed !== null) {
    // Leave the whole batch queued (all-or-nothing) and bump attempts so the backoff clock
    // advances and stuck rows eventually give up. The freshest eligible row's new count drives
    // the retry cadence (for a single audit that's just its attempts).
    await incrementSyncQueueAttempts(db, eligible.map((r) => r.id));
    return {
      status: "error",
      error: failed,
      attempts: Math.min(...eligible.map((r) => r.attempts)) + 1,
    };
  }

  // Confirmed pushed → drain the flushed rows and flip syncStatus in one local transaction.
  await db.withTransactionAsync(async () => {
    await deleteSyncQueueRows(db, eligible.map((r) => r.id));
    await markAuditsSynced(db, auditRows.map((r) => r.entityId));
  });

  return { status: "synced", audits: auditRows.length, items: itemRows.length };
}
