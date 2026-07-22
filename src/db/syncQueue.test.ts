import { createTestDb } from "../../test/betterSqliteAdapter";
import { migrate } from ".";
import { getCompletedAudits } from "./audits";
import { getAuditSyncStates } from "./syncQueue";
import { type SqlDb } from "./types";

// The worker's real give-up threshold is MAX_ATTEMPTS in src/sync/retry.ts, but src/db must
// not import from src/sync, so tests pass the same literal the production callers inject.
const THRESHOLD = 3;

// Seed a completed audit + 2 items, mirroring what completeAudit leaves behind. Queue rows
// are added per-test (each test wants a different queue shape). Literal ids keep the test
// pure (no expo-crypto).
async function seedAudit(
  db: SqlDb,
  auditId: string,
  opts?: { syncStatus?: "pending" | "synced" }
): Promise<void> {
  await db.runAsync(
    `INSERT INTO locations (id, name, address) VALUES (?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    "loc-1", "Main St", "1 Main St"
  );
  await db.runAsync(
    `INSERT INTO audits (id, locationId, status, startedAt, completedAt, signatureUri, syncStatus)
     VALUES (?, ?, 'complete', ?, ?, NULL, ?)`,
    auditId, "loc-1", "2026-07-20T10:00:00.000Z", "2026-07-20T10:05:00.000Z",
    opts?.syncStatus ?? "pending"
  );
  const items = [
    { id: `${auditId}-item-1`, result: "pass" },
    { id: `${auditId}-item-2`, result: "fail" },
  ];
  for (const it of items) {
    await db.runAsync(
      `INSERT INTO audit_items (id, auditId, templateId, station, label, result, tempReading, note, photoUri, updatedAt)
       VALUES (?, ?, NULL, 'Line', 'Check', ?, NULL, NULL, NULL, ?)`,
      it.id, auditId, it.result, "2026-07-20T10:04:00.000Z"
    );
  }
}

async function enqueueRow(
  db: SqlDb,
  id: string,
  entity: "audits" | "audit_items",
  entityId: string,
  attempts = 0
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_queue (id, entity, entityId, operation, payload, createdAt, attempts)
     VALUES (?, ?, ?, 'upsert', '{}', ?, ?)`,
    id, entity, entityId, "2026-07-20T10:05:00.001Z", attempts
  );
}

// Queue rows exactly as completeAudit enqueues them: one audit row + one per item.
async function enqueueAudit(db: SqlDb, auditId: string, attempts = 0): Promise<void> {
  await enqueueRow(db, `q-${auditId}`, "audits", auditId, attempts);
  await enqueueRow(db, `q-${auditId}-1`, "audit_items", `${auditId}-item-1`, attempts);
  await enqueueRow(db, `q-${auditId}-2`, "audit_items", `${auditId}-item-2`, attempts);
}

describe("getAuditSyncStates", () => {
  it("reports a freshly completed audit as pending, counting audit AND item rows", async () => {
    const db = createTestDb();
    await migrate(db);
    await seedAudit(db, "aud-1");
    await enqueueAudit(db, "aud-1");

    const states = await getAuditSyncStates(db, THRESHOLD);

    expect(states).toEqual([
      { auditId: "aud-1", pendingRows: 3, maxAttempts: 0, state: "pending" },
    ]);
    db.close();
  });

  it("reports a drained audit as synced", async () => {
    const db = createTestDb();
    await migrate(db);
    await seedAudit(db, "aud-1", { syncStatus: "synced" }); // queue drained, status flipped

    const states = await getAuditSyncStates(db, THRESHOLD);

    expect(states).toEqual([
      { auditId: "aud-1", pendingRows: 0, maxAttempts: 0, state: "synced" },
    ]);
    db.close();
  });

  it("reports an audit at the give-up threshold as stuck", async () => {
    const db = createTestDb();
    await migrate(db);
    await seedAudit(db, "aud-1");
    await enqueueAudit(db, "aud-1", THRESHOLD);

    const states = await getAuditSyncStates(db, THRESHOLD);

    expect(states).toEqual([
      { auditId: "aud-1", pendingRows: 3, maxAttempts: THRESHOLD, state: "stuck" },
    ]);
    db.close();
  });

  it("rolls item-only queue rows up to their audit via audit_items.auditId", async () => {
    const db = createTestDb();
    await migrate(db);
    await seedAudit(db, "aud-1");
    // The audit's own row already confirmed and deleted; only item rows remain. entityId
    // holds ITEM ids here — the audit is only reachable through the indirect join.
    await enqueueRow(db, "q-1", "audit_items", "aud-1-item-1");
    await enqueueRow(db, "q-2", "audit_items", "aud-1-item-2");

    const states = await getAuditSyncStates(db, THRESHOLD);

    expect(states).toEqual([
      { auditId: "aud-1", pendingRows: 2, maxAttempts: 0, state: "pending" },
    ]);
    db.close();
  });

  it("treats zero queue rows with syncStatus still 'pending' as pending, not synced", async () => {
    const db = createTestDb();
    await migrate(db);
    await seedAudit(db, "aud-1"); // no queue rows, but remote never confirmed

    const states = await getAuditSyncStates(db, THRESHOLD);

    expect(states[0].state).toBe("pending");
    db.close();
  });

  it("keeps audits with different queue shapes independent", async () => {
    const db = createTestDb();
    await migrate(db);
    await seedAudit(db, "aud-1", { syncStatus: "synced" });
    await seedAudit(db, "aud-2");
    await enqueueAudit(db, "aud-2", THRESHOLD);

    const states = await getAuditSyncStates(db, THRESHOLD);

    const byId = Object.fromEntries(states.map((s) => [s.auditId, s.state]));
    expect(byId).toEqual({ "aud-1": "synced", "aud-2": "stuck" });
    db.close();
  });

  it("leaves getCompletedAudits pass/fail/na counts unaffected (no join fanout)", async () => {
    const db = createTestDb();
    await migrate(db);
    await seedAudit(db, "aud-1"); // 1 pass, 1 fail
    await enqueueAudit(db, "aud-1"); // 3 queue rows that a join would fan the items out by

    const audits = await getCompletedAudits(db);

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ passCount: 1, failCount: 1, naCount: 0 });
    db.close();
  });
});
