import { type SQLiteDatabase } from "expo-sqlite";

export type Location = { id: string; name: string; address: string };

export async function getLocations(db: SQLiteDatabase): Promise<Location[]> {
  return db.getAllAsync<Location>("SELECT * FROM locations ORDER BY name");
}

export async function getLocation(db: SQLiteDatabase, id: string) {
  return db.getFirstAsync<Location>("SELECT * FROM locations WHERE id = ?", id);
}