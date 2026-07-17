import { useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useState } from "react";
import { SectionList, StyleSheet, Text, View } from "react-native";
import {
  getAudit,
  getAuditItems,
  type Audit,
  type AuditItem,
} from "../../src/db/audits";

// completedAt is an ISO string; show its date portion. Manual slice (no date lib, no
// Hermes Intl reliance) — same rationale as the History list's formatter.
function formatDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

export default function AuditDetail() {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const db = useSQLiteContext();
  const [audit, setAudit] = useState<Audit | null>(null);
  const [items, setItems] = useState<AuditItem[]>([]);

  // Load once on mount — a completed audit is an immutable record, so there is nothing
  // to refetch on focus (unlike the draft screens, which mutate and use useFocusEffect).
  useEffect(() => {
    getAudit(db, auditId).then(setAudit);
    getAuditItems(db, auditId).then(setItems);
  }, [db, auditId]);

  // Counts derived in-screen from the flat list (pass/fail/na). A completed audit has no
  // unanswered items, so these three cover every item and match the History row's aggregate.
  const counts = {
    pass: items.filter((i) => i.result === "pass").length,
    fail: items.filter((i) => i.result === "fail").length,
    na: items.filter((i) => i.result === "na").length,
  };

  // Group flat rows into SectionList shape: [{ title, data }] — same grouping the checklist uses.
  const sections = Object.entries(
    items.reduce<Record<string, AuditItem[]>>((acc, item) => {
      (acc[item.station] ??= []).push(item);
      return acc;
    }, {})
  ).map(([title, data]) => ({ title, data }));

  if (!audit) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loading}>Loading…</Text>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.location}>{audit.locationName}</Text>
          <Text style={styles.completed}>Completed {formatDate(audit.completedAt)}</Text>
          <View style={styles.countsRow}>
            <Count label="Pass" value={counts.pass} />
            <Count label="Fail" value={counts.fail} tint="#c0392b" />
            <Count label="N/A" value={counts.na} />
          </View>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text style={styles.station}>{section.title}</Text>
      )}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={styles.rowHeader}>
            <Text style={styles.label}>{item.label}</Text>
            <Text style={[styles.result, item.result === "fail" && styles.fail]}>
              {item.result ? item.result.toUpperCase() : "—"}
            </Text>
          </View>
          {item.tempReading != null ? (
            <Text style={styles.meta}>Temp: {item.tempReading}°F</Text>
          ) : null}
          {item.note ? <Text style={styles.meta}>{item.note}</Text> : null}
        </View>
      )}
    />
  );
}

function Count({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint?: string;
}) {
  return (
    <View style={styles.count}>
      <Text style={[styles.countValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, padding: 16 },
  loading: { fontSize: 15, color: "#999" },
  list: { padding: 16, paddingBottom: 32 },
  header: { marginBottom: 8 },
  location: { fontSize: 20, fontWeight: "700" },
  completed: { fontSize: 13, color: "#666", marginTop: 2 },
  countsRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  count: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
    paddingVertical: 16,
    alignItems: "center",
  },
  countValue: { fontSize: 22, fontWeight: "700", color: "#1a1a1a" },
  countLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#888",
    textTransform: "uppercase",
    marginTop: 4,
  },
  station: {
    fontSize: 13,
    fontWeight: "700",
    color: "#888",
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 6,
  },
  row: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: { fontSize: 15, flexShrink: 1, paddingRight: 8 },
  result: { fontSize: 13, fontWeight: "700", color: "#999" },
  fail: { color: "#c0392b" },
  meta: { fontSize: 14, color: "#666", marginTop: 6 },
});
