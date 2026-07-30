import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useState } from "react";
import { SectionList, StyleSheet, Text, View } from "react-native";
import { StatTile } from "../../src/components/StatTile";
import {
  getAudit,
  getAuditItems,
  type Audit,
  type AuditItem,
} from "../../src/db/audits";
import { color, font, radius } from "../../src/theme";

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
            <StatTile label="Pass" value={counts.pass} />
            <StatTile label="Fail" value={counts.fail} tint={color.danger} />
            <StatTile label="N/A" value={counts.na} />
          </View>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text style={styles.station}>{section.title}</Text>
      )}
      // Paper-form semantics: the signature sits at the bottom, attesting everything
      // above it. Rendered from the LOCAL file (never the bucket) — the read path is
      // SQLite + local files, so this works offline like everything else, and the
      // transparent PNG reads correctly on the card's white background. Audits that
      // predate signature capture have no signatureUri and omit the section entirely.
      ListFooterComponent={
        audit.signatureUri ? (
          <View>
            <Text style={styles.station}>Signature</Text>
            <View style={styles.signatureCard}>
              <Image
                source={{ uri: audit.signatureUri }}
                style={styles.signatureImage}
                contentFit="contain"
                accessible
                accessibilityLabel="Manager signature"
              />
            </View>
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={styles.rowHeader}>
            <Text style={styles.label}>{item.label}</Text>
            <Text style={[styles.result, item.result && STATUS_STYLE[item.result]]}>
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

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, padding: 16 },
  loading: { fontSize: font.body, color: color.muted },
  list: { padding: 16, paddingBottom: 32 },
  header: { marginBottom: 8 },
  location: { fontSize: font.title, fontWeight: "700" },
  completed: { fontSize: font.secondary, color: color.text, marginTop: 2 },
  countsRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  station: {
    fontSize: font.secondary,
    fontWeight: "700",
    color: color.label,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 6,
  },
  row: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: { fontSize: font.body, flexShrink: 1, paddingRight: 8 },
  result: { fontSize: font.secondary, fontWeight: "700", color: color.muted },
  resultPass: { color: color.success },
  resultFail: { color: color.danger },
  resultNa: { color: color.neutral },
  meta: { fontSize: font.note, color: color.text, marginTop: 6 },
  signatureCard: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    overflow: "hidden",
  },
  // Same height as the review screen's SignatureBox, so the record echoes the capture.
  signatureImage: { height: 120 },
});

// Same semantic coloring as the checklist's status column — a completed audit's
// PASS/FAIL/NA read in their result colors, not one undifferentiated gray.
const STATUS_STYLE = {
  pass: styles.resultPass,
  fail: styles.resultFail,
  na: styles.resultNa,
} as const;
