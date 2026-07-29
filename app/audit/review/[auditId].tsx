import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "../../../src/components/PrimaryButton";
import { StatTile } from "../../../src/components/StatTile";
import { getAuditItems, completeAudit, type AuditItem } from "../../../src/db/audits";
import { syncNow } from "../../../src/sync/syncEngine";
import { color, font, radius } from "../../../src/theme";
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
    // Poke the sync engine: push now if it makes sense. It quietly does nothing offline —
    // the audit is already durable in SQLite and the reconnect trigger covers it later.
    // Deliberately not awaited: navigation must never wait on the network.
    void syncNow();
    // To History — with the audit flow flattened out of the back stack. replace()
    // alone swapped only THIS screen, leaving Line Check underneath, so back from
    // History reopened the completed audit's checklist. dismissAll pops to the
    // stack root (Locations), then the push makes back from History → Locations.
    router.dismissAll();
    router.push("/history");
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.countsRow}>
        <StatTile label="Pass" value={counts.pass} />
        <StatTile label="Fail" value={counts.fail} tint={color.danger} />
        <StatTile label="N/A" value={counts.na} />
        <StatTile label="Open" value={counts.unanswered} />
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

      <PrimaryButton label="Complete Audit" onPress={onComplete} disabled={!canComplete} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  countsRow: { flexDirection: "row", gap: 8, marginBottom: 24 },
  sectionLabel: {
    fontSize: font.secondary,
    fontWeight: "700",
    color: color.label,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  empty: { fontSize: font.body, color: color.muted, marginBottom: 24 },
  failCard: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    borderLeftWidth: 3,
    borderLeftColor: color.danger,
    padding: 14,
    marginBottom: 8,
  },
  failLabel: { fontSize: font.body, fontWeight: "600" },
  failNote: { fontSize: font.note, color: color.text, marginTop: 4 },
  signatureBox: {
    height: 120,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.disabled,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    marginBottom: 24,
  },
  signaturePlaceholder: { fontSize: font.note, color: color.muted },
  hint: { fontSize: font.note, color: color.danger, marginBottom: 12, textAlign: "center" },
});
