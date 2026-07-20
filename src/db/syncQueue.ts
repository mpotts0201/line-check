import * as Crypto from "expo-crypto";
import { type SQLiteDatabase } from "expo-sqlite";

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
export async function enqueue(db: SQLiteDatabase, row: EnqueueRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_queue (id, entity, entityId, operation, payload, createdAt, attempts)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    Crypto.randomUUID(), row.entity, row.entityId, row.operation,
    JSON.stringify(row.payload), new Date().toISOString()
  );
}
