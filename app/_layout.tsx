import NetInfo from "@react-native-community/netinfo";
import { Link, Stack } from "expo-router";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { useEffect } from "react";
import { Text } from "react-native";
import { migrate } from "../src/db";
import { provision } from "../src/db/provision";
import { supabase } from "../src/supabase";
import { createAutoSync } from "../src/sync/autoSync";
import { flushSyncQueue } from "../src/sync/flush";

// Renders nothing — it just wires the NetInfo auto-trigger (7d). Lives inside SQLiteProvider so
// it can read the db handle; injects the real `supabase` singleton so the worker stays
// singleton-free. The subscribe callback maps NetInfoState → a plain boolean (isConnected is
// boolean|null; only a definite, reachable connection counts as online).
function AutoSync() {
  const db = useSQLiteContext();
  useEffect(() => {
    const auto = createAutoSync({ flush: () => flushSyncQueue(db, supabase) });
    const unsubscribe = NetInfo.addEventListener((state) => {
      void auto.onConnectivityChange(
        state.isConnected === true && state.isInternetReachable !== false
      );
    });
    return unsubscribe;
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
      <Stack>
        <Stack.Screen
          name="index"
          options={{
            title: "Locations",
            headerRight: () => (
              <Link href="/history">
                <Text style={{ fontSize: 16, color: "#1a1a1a", fontWeight: "600" }}>
                  History
                </Text>
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