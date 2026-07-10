import { type SQLiteDatabase } from "expo-sqlite";
import { supabase } from "../supabase";

export async function provision(db: SQLiteDatabase): Promise<boolean> {
  try {
    const [loc, tpl] = await Promise.all([
      supabase.from("locations").select("*"),
      supabase.from("checklist_templates").select("*").order("sort_order"),
    ]);
    if (loc.error || tpl.error || !loc.data || !tpl.data) return false;

    await db.withTransactionAsync(async () => {
      for (const l of loc.data) {
        await db.runAsync(
          `INSERT INTO locations (id, name, address) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, address = excluded.address`,
          l.id, l.name, l.address
        );
      }
      for (const t of tpl.data) {
        await db.runAsync(
          `INSERT INTO checklist_templates (id, station, label, requiresTemp, sortOrder)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET station = excluded.station,
             label = excluded.label, requiresTemp = excluded.requiresTemp,
             sortOrder = excluded.sortOrder`,
          t.id, t.station, t.label, t.requires_temp ? 1 : 0, t.sort_order
        );
      }
    });
    return true;
  } catch {
    return false; // offline or server unreachable — app proceeds on local data
  }
}