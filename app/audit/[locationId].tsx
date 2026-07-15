import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { getAuditItems, getOrCreateTodaysAudit, type AuditItem } from "../../src/db/audits";

export default function Checklist() {
  const { locationId } = useLocalSearchParams<{ locationId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const [auditId, setAuditId] = useState<string | null>(null);
  const [items, setItems] = useState<AuditItem[]>([]);

  // Re-runs when the screen regains focus — returning from item detail shows fresh statuses
  useFocusEffect(
    useCallback(() => {
      getOrCreateTodaysAudit(db, locationId).then(async (id) => {
        setAuditId(id);
        setItems(await getAuditItems(db, id));
      });
    }, [db, locationId])
  );

  // Group flat rows into SectionList shape: [{ title, data }]
  const sections = Object.entries(
    items.reduce<Record<string, AuditItem[]>>((acc, item) => {
      (acc[item.station] ??= []).push(item);
      return acc;
    }, {})
  ).map(([title, data]) => ({ title, data }));

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => (
          <Text style={styles.station}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => router.push(`/audit/item/${item.id}`)}
          >
            <Text style={styles.label}>{item.label}</Text>
            <Text style={[styles.status, item.result === "fail" && styles.fail]}>
              {item.result ? item.result.toUpperCase() : "—"}
            </Text>
          </Pressable>
        )}
      />
      <Pressable
        style={styles.reviewBtn}
        onPress={() => auditId && router.push(`/audit/review/${auditId}`)}
      >
        <Text style={styles.reviewText}>Review & Complete</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, paddingBottom: 96 },
  station: {
    fontSize: 13, fontWeight: "700", color: "#888",
    textTransform: "uppercase", marginTop: 16, marginBottom: 6,
  },
  row: {
    backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#ddd",
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  pressed: { opacity: 0.6 },
  label: { fontSize: 15 },
  status: { fontSize: 13, fontWeight: "700", color: "#999" },
  fail: { color: "#c0392b" },
  reviewBtn: {
    position: "absolute", bottom: 24, left: 16, right: 16,
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16, alignItems: "center",
  },
  reviewText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});