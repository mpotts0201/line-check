import { Link, Stack } from "expo-router";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { useEffect } from "react";
import { StyleSheet, Text } from "react-native";
import { migrate } from "../src/db";
import { provision } from "../src/db/provision";
import { startSyncEngine } from "../src/sync/syncEngine";
import { color, font } from "../src/theme";

// Renders nothing. Exists so the sync engine starts when the app mounts and stops
// if it ever unmounts. Lives inside SQLiteProvider so it can grab the db handle.
function AutoSync() {
  const db = useSQLiteContext();

  useEffect(() => {
    // _ready(): start the engine. It hands back its own off switch.
    const stopSyncEngine = startSyncEngine(db);

    // Whatever a useEffect RETURNS, React stores and calls at teardown
    // (_exit_tree()): on unmount, or before re-running if `db` ever changed.
    return stopSyncEngine;
  }, [db]);

  return null;
}

export default function RootLayout() {
  return (
    <SQLiteProvider
      databaseName="linecheck.db"
      onInit={async (db) => {
        await migrate(db);   // schema must exist before any screen queries
        provision(db);        // fire-and-forget: network never blocks launch
      }}
    >
      <AutoSync />
      <Stack
        screenOptions={{
          contentStyle: styles.screen,
          headerTintColor: color.brand,
          headerTitleStyle: styles.headerTitle,
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: "Locations",
            headerRight: () => (
              <Link href="/history">
                <Text style={styles.headerLink}>History</Text>
              </Link>
            ),
          }}
        />
        <Stack.Screen name="history/index" options={{ title: "History" }} />
        <Stack.Screen name="history/[auditId]" options={{ title: "Audit Detail" }} />
        <Stack.Screen name="audit/[locationId]" options={{ title: "Line Check" }} />
        <Stack.Screen name="audit/item/[itemId]" options={{ title: "Check Item" }} />
        <Stack.Screen name="audit/review/[auditId]" options={{ title: "Review & Sign" }} />
      </Stack>
    </SQLiteProvider>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.screen },
  headerTitle: { fontWeight: "600" },
  headerLink: { fontSize: font.emphasis, color: color.brand, fontWeight: "600" },
});
