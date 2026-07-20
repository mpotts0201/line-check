import Database from "better-sqlite3";
import {
  type SQLiteBindParams,
  type SQLiteBindValue,
  type SQLiteRunResult,
} from "expo-sqlite";
import { type SqlDb } from "../src/db/types";

// In-memory better-sqlite3 adapter implementing the SqlDb seam. It runs the SAME SQL the
// device runs — against a throwaway :memory: database — so the sync engine and repositories
// can be unit-tested without expo-sqlite or Supabase. better-sqlite3 is synchronous; we wrap
// each call in a Promise to match expo's async surface.

// expo's methods each have two overloads: (source, params: SQLiteBindParams) and
// (source, ...params: variadic values). Typing the params as this union lets one method
// implementation satisfy BOTH overloads (so it's assignable to the Pick) without `any`.
type Bind = (SQLiteBindValue | SQLiteBindParams)[];

// Normalize the two call shapes into better-sqlite3's bind arguments: a lone array arg
// (the SQLiteBindParams array form) is spread; variadic values / a single named-params
// object / a single value pass straight through.
const toArgs = (params: Bind): Bind =>
  params.length === 1 && Array.isArray(params[0]) ? params[0] : params;

export function createTestDb(): SqlDb & { close(): void } {
  const db = new Database(":memory:");
  return {
    async execAsync(source: string): Promise<void> {
      db.exec(source);
    },
    async runAsync(source: string, ...params: Bind): Promise<SQLiteRunResult> {
      const info = db.prepare(source).run(...toArgs(params));
      // better-sqlite3 uses `lastInsertRowid` (number | bigint); expo exposes
      // `lastInsertRowId` (number). Normalize the name and the type.
      return { lastInsertRowId: Number(info.lastInsertRowid), changes: info.changes };
    },
    async getFirstAsync<T>(source: string, ...params: Bind): Promise<T | null> {
      return (db.prepare(source).get(...toArgs(params)) ?? null) as T | null;
    },
    async getAllAsync<T>(source: string, ...params: Bind): Promise<T[]> {
      return db.prepare(source).all(...toArgs(params)) as T[];
    },
    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      // better-sqlite3's `.transaction()` wrapper requires a SYNC function, but our seam is
      // async — so drive BEGIN/COMMIT/ROLLBACK manually. This gives real transaction
      // semantics for the atomicity + crash-recovery assertions the sync engine relies on.
      db.exec("BEGIN");
      try {
        await task();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    close: () => db.close(),
  };
}
