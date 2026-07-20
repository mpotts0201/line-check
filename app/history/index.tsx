import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { getCompletedAudits, type AuditSummary } from "../../src/db/audits";
import { supabase } from "../../src/supabase";
import { flushSyncQueue } from "../../src/sync/flush";

// completedAt is an ISO string; show its date portion. Kept manual (no date lib, no
// reliance on Hermes Intl) so it renders identically on every device.
function formatDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

export default function History() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [audits, setAudits] = useState<AuditSummary[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // Refetch on focus — a just-completed audit (arriving via replace('/history')) is
  // present, and later completions refresh when this screen regains focus.
  useFocusEffect(
    useCallback(() => {
      getCompletedAudits(db).then(setAudits);
    }, [db])
  );

  // Manual flush trigger. Auto-sync on connectivity return is now wired at the app root (7d);
  // this stays as a manual control for now and becomes a per-audit give-up fallback in 7e. This
  // screen injects the real `supabase` singleton, so the worker itself stays singleton-free.
  async function onSyncNow() {
    setSyncing(true);
    const result = await flushSyncQueue(db, supabase);
    setSyncStatus(
      result.status === "synced"
        ? `Synced ${result.audits} audits · ${result.items} items`
        : result.status === "empty"
          ? "Up to date"
          : "Sync failed — will retry"
    );
    getCompletedAudits(db).then(setAudits);
    setSyncing(false);
  }

  return (
    <FlatList
      data={audits}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.syncBar}>
          <Pressable
            style={({ pressed }) => [
              styles.syncBtn,
              syncing && styles.syncBtnDisabled,
              pressed && styles.pressed,
            ]}
            onPress={onSyncNow}
            disabled={syncing}
          >
            <Text style={styles.syncBtnText}>{syncing ? "Syncing…" : "Sync now"}</Text>
          </Pressable>
          {syncStatus && <Text style={styles.syncStatus}>{syncStatus}</Text>}
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>No completed audits yet.</Text>}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          onPress={() => router.push(`/history/${item.id}`)}
        >
          <View style={styles.headerRow}>
            <Text style={styles.name}>{item.locationName}</Text>
            <Text style={styles.date}>{formatDate(item.completedAt)}</Text>
          </View>
          <View style={styles.countsRow}>
            <Count label="Pass" value={item.passCount} />
            <Count label="Fail" value={item.failCount} tint="#c0392b" />
            <Count label="N/A" value={item.naCount} />
          </View>
          <Text style={styles.sync}>Not synced</Text>
        </Pressable>
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
  list: { padding: 16, gap: 10 },
  empty: { fontSize: 15, color: "#999", padding: 16 },
  syncBar: { gap: 6, marginBottom: 4 },
  syncBtn: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  syncBtnDisabled: { backgroundColor: "#999" },
  syncBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  syncStatus: { fontSize: 13, color: "#666", textAlign: "center" },
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
