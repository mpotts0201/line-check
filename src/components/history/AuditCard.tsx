import { Pressable, StyleSheet, Text, View } from "react-native";
import { type AuditSummary } from "../../db/audits";
import { type AuditSyncStateRow } from "../../db/syncQueue";

// completedAt is an ISO string; show its date portion. Kept manual (no date lib, no
// reliance on Hermes Intl) so it renders identically on every device.
function formatDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

// Named here rather than inline so the two states can't drift apart; a shared theme
// constants file is still parked. Not-synced stays gray, not red — it isn't a dead
// state, it self-heals on the next poke.
const BADGE_COLOR = {
  synced: "#2e7d32",
  pending: "#999",
} as const;

// Badge text + tint for one audit's card. The lookup can miss only if an audit completed
// between the History screen's two queries; the fallback reads Not synced for the same
// reason a drained-queue-but-unconfirmed audit does — never claim a confirmation we
// don't have.
function syncBadge(state: AuditSyncStateRow | undefined): { label: string; color: string } {
  if (state?.state === "synced") return { label: "Synced ✓", color: BADGE_COLOR.synced };
  const waiting = state?.pendingRows ?? 0;
  return {
    label: waiting > 0 ? `Not synced — ${waiting} waiting` : "Not synced",
    color: BADGE_COLOR.pending,
  };
}

type AuditCardProps = {
  audit: AuditSummary;
  syncState: AuditSyncStateRow | undefined;
  onPress: (auditId: string) => void;
};

// One completed audit in the History list: location, date, pass/fail/na tiles, sync
// badge. Data in, one event out — no store or db access; the screen owns both queries.
export function AuditCard({ audit, syncState, onPress }: AuditCardProps) {
  const badge = syncBadge(syncState);
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => onPress(audit.id)}
      accessibilityRole="button"
      accessibilityLabel={`Audit at ${audit.locationName}, ${formatDate(audit.completedAt)}`}
    >
      <View style={styles.headerRow}>
        <Text style={styles.name}>{audit.locationName}</Text>
        <Text style={styles.date}>{formatDate(audit.completedAt)}</Text>
      </View>
      <View style={styles.countsRow}>
        <Count label="Pass" value={audit.passCount} />
        <Count label="Fail" value={audit.failCount} tint="#c0392b" />
        <Count label="N/A" value={audit.naCount} />
      </View>
      <Text style={[styles.sync, { color: badge.color }]}>{badge.label}</Text>
    </Pressable>
  );
}

// Private: exactly one consumer (the counts row above).
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
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
  },
  pressed: { opacity: 0.6 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  name: { fontSize: 16, fontWeight: "600" },
  date: { fontSize: 13, color: "#666" },
  countsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  count: {
    flex: 1,
    backgroundColor: "#fafafa",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  countValue: { fontSize: 18, fontWeight: "700", color: "#1a1a1a" },
  countLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#888",
    textTransform: "uppercase",
    marginTop: 2,
  },
  sync: { fontSize: 12, color: "#999", marginTop: 12, fontWeight: "600" },
});
