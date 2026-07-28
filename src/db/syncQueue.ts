import * as Crypto from "expo-crypto";
import { type SqlDb } from "./types";

// The entity is stored as the Supabase table name so the 7c flush worker can bucket
// by it and hit `.from(entity)` directly — no local→remote name mapping in between.
export type SyncEntity = "audits" | "audit_items";
export type SyncOperation = "upsert";

export type EnqueueRow = {
  entity: SyncEntity;
  entityId: string;
  operation: SyncOperation;
  payload: unknown; // serialized to JSON here
};

// Appends one row to sync_queue. Call INSIDE the caller's transaction so the queue
// write commits atomically with the mutation it records — a completed audit and its
// queue rows are all-or-nothing. id/createdAt are stamped here. attempts is written
// as 0 forever: retry counting was removed, and the dead column is kept to avoid a
// migration (drop parked post-7/31). payload is a plain row object we JSON-serialize;
// the worker reads it back with JSON.parse, so the queue is self-contained and never
// re-reads the main tables at flush time.
export async function enqueue(db: SqlDb, row: EnqueueRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_queue (id, entity, entityId, operation, payload, createdAt, attempts)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    Crypto.randomUUID(), row.entity, row.entityId, row.operation,
    JSON.stringify(row.payload), new Date().toISOString()
  );
}

// A queued mutation as stored. `payload` is the JSON string enqueue() wrote; the flush
// worker JSON.parses it back into the local row it snapshotted (T7c). The table also
// carries a dead `attempts` column nothing reads — deliberately absent here.
export type SyncQueueRow = {
  id: string;
  entity: SyncEntity;
  entityId: string;
  operation: SyncOperation;
  payload: string;
  createdAt: string;
};

// All pending queue rows, oldest first. FIFO by createdAt is for determinism; FK ordering
// (audits before audit_items) is enforced by the worker bucketing on `entity`, not this sort.
export async function getPendingSyncQueue(db: SqlDb): Promise<SyncQueueRow[]> {
  return db.getAllAsync<SyncQueueRow>(`SELECT * FROM sync_queue ORDER BY createdAt`);
}

// Deletes the flushed rows by id (delete-on-confirm — the worker calls this only after a
// confirmed remote upsert). Placeholders are generated from ids.length alone; the id values
// ride bound `?` params, never string-interpolated, so they can't inject.
export async function deleteSyncQueueRows(db: SqlDb, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  await db.runAsync(`DELETE FROM sync_queue WHERE id IN (${placeholders})`, ...ids);
}

// Per-audit sync state for the History screen (T8b). Derived HERE, in one place — screens
// render the label, they never re-derive it:
//   synced  — remote confirmed (syncStatus flipped) and nothing left in the queue
//   pending — everything else, INCLUDING zero queue rows while syncStatus is still
//             'pending': that means "we never heard back", not "it didn't land", and
//             showing it as synced would claim a confirmation we don't have
export type AuditSyncState = "synced" | "pending";

export type AuditSyncStateRow = {
  auditId: string;
  pendingRows: number;
  state: AuditSyncState;
};

// One row per completed audit (same population as getCompletedAudits, which this is merged
// with by auditId in the screen). Deliberately a SEPARATE query: getCompletedAudits already
// GROUP BYs a one-to-many join to build pass/fail/na counts, and joining sync_queue in would
// fan those rows out and corrupt the counts.
//
// The queue→audit join is indirect because sync_queue has no auditId column — entityId is
// the audit id for entity='audits' but the ITEM id for entity='audit_items', so item rows
// reach their audit via audit_items.auditId. The UNION ALL normalizes both cases to one
// auditId per queue row before the rollup.
export async function getAuditSyncStates(db: SqlDb): Promise<AuditSyncStateRow[]> {
  const rows = await db.getAllAsync<{
    auditId: string;
    pendingRows: number;
    syncStatus: string;
  }>(
    `SELECT audits.id AS auditId,
            COUNT(queued.auditId) AS pendingRows,
            audits.syncStatus AS syncStatus
     FROM audits
     LEFT JOIN (
       SELECT entityId AS auditId
         FROM sync_queue
        WHERE entity = 'audits'
       UNION ALL
       SELECT audit_items.auditId AS auditId
         FROM sync_queue
         JOIN audit_items ON audit_items.id = sync_queue.entityId
        WHERE sync_queue.entity = 'audit_items'
     ) queued ON queued.auditId = audits.id
     WHERE audits.status = 'complete'
     GROUP BY audits.id`
  );
  return rows.map(({ auditId, pendingRows, syncStatus }) => ({
    auditId,
    pendingRows,
    state: pendingRows === 0 && syncStatus === "synced" ? "synced" : "pending",
  }));
}

// Queue depth for the History status line — "Up to date" when zero, "N waiting" otherwise.
export async function getSyncQueueStats(db: SqlDb): Promise<{ total: number }> {
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM sync_queue`
  );
  return row ?? { total: 0 };
}
