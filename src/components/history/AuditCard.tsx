import { Pressable, StyleSheet, Text, View, type TextStyle } from "react-native";
import Animated, { type CSSStyle } from "react-native-reanimated";
import { type AuditSummary } from "../../db/audits";
import { type AuditSyncStateRow } from "../../db/syncQueue";
import { color, font, radius } from "../../theme";
import { StatTile } from "../StatTile";

// completedAt is an ISO string; show its date portion. Kept manual (no date lib, no
// reliance on Hermes Intl) so it renders identically on every device.
function formatDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

// Named here rather than inline so the two states can't drift apart. Not-synced
// stays gray, not red — it isn't a dead state, it self-heals on the next poke.
const BADGE_COLOR = {
  synced: color.success,
  pending: color.muted,
} as const;

// Module scope: one stable object across every card render (list-item prop rule).
// CSS-transition semantics animate CHANGES only — a card that mounts already-synced
// renders green statically; only the live pending→synced flip (flushCount → refresh
// → new color prop on the mounted card) tweens. Lives outside StyleSheet.create
// because RN's TextStyle doesn't know the transition keys; CSSStyle<TextStyle> is
// reanimated's name for "a text style that may carry them."
const syncColorTransition: CSSStyle<TextStyle> = {
  transitionProperty: "color",
  transitionDuration: "300ms",
};

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
        <StatTile label="Pass" value={audit.passCount} />
        <StatTile label="Fail" value={audit.failCount} tint={color.danger} />
        <StatTile label="N/A" value={audit.naCount} />
      </View>
      <Animated.Text style={[styles.sync, syncColorTransition, { color: badge.color }]}>
        {badge.label}
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
  },
  pressed: { opacity: 0.6 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  name: { fontSize: font.emphasis, fontWeight: "600" },
  date: { fontSize: font.secondary, color: color.text },
  countsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  sync: { fontSize: font.caption, color: color.muted, marginTop: 12, fontWeight: "600" },
});
