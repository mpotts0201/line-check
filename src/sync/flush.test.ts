import { createTestDb } from "../../test/betterSqliteAdapter";
import { migrate } from "../db";
import { type SqlDb } from "../db/types";
import { readSignatureBase64 } from "../files/signature";
import { flushSyncQueue, type SyncClient } from "./flush";

// flush.ts reads the signature PNG through src/files/signature (its only native-touching
// dependency); mocking THAT module keeps these tests native-free — the same seam pattern
// syncEngine.test.ts uses for flush/netinfo. The canned value is real base64 (the PNG
// magic bytes) because base64-arraybuffer's decode() runs for real in here.
jest.mock("../files/signature", () => ({
  __esModule: true,
  readSignatureBase64: jest.fn(async () => "iVBORw0KGgo="),
}));

// A scripted fake Supabase. Each table is a Map keyed on `id`, so upserting the same id twice
// leaves ONE row — that's what makes "no duplicates" a real assertion, not a hope. It records
// the order tables AND the storage upload were hit (for the ordering proofs) and can be told
// to throw the first N times a given table is upserted (for the crash-recovery proof), or to
// fail the storage upload (for the upload-blocks-rows proof).
function createFakeSupabase(opts?: {
  throwOn?: { table: string; times: number };
  failUpload?: boolean;
}) {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {};
  const callOrder: string[] = [];
  const uploads: { bucket: string; path: string; body: ArrayBuffer; options?: unknown }[] = [];
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
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, body: ArrayBuffer, options?: unknown) {
            callOrder.push("storage");
            if (opts?.failUpload) return { error: new Error("fake storage error") };
            uploads.push({ bucket, path, body, options });
            return { error: null };
          },
        };
      },
    },
  };

  return { client, tables, callOrder, uploads };
}

// Seed a completed audit + 2 items into the LOCAL tables and enqueue them, exactly as
// completeAudit would (payload = camelCase local row JSON). Literal ids keep the test pure
// (no expo-crypto). createdAt is monotonic so the audit row sorts before its items.
// signatureUri is overridable to null for the pre-signature-feature audit case.
async function seed(
  db: SqlDb,
  opts?: { signatureUri?: string | null }
): Promise<void> {
  const signatureUri =
    opts?.signatureUri !== undefined ? opts.signatureUri : "file:///doc/signature-aud-1.png";
  await migrate(db);
  await db.runAsync(
    `INSERT INTO audits (id, locationId, status, startedAt, completedAt, signatureUri, syncStatus)
     VALUES (?, ?, 'complete', ?, ?, ?, 'pending')`,
    "aud-1", "loc-1", "2026-07-20T10:00:00.000Z", "2026-07-20T10:05:00.000Z",
    signatureUri
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
    signatureUri, syncStatus: "pending",
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
  beforeEach(() => {
    (readSignatureBase64 as jest.Mock).mockClear();
  });

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
    expect(remoteAudit).toMatchObject({
      location_id: "loc-1",
      started_at: "2026-07-20T10:00:00.000Z",
      // The in-bucket object path the flush just uploaded to — NOT the local file:// URI,
      // which would be meaningless to any other device.
      signature_path: "aud-1.png",
    });
    expect(remoteAudit).not.toHaveProperty("locationId");
    expect(remoteAudit).not.toHaveProperty("syncStatus"); // local-only, dropped
    const remoteItem = fake.tables.audit_items.get("item-1")!;
    expect(remoteItem).toMatchObject({ audit_id: "aud-1", temp_reading: 38 });
    db.close();
  });

  it("uploads to storage, then audits (parents), then audit_items (children)", async () => {
    const db = createTestDb();
    await seed(db);
    const fake = createFakeSupabase();

    await flushSyncQueue(db, fake.client);

    // Storage first (a synced row must never reference a missing object), then FK order.
    expect(fake.callOrder).toEqual(["storage", "audits", "audit_items"]);
    db.close();
  });

  it("is a no-op on re-run once the queue is drained", async () => {
    const db = createTestDb();
    await seed(db);
    const fake = createFakeSupabase();

    await flushSyncQueue(db, fake.client);
    const second = await flushSyncQueue(db, fake.client);

    expect(second).toEqual({ status: "empty" });
    // No extra calls the 2nd time — not even the upload (empty queue returns before it).
    expect(fake.callOrder).toEqual(["storage", "audits", "audit_items"]);
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

  // ---- failure path: the queue stays intact, every run retries ----

  it("keeps the whole batch queued on failure", async () => {
    const db = createTestDb();
    await seed(db);
    const fake = createFakeSupabase({ throwOn: { table: "audits", times: 1 } });

    const result = await flushSyncQueue(db, fake.client);

    expect(result).toEqual({ status: "error", error: expect.anything() });
    expect(await queueCount(db)).toBe(3); // nothing deleted
    expect(await syncStatus(db)).toBe("pending"); // not flipped
    db.close();
  });

  it("retries on every run — there is no give-up", async () => {
    const db = createTestDb();
    await seed(db);
    const fake = createFakeSupabase({ throwOn: { table: "audits", times: 99 } }); // always fails

    // Four straight failures: each run still attempts the push (one upload + one audits
    // upsert per run — the fake throws before audit_items is reached) and the queue never
    // shrinks. The re-upload each run is the deterministic-path overwrite doing its job.
    // The old design skipped the batch as given-up on the 4th run; now recovery needs no
    // reset — the next successful poke drains everything.
    for (let run = 1; run <= 4; run++) {
      const result = await flushSyncQueue(db, fake.client);
      expect(result).toMatchObject({ status: "error" });
      expect(fake.callOrder.length).toBe(run * 2); // upload + upsert WERE attempted this run
    }
    expect(await queueCount(db)).toBe(3);
    db.close();
  });

  it("drains once the server recovers after earlier failures", async () => {
    const db = createTestDb();
    await seed(db);
    const fake = createFakeSupabase({ throwOn: { table: "audits", times: 2 } }); // fail twice

    await flushSyncQueue(db, fake.client); // fails — queue intact
    await flushSyncQueue(db, fake.client); // fails — queue intact
    const recovered = await flushSyncQueue(db, fake.client); // succeeds

    expect(recovered).toEqual({ status: "synced", audits: 1, items: 2 });
    expect(await queueCount(db)).toBe(0);
    expect(await syncStatus(db)).toBe("synced");
    db.close();
  });

  // ---- storage upload: the wire-in's own proofs ----

  it("uploads the signature PNG with the load-bearing options", async () => {
    const db = createTestDb();
    await seed(db);
    const fake = createFakeSupabase();

    await flushSyncQueue(db, fake.client);

    // The read happens from the LOCAL uri; the upload lands at the deterministic
    // in-bucket path. contentType is required by the bucket's MIME restriction;
    // upsert makes the queue-intact retry an overwrite instead of a conflict.
    expect(readSignatureBase64).toHaveBeenCalledWith("file:///doc/signature-aud-1.png");
    expect(fake.uploads).toEqual([
      {
        bucket: "signatures",
        path: "aud-1.png",
        body: expect.any(ArrayBuffer),
        options: { contentType: "image/png", upsert: true },
      },
    ]);
    db.close();
  });

  it("a failed upload blocks the row upserts and keeps the batch queued", async () => {
    const db = createTestDb();
    await seed(db);
    const fake = createFakeSupabase({ failUpload: true });

    const result = await flushSyncQueue(db, fake.client);

    expect(result).toMatchObject({ status: "error" });
    // The upload failing means NO table was ever touched — rows never race ahead of
    // their object — and the whole batch is intact for the next poke.
    expect(fake.callOrder).toEqual(["storage"]);
    expect(await queueCount(db)).toBe(3);
    expect(await syncStatus(db)).toBe("pending");
    db.close();
  });

  it("skips the upload for a pre-signature audit and syncs a null path", async () => {
    const db = createTestDb();
    await seed(db, { signatureUri: null });
    const fake = createFakeSupabase();

    const result = await flushSyncQueue(db, fake.client);

    expect(result).toEqual({ status: "synced", audits: 1, items: 2 });
    expect(readSignatureBase64).not.toHaveBeenCalled();
    expect(fake.callOrder).toEqual(["audits", "audit_items"]); // no storage call at all
    expect(fake.tables.audits.get("aud-1")!).toMatchObject({ signature_path: null });
    db.close();
  });
});
