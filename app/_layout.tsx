import { Link, Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { Text } from "react-native";
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