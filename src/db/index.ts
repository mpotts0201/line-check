import { type SQLiteDatabase } from "expo-sqlite";

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checklist_templates (
      id TEXT PRIMARY KEY,
      station TEXT NOT NULL,
      label TEXT NOT NULL,
      requiresTemp INTEGER NOT NULL DEFAULT 0,
      sortOrder INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY,
      locationId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      startedAt TEXT NOT NULL,
      completedAt TEXT,
      signatureUri TEXT,
      syncStatus TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS audit_items (
      id TEXT PRIMARY KEY,
      auditId TEXT NOT NULL,
      templateId TEXT,
      station TEXT NOT NULL,
      label TEXT NOT NULL,
      result TEXT,
      tempReading REAL,
      note TEXT,
      photoUri TEXT,
      updatedAt TEXT NOT NULL
    );
  `);
}