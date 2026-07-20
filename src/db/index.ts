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

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,        -- 'audits' | 'audit_items' (the Supabase table name)
      entityId TEXT NOT NULL,      -- the row's id, for dedupe/debugging
      operation TEXT NOT NULL,     -- 'upsert' for now
      payload TEXT NOT NULL,       -- JSON snapshot of the row
      createdAt TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0   -- 7e backoff counter
    );
  `);
}