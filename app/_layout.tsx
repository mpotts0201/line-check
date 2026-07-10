import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { migrate } from "../src/db";
import { provision } from "../src/db/provision";

export default function RootLayout() {
  return (
    <SQLiteProvider
      databaseName="linecheck.db"
      onInit={async (db) => {
        await migrate(db);   // schema must exist before any screen queries
        provision(db);        // fire-and-forget: network never blocks launch
      }}
    >
      <Stack />
    </SQLiteProvider>
  );
}