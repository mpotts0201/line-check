import { type SQLiteDatabase } from "expo-sqlite";

// The narrow slice of expo-sqlite's SQLiteDatabase that the repository + sync layers use.
// Pick keeps the signatures (overloads, generics) exactly in sync with expo-sqlite: a real
// SQLiteDatabase is assignable to SqlDb for free, and tests can back it with an in-memory
// better-sqlite3 adapter (real SQL, throwaway DB) — never the device, never Supabase.
export type SqlDb = Pick<
  SQLiteDatabase,
  "runAsync" | "getAllAsync" | "getFirstAsync" | "withTransactionAsync" | "execAsync"
>;
