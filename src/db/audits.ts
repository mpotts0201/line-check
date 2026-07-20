import * as Crypto from "expo-crypto";
import { type SQLiteBindValue } from "expo-sqlite";
import { type SqlDb } from "./types";
import { enqueue } from "./syncQueue";

export type AuditItem = {
  id: string;
  auditId: string;
  station: string;
  label: string;
  result: "pass" | "fail" | "na" | null;
  tempReading: number | null;
  note: string | null;
  requiresTemp?: number;
};

// The only columns editable from the item-detail screen. Derived from AuditItem
// via Pick so the value types stay in sync with the row shape; Partial so a
// caller can update any subset. Identity/snapshot columns (id, auditId,
// templateId, station, label) and the joined requiresTemp are deliberately
// absent — passing one is a compile error, so the mutability boundary is
// enforced by the type, not a runtime check.
export type MutableAuditItemFields = Partial<
  Pick<AuditItem, "result" | "tempReading" | "note">
>;

// Finds today's draft audit for this location, or instantiates one from templates.
export async function getOrCreateTodaysAudit(
  db: SqlDb,
  locationId: string
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM audits
     WHERE locationId = ? AND status = 'draft' AND startedAt LIKE ?`,
    locationId, `${today}%`
  );
  if (existing) return existing.id;

  // Instantiate: one audits row + one item row per template (the snapshot)
  const auditId = Crypto.randomUUID();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO audits (id, locationId, status, startedAt) VALUES (?, ?, 'draft', ?)`,
      auditId, locationId, now
    );
    const templates = await db.getAllAsync<{
      id: string; station: string; label: string;
    }>(`SELECT * FROM checklist_templates ORDER BY sortOrder`);

    for (const t of templates) {
      await db.runAsync(
        `INSERT INTO audit_items (id, auditId, templateId, station, label, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        Crypto.randomUUID(), auditId, t.id, t.station, t.label, now
      );
    }
  });

  return auditId;
}

export async function getAuditItems(
  db: SqlDb,
  auditId: string
): Promise<AuditItem[]> {
  return db.getAllAsync<AuditItem>(
    `SELECT ai.*, ct.requiresTemp
     FROM audit_items ai
     LEFT JOIN checklist_templates ct ON ct.id = ai.templateId
     WHERE ai.auditId = ?`,
    auditId
  );
}

// Single-item read. Uses the SAME LEFT JOIN as getAuditItems so requiresTemp
// (which lives on checklist_templates, not audit_items) comes through — the
// item screen needs it to decide whether to show the temp field.
export async function getAuditItem(
  db: SqlDb,
  id: string
): Promise<AuditItem | null> {
  return db.getFirstAsync<AuditItem>(
    `SELECT ai.*, ct.requiresTemp
     FROM audit_items ai
     LEFT JOIN checklist_templates ct ON ct.id = ai.templateId
     WHERE ai.id = ?`,
    id
  );
}

// Patches the mutable columns of one item. `fields` is typed so identity and
// snapshot columns can't be passed (see MutableAuditItemFields). The SET clause
// is built only from the whitelisted `columns` literals below — never from
// caller-supplied keys — so column names can't be injected; values ride bound
// `?` params. updatedAt is stamped HERE, never accepted from callers: it is the
// last-write-wins clock the sync engine compares on, so the repository owns it.
export async function updateAuditItem(
  db: SqlDb,
  id: string,
  fields: MutableAuditItemFields
): Promise<void> {
  const columns = ["result", "tempReading", "note"] as const;

  const setParts: string[] = [];
  const values: SQLiteBindValue[] = [];
  for (const c of columns) {
    const v = fields[c];
    if (v === undefined) continue; // key absent → leave that column untouched
    setParts.push(`${c} = ?`);
    values.push(v); // narrowed: v is not undefined here, so it's a valid bind value
  }

  // Nothing to change → don't bump updatedAt. Touching the sync clock on a
  // no-op edit would falsely mark this row newer than the server's copy.
  if (setParts.length === 0) return;

  setParts.push("updatedAt = ?");
  values.push(new Date().toISOString());

  await db.runAsync(
    `UPDATE audit_items SET ${setParts.join(", ")} WHERE id = ?`,
    ...values,
    id
  );
}

// Marks a draft audit complete and enqueues it for sync — the UPDATE and the queue
// inserts commit together in one transaction (T7a). Stamps completedAt; leaves
// signatureUri (a placeholder in T5) untouched. Uses 'complete' (not 'completed') per
// the CLAUDE.md status model. LineCheck syncs a *finished* audit as a unit, so only
// completion enqueues — draft edits stay local (see DECISIONS.md).
//
// The status = 'draft' guard does double duty: a re-tap on an already-complete (or
// missing) audit changes 0 rows, so we enqueue nothing — the guard makes both the
// completion and the enqueue idempotent, with no duplicate queue rows.
export async function completeAudit(
  db: SqlDb,
  auditId: string
): Promise<void> {
  await db.withTransactionAsync(async () => {
    const res = await db.runAsync(
      `UPDATE audits SET status = 'complete', completedAt = ? WHERE id = ? AND status = 'draft'`,
      new Date().toISOString(), auditId
    );
    if (res.changes === 0) return; // not a fresh completion → nothing to enqueue

    // Snapshot the now-completed audit + every item into the queue. SELECT * captures
    // the full local row as the payload; mapping local→remote columns is 7c's job.
    const audit = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM audits WHERE id = ?`, auditId
    );
    await enqueue(db, { entity: "audits", entityId: auditId, operation: "upsert", payload: audit });

    const items = await db.getAllAsync<{ id: string }>(
      `SELECT * FROM audit_items WHERE auditId = ?`, auditId
    );
    for (const item of items) {
      await enqueue(db, { entity: "audit_items", entityId: item.id, operation: "upsert", payload: item });
    }
  });
}

export type Audit = {
  id: string;
  locationId: string;
  locationName: string;
  status: "draft" | "complete";
  startedAt: string;
  completedAt: string | null;
};

// Single audit + its location name, for the read-only detail screen (History → tap).
// Mirrors getCompletedAudits' `JOIN locations … AS locationName`, but one row via
// getFirstAsync like getAuditItem. No status filter — generic; the caller (detail
// screen) branches on `status`. Counts are NOT here: the screen derives them from
// getAuditItems in-screen, exactly as the review screen does (no second aggregate).
export async function getAudit(
  db: SqlDb,
  id: string
): Promise<Audit | null> {
  return db.getFirstAsync<Audit>(
    `SELECT a.id, a.locationId, a.status, a.startedAt, a.completedAt,
            l.name AS locationName
     FROM audits a
     JOIN locations l ON l.id = a.locationId
     WHERE a.id = ?`,
    id
  );
}

export type AuditSummary = {
  id: string;
  locationId: string;
  locationName: string;
  completedAt: string | null;
  passCount: number;
  failCount: number;
  naCount: number;
};

// Completed audits for the History screen, newest first. ONE aggregate query — location
// name via JOIN, per-audit counts via conditional COUNT(CASE ...), GROUP BY audit id.
// No N+1: the counts ride on the same row, never a follow-up query per audit. Unanswered
// is deliberately not counted — the T5 completion gate guarantees it is 0 here.
export async function getCompletedAudits(
  db: SqlDb
): Promise<AuditSummary[]> {
  return db.getAllAsync<AuditSummary>(
    `SELECT a.id, a.locationId, a.completedAt, l.name AS locationName,
            COUNT(CASE WHEN ai.result = 'pass' THEN 1 END) AS passCount,
            COUNT(CASE WHEN ai.result = 'fail' THEN 1 END) AS failCount,
            COUNT(CASE WHEN ai.result = 'na'   THEN 1 END) AS naCount
     FROM audits a
     JOIN locations l ON l.id = a.locationId
     LEFT JOIN audit_items ai ON ai.auditId = a.id
     WHERE a.status = 'complete'
     GROUP BY a.id
     ORDER BY a.completedAt DESC`
  );
}
