import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getAuditItems, completeAudit, type AuditItem } from "../../../src/db/audits";
import { auditCompleteSchema } from "../../../src/validation/audit";

export default function ReviewSign() {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const [items, setItems] = useState<AuditItem[]>([]);

  // Refetch on focus — same pattern as the checklist screen, so edits made before
  // arriving here (or on any re-focus) are reflected in the counts and failed list.
  useFocusEffect(
    useCallback(() => {
      getAuditItems(db, auditId).then(setItems);
    }, [db, auditId])
  );

  // Counts computed in-screen from the flat list (no new query — T6 owns the aggregate).
  const counts = {
    pass: items.filter((i) => i.result === "pass").length,
    fail: items.filter((i) => i.result === "fail").length,
    na: items.filter((i) => i.result === "na").length,
    unanswered: items.filter((i) => i.result == null).length,
  };

  const failedItems = items.filter((i) => i.result === "fail");

  // The completion gate: parse succeeds only when every item is answered (and any
  // temp-required item has a reading). Disables Complete until then.
  const gate = auditCompleteSchema.safeParse({
    items: items.map((i) => ({
      result: i.result,
      tempReading: i.tempReading,
      requiresTemp: !!i.requiresTemp,
    })),
  });
  const canComplete = gate.success;

  async function onComplete() {
    await completeAudit(db, auditId);
    router.replace("/"); // back to Locations; not left in the back stack (T6 → History)
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.countsRow}>
        <Count label="Pass" value={counts.pass} />
        <Count label="Fail" value={counts.fail} tint="#c0392b" />
        <Count label="N/A" value={counts.na} />
        <Count label="Open" value={counts.unanswered} />
      </View>

      <Text style={styles.sectionLabel}>Failed Items</Text>
      {failedItems.length === 0 ? (
        <Text style={styles.empty}>No failed items.</Text>
      ) : (
        failedItems.map((item) => (
          <View key={item.id} style={styles.failCard}>
            <Text style={styles.failLabel}>{item.label}</Text>
            {item.note ? <Text style={styles.failNote}>{item.note}</Text> : null}
          </View>
        ))
      )}

      <Text style={styles.sectionLabel}>Signature</Text>
      <View style={styles.signatureBox}>
        <Text style={styles.signaturePlaceholder}>Signature capture coming soon</Text>
      </View>

      {!canComplete && (
        <Text style={styles.hint}>
          {counts.unanswered} item{counts.unanswered === 1 ? "" : "s"} unanswered
        </Text>
      )}

      <Pressable
        style={[styles.completeBtn, !canComplete && styles.completeBtnDisabled]}
        onPress={onComplete}
        disabled={!canComplete}
      >
        <Text style={styles.completeText}>Complete Audit</Text>
      </Pressable>
    </ScrollView>
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
  container: { padding: 16 },
  countsRow: { flexDirection: "row", gap: 8, marginBottom: 24 },
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
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#888",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  empty: { fontSize: 15, color: "#999", marginBottom: 24 },
  failCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
    borderLeftWidth: 3,
    borderLeftColor: "#c0392b",
    padding: 14,
    marginBottom: 8,
  },
  failLabel: { fontSize: 15, fontWeight: "600" },
  failNote: { fontSize: 14, color: "#666", marginTop: 4 },
  signatureBox: {
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ccc",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    marginBottom: 24,
  },
  signaturePlaceholder: { fontSize: 14, color: "#999" },
  hint: { fontSize: 14, color: "#c0392b", marginBottom: 12, textAlign: "center" },
  completeBtn: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  completeBtnDisabled: { backgroundColor: "#ccc" },
  completeText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
