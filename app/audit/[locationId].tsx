import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { getAuditItems, getOrCreateTodaysAudit, type AuditItem } from "../../src/db/audits";
import { color, font, radius } from "../../src/theme";

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
            <Text style={[styles.status, item.result && STATUS_STYLE[item.result]]}>
              {item.result ? item.result.toUpperCase() : "—"}
            </Text>
          </Pressable>
        )}
      />
      <View style={styles.reviewWrap}>
        <PrimaryButton
          label="Review & Complete"
          // Disabled for the brief pre-load window where auditId is still null —
          // the old Pressable silently swallowed taps during it.
          disabled={!auditId}
          onPress={() => {
            if (auditId) router.push(`/audit/review/${auditId}`);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, paddingBottom: 96 },
  station: {
    fontSize: font.secondary, fontWeight: "700", color: color.label,
    textTransform: "uppercase", marginTop: 16, marginBottom: 6,
  },
  row: {
    backgroundColor: color.card, borderRadius: radius.card, padding: 16, marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: color.border,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  pressed: { opacity: 0.6 },
  label: { fontSize: font.body },
  status: { fontSize: font.secondary, fontWeight: "700", color: color.muted },
  statusPass: { color: color.success },
  statusFail: { color: color.danger },
  statusNa: { color: color.neutral },
  reviewWrap: { position: "absolute", bottom: 24, left: 16, right: 16 },
});

// Answered rows read in their semantic color; the unanswered "—" stays muted.
const STATUS_STYLE = {
  pass: styles.statusPass,
  fail: styles.statusFail,
  na: styles.statusNa,
} as const;
