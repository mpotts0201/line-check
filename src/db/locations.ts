import { type SqlDb } from "./types";

export type Location = { id: string; name: string; address: string };

export async function getLocations(db: SqlDb): Promise<Location[]> {
  return db.getAllAsync<Location>("SELECT * FROM locations ORDER BY name");
}

export async function getLocation(db: SqlDb, id: string) {
  return db.getFirstAsync<Location>("SELECT * FROM locations WHERE id = ?", id);
}