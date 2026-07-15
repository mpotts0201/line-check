import * as Crypto from "expo-crypto";
import { type SQLiteDatabase } from "expo-sqlite";

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

// Finds today's draft audit for this location, or instantiates one from templates.
export async function getOrCreateTodaysAudit(
  db: SQLiteDatabase,
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
  db: SQLiteDatabase,
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
  db: SQLiteDatabase,
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