import { Link, Stack } from "expo-router";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { migrate } from "../src/db";
import { provision } from "../src/db/provision";
import { startSyncEngine } from "../src/sync/syncEngine";
import { color, font, space } from "../src/theme";

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
              // asChild: a real Pressable cell (role, pressed feedback, hitSlop).
              // Its FRAME is clamped by react-native-screens on iOS 26 (glass
              // headers), so all sizing lives on the Text below — see headerLink.
              <Link href="/history" asChild>
                <Pressable
                  accessibilityRole="link"
                  // hitSlop reaches the 44pt tap-target bar without growing the
                  // cell's measured height inside the fixed-height header.
                  hitSlop={{ top: 12, bottom: 12 }}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={styles.headerLink}>History</Text>
                </Pressable>
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
  // Horizontal padding lives on the TEXT, not the wrapper: the iOS 26 glass
  // capsule sizes from the text node's own box (wrapper frames get clamped by
  // react-native-screens — verified on device 2026-07-30). This is what keeps
  // the word off the capsule's rounded sides.
  headerLink: {
    fontSize: font.emphasis,
    color: color.brand,
    fontWeight: "600",
    paddingHorizontal: space.lg,
  },
  pressed: { opacity: 0.6 },
});
