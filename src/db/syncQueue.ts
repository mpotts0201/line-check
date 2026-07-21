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

// Bumps attempts for the given rows after a failed flush (T7e). attempts is the backoff clock
// AND the give-up counter: the worker excludes rows at the give-up threshold from future
// flushes. Rows are never deleted on failure — only their attempts climb.
export async function incrementSyncQueueAttempts(db: SqlDb, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  await db.runAsync(
    `UPDATE sync_queue SET attempts = attempts + 1 WHERE id IN (${placeholders})`,
    ...ids
  );
}

// Queue depth, so the UI can distinguish "nothing queued" from "rows queued but all given
// up" — the worker collapses both into `status: 'empty'`, and reporting the second as "Up to
// date" would misrepresent whether the user's work is durable.
//
// The give-up threshold is a PARAMETER, not an import: `src/db` must not depend on
// `src/sync` (sync depends on db, and importing MAX_ATTEMPTS here would close a
// syncQueue → retry → flush → syncQueue loop). The caller passes the same constant the
// worker filters on, so the count still can't drift.
export async function getSyncQueueStats(
  db: SqlDb,
  maxAttempts: number
): Promise<{ total: number; givenUp: number }> {
  const row = await db.getFirstAsync<{ total: number; givenUp: number }>(
    `SELECT COUNT(*) AS total,
            COUNT(CASE WHEN attempts >= ? THEN 1 END) AS givenUp
     FROM sync_queue`,
    maxAttempts
  );
  return row ?? { total: 0, givenUp: 0 };
}
