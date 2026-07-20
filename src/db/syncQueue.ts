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
// queue rows are all-or-nothing. id/createdAt are stamped here; attempts starts at 0
// (7e's backoff counter). payload is a plain row object we JSON-serialize; 7c reads
// it back with JSON.parse, so the queue is self-contained and never re-reads the
// main tables at flush time.
export async function enqueue(db: SqlDb, row: EnqueueRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_queue (id, entity, entityId, operation, payload, createdAt, attempts)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    Crypto.randomUUID(), row.entity, row.entityId, row.operation,
    JSON.stringify(row.payload), new Date().toISOString()
  );
}

// A queued mutation as stored. `payload` is the JSON string enqueue() wrote; the flush
// worker JSON.parses it back into the local row it snapshotted (T7c).
export type SyncQueueRow = {
  id: string;
  entity: SyncEntity;
  entityId: string;
  operation: SyncOperation;
  payload: string;
  createdAt: string;
  attempts: number;
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
