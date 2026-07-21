import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { getCompletedAudits, type AuditSummary } from "../../src/db/audits";
import { resetAuditData } from "../../src/db/dev";
import { getSyncQueueStats } from "../../src/db/syncQueue";
import { supabase } from "../../src/supabase";
import { flushSyncQueue } from "../../src/sync/flush";
import { MAX_ATTEMPTS } from "../../src/sync/retry";

// completedAt is an ISO string; show its date portion. Kept manual (no date lib, no
// reliance on Hermes Intl) so it renders identically on every device.
function formatDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

// TEMPORARY (sync debugging) — renders whatever the flush worker caught. A PostgrestError
// carries code/message/details/hint, but the worker types the failure as `unknown` (its DI
// seam admits a test fake too), so narrow structurally rather than casting. The `code` is
// the useful part: PGRST205 = missing table, PGRST204 = missing column, 42501 = RLS,
// 42P10 = no unique constraint for onConflict, 23503 = FK violation.
function formatSyncError(error: unknown): string {
  // Error first: an Error also satisfies the object check below, and its `message` is the
  // whole story. Checking it second would make this branch unreachable.
  if (error instanceof Error && error.message.length > 0) return error.message;

  if (typeof error === "object" && error !== null) {
    const e = error as Record<string, unknown>;
    const parts = [e.code, e.message, e.details, e.hint]
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    if (parts.length > 0) return parts.join(" · ");
    // Shaped like an error but with no string fields (e.g. a numeric `code`). Serialize
    // rather than fall through to String(), which would render "[object Object]" — exactly
    // as undiagnosable as the message this whole change replaced.
    try {
      return JSON.stringify(error);
    } catch {
      return String(error); // circular reference
    }
  }
  return String(error);
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

    if (result.status === "synced") {
      setSyncStatus(`Synced ${result.audits} audits · ${result.items} items`);
    } else if (result.status === "empty") {
      // "empty" conflates two states: nothing queued, and rows queued but ALL given up
      // (the worker returns it when no row has attempts < MAX_ATTEMPTS). Reporting the second
      // as "Up to date" would be a false statement about durability — and "queued" would
      // understate it too, since auto-sync will never retry these on its own until 8b's
      // per-audit "Retry sync" lands. Say they gave up.
      const { total, givenUp } = await getSyncQueueStats(db, MAX_ATTEMPTS);
      if (total === 0) {
        setSyncStatus("Up to date");
      } else if (givenUp > 0) {
        setSyncStatus(`${givenUp} rows gave up after ${MAX_ATTEMPTS} attempts — not synced`);
      } else {
        // Only reachable if auto-sync enqueued a fresh, still-eligible row between the flush
        // and this count.
        setSyncStatus(`${total} rows queued`);
      }
    } else {
      // This error was previously discarded, which is why a column-name mismatch presented
      // as an undiagnosable "Sync failed". The raw object always goes to Metro; the decoded
      // Postgrest code is dev-only, since a code like PGRST204 is meaningless to a manager
      // in a walk-in cooler.
      console.warn("[sync] flush failed", result.error);
      setSyncStatus(
        __DEV__
          ? `Sync failed — ${formatSyncError(result.error)}`
          : "Sync failed — will retry"
      );
    }

    getCompletedAudits(db).then(setAudits);
    setSyncing(false);
  }

  // TEMPORARY (dev/demo) — wipes local audits, items, and the sync queue. Confirmed first:
  // it is irreversible and sits one tap from "Sync now".
  function onResetLocalData() {
    Alert.alert(
      "Reset local audit data?",
      "Deletes every local audit, audit item, and queued sync row. Locations and checklist templates are kept, so the app still works offline. Rows already pushed to Supabase are not affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            try {
              await resetAuditData(db);
              setSyncStatus("Local audit data cleared");
              setAudits(await getCompletedAudits(db));
            } catch (error) {
              console.warn("[dev] reset failed", error);
              setSyncStatus(`Reset failed — ${formatSyncError(error)}`);
            }
          },
        },
      ]
    );
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
          {/* Dev/demo only. __DEV__ is false in a production bundle, so Metro drops this
              branch and the CONTROL never renders in production. Note the capability itself
              (resetAuditData) is still imported at module scope and ships in the bundle —
              nothing reaches it, but don't mistake this for removing the code.
              Disabled mid-flush: wiping sync_queue during an in-flight upsert would push
              rows for audits that no longer exist locally. */}
          {__DEV__ && (
            <Pressable
              style={({ pressed }) => [
                styles.resetBtn,
                syncing && styles.resetBtnDisabled,
                pressed && styles.pressed,
              ]}
              onPress={onResetLocalData}
              disabled={syncing}
              accessibilityRole="button"
              accessibilityLabel="Reset local audit data"
            >
              <Text style={[styles.resetBtnText, syncing && styles.resetBtnTextDisabled]}>
                Reset local data
              </Text>
            </Pressable>
          )}
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
  resetBtn: {
    minHeight: 44, // tap-target floor
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#c0392b",
    alignItems: "center",
    justifyContent: "center",
  },
  resetBtnDisabled: { borderColor: "#ccc" },
  resetBtnText: { color: "#c0392b", fontSize: 14, fontWeight: "600" },
  resetBtnTextDisabled: { color: "#ccc" },
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
