import { createTestDb } from "../../test/betterSqliteAdapter";
import { migrate } from "../db";
import { type SqlDb } from "../db/types";
import { flushSyncQueue, type SyncClient } from "./flush";

// A scripted fake Supabase. Each table is a Map keyed on `id`, so upserting the same id twice
// leaves ONE row — that's what makes "no duplicates" a real assertion, not a hope. It records
// the order tables were hit (for the FK-ordering proof) and can be told to throw the first N
// times a given table is upserted (for the crash-recovery proof).
function createFakeSupabase(opts?: { throwOn?: { table: string; times: number } }) {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {};
  const callOrder: string[] = [];
  let throwsLeft = opts?.throwOn?.times ?? 0;
  const throwTable = opts?.throwOn?.table;

  const client: SyncClient = {
    from(table: string) {
      return {
        async upsert(rows: Record<string, unknown>[]) {
          callOrder.push(table);
          if (table === throwTable && throwsLeft > 0) {
            throwsLeft--;
            throw new Error(`fake network error on ${table}`);
          }
          const store = (tables[table] ??= new Map());
          for (const row of rows) store.set(String(row.id), row); // upsert-by-id
          return { error: null };
        },
      };
    },
  };

  return { client, tables, callOrder };
}

// Seed a completed audit + 2 items into the LOCAL tables and enqueue them, exactly as
// completeAudit would (payload = camelCase local row JSON). Literal ids keep the test pure
// (no expo-crypto). createdAt is monotonic so the audit row sorts before its items.
async function seed(db: SqlDb): Promise<void> {
  await migrate(db);
  await db.runAsync(
    `INSERT INTO audits (id, locationId, status, startedAt, completedAt, signatureUri, syncStatus)
     VALUES (?, ?, 'complete', ?, ?, ?, 'pending')`,
    "aud-1", "loc-1", "2026-07-20T10:00:00.000Z", "2026-07-20T10:05:00.000Z", null
  );
  const items = [
    { id: "item-1", station: "Line", label: "Cold line temp", result: "pass", temp: 38, note: null },
    { id: "item-2", station: "Prep", label: "Sanitizer", result: "fail", temp: null, note: "low" },
  ];
  for (const it of items) {
    await db.runAsync(
      `INSERT INTO audit_items (id, auditId, templateId, station, label, result, tempReading, note, photoUri, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      it.id, "aud-1", `tpl-${it.id}`, it.station, it.label, it.result, it.temp, it.note, null,
      "2026-07-20T10:04:00.000Z"
    );
  }

  const auditPayload = {
    id: "aud-1", locationId: "loc-1", status: "complete",
    startedAt: "2026-07-20T10:00:00.000Z", completedAt: "2026-07-20T10:05:00.000Z",
    signatureUri: null, syncStatus: "pending",
  };
  await enqueue(db, "q-aud-1", "audits", "aud-1", auditPayload, "2026-07-20T10:05:00.001Z");
  await enqueue(db, "q-item-1", "audit_items", "item-1",
    { id: "item-1", auditId: "aud-1", templateId: "tpl-item-1", station: "Line", label: "Cold line temp",
      result: "pass", tempReading: 38, note: null, photoUri: null, updatedAt: "2026-07-20T10:04:00.000Z" },
    "2026-07-20T10:05:00.002Z");
  await enqueue(db, "q-item-2", "audit_items", "item-2",
    { id: "item-2", auditId: "aud-1", templateId: "tpl-item-2", station: "Prep", label: "Sanitizer",
      result: "fail", tempReading: null, note: "low", photoUri: null, updatedAt: "2026-07-20T10:04:00.000Z" },
    "2026-07-20T10:05:00.003Z");
}

async function enqueue(
  db: SqlDb, id: string, entity: string, entityId: string, payload: unknown, createdAt: string
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_queue (id, entity, entityId, operation, payload, createdAt, attempts)
     VALUES (?, ?, ?, 'upsert', ?, ?, 0)`,
    id, entity, entityId, JSON.stringify(payload), createdAt
  );
}

const queueCount = (db: SqlDb) =>
  db.getAllAsync<{ id: string }>("SELECT id FROM sync_queue").then((r) => r.length);
const syncStatus = (db: SqlDb) =>
  db.getFirstAsync<{ syncStatus: string }>("SELECT syncStatus FROM audits WHERE id = 'aud-1'")
    .then((r) => r?.syncStatus);

describe("flushSyncQueue", () => {
  it("pushes queued rows, then drains the queue and flips syncStatus", async () => {
    const db = createTestDb();
    await seed(db);
    const fake = createFakeSupabase();

    const result = await flushSyncQueue(db, fake.client);

    expect(result).toEqual({ status: "synced", audits: 1, items: 2 });
    expect(fake.tables.audits.size).toBe(1);
    expect(fake.tables.audit_items.size).toBe(2);
    expect(await queueCount(db)).toBe(0); // delete-on-confirm
    expect(await syncStatus(db)).toBe("synced");
    db.close();
  });

  it("maps camelCase local columns to snake_case remote columns", async () => {
    const db = createTestDb();
    await seed(db);
    const fake = createFakeSupabase();

    await flushSyncQueue(db, fake.client);

    const remoteAudit = fake.tables.audits.get("aud-1")!;
    expect(remoteAudit).toMatchObject({ location_id: "loc-1", started_at: "2026-07-20T10:00:00.000Z" });
    expect(remoteAudit).not.toHaveProperty("locationId");
    expect(remoteAudit).not.toHaveProperty("syncStatus"); // local-only, dropped
    const remoteItem = fake.tables.audit_items.get("item-1")!;
    expect(remoteItem).toMatchObject({ audit_id: "aud-1", temp_reading: 38 });
    db.close();
  });

  it("upserts audits (parents) before audit_items (children) — FK order", async () => {
    const db = createTestDb();
    await seed(db);
    const fake = createFakeSupabase();

    await flushSyncQueue(db, fake.client);

    expect(fake.callOrder).toEqual(["audits", "audit_items"]);
    db.close();
  });

  it("is a no-op on re-run once the queue is drained", async () => {
    const db = createTestDb();
    await seed(db);
    const fake = createFakeSupabase();

    await flushSyncQueue(db, fake.client);
    const second = await flushSyncQueue(db, fake.client);

    expect(second).toEqual({ status: "empty" });
    expect(fake.callOrder).toEqual(["audits", "audit_items"]); // no extra calls the 2nd time
    db.close();
  });

  it("recovers from a mid-flush crash with no duplicates", async () => {
    const db = createTestDb();
    await seed(db);
    // audits upsert succeeds, the first audit_items upsert throws (network dies mid-flush).
    const fake = createFakeSupabase({ throwOn: { table: "audit_items", times: 1 } });

    const first = await flushSyncQueue(db, fake.client);
    expect(first.status).toBe("error");
    expect(await queueCount(db)).toBe(3); // nothing drained
    expect(await syncStatus(db)).toBe("pending"); // not flipped
    expect(fake.tables.audits.size).toBe(1); // audits did land server-side

    const second = await flushSyncQueue(db, fake.client);
    expect(second).toEqual({ status: "synced", audits: 1, items: 2 });
    expect(fake.tables.audits.size).toBe(1); // re-upsert merged on id — NO duplicate
    expect(fake.tables.audit_items.size).toBe(2);
    expect(await queueCount(db)).toBe(0);
    expect(await syncStatus(db)).toBe("synced");
    db.close();
  });

  it("returns { status: 'empty' } when nothing is queued", async () => {
    const db = createTestDb();
    await migrate(db);
    const fake = createFakeSupabase();

    expect(await flushSyncQueue(db, fake.client)).toEqual({ status: "empty" });
    expect(fake.callOrder).toEqual([]);
    db.close();
  });
});
