import { migrate } from "../src/db";
import { createTestDb } from "./betterSqliteAdapter";

// Proves the test harness itself: the in-memory better-sqlite3 adapter runs the REAL
// migrate() schema and honors transactions. If this passes, later tiers (sync engine,
// repositories) can trust the seam runs the same SQL the device does.
describe("better-sqlite3 test adapter", () => {
  it("runs migrate() and does real CRUD on an in-memory DB", async () => {
    const db = createTestDb();
    await migrate(db); // exercises every CREATE TABLE (incl. sync_queue) + the WAL pragma

    await db.runAsync(
      "INSERT INTO locations (id, name, address) VALUES (?, ?, ?)",
      "loc-1",
      "Main St Kitchen",
      "123 Main St"
    );

    const rows = await db.getAllAsync<{ id: string; name: string }>(
      "SELECT * FROM locations"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Main St Kitchen");

    const one = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM locations WHERE id = ?",
      "loc-1"
    );
    expect(one?.id).toBe("loc-1");

    db.close();
  });

  it("rolls back a transaction that throws", async () => {
    const db = createTestDb();
    await migrate(db);

    await expect(
      db.withTransactionAsync(async () => {
        await db.runAsync(
          "INSERT INTO locations (id, name, address) VALUES (?, ?, ?)",
          "x",
          "n",
          "a"
        );
        throw new Error("boom"); // mid-transaction failure
      })
    ).rejects.toThrow("boom");

    // The insert must not have committed — proves ROLLBACK works (the property the sync
    // engine's crash-recovery test leans on).
    const rows = await db.getAllAsync("SELECT * FROM locations");
    expect(rows).toHaveLength(0);

    db.close();
  });
});
