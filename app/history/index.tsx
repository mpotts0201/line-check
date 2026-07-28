import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { getCompletedAudits, type AuditSummary } from "../../src/db/audits";
import { resetAuditData } from "../../src/db/dev";
import {
  getAuditSyncStates,
  getSyncQueueStats,
  type AuditSyncStateRow,
} from "../../src/db/syncQueue";
import { MAX_ATTEMPTS } from "../../src/sync/retry";
import { syncNow } from "../../src/sync/syncEngine";

// completedAt is an ISO string; show its date portion. Kept manual (no date lib, no
// reliance on Hermes Intl) so it renders identically on every device.
function formatDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

// Renders whatever this screen's own catch paths trap (a failed load, a failed reset, or
// an unexpected throw out of syncNow). Flush failures no longer land here — they warn at
// flush.ts's choke point and reach this screen only as a badge that stays un-synced.
// Errors arrive as `unknown`, so narrow structurally rather than casting; Postgrest-shaped
// objects (code/message/details/hint) still format usefully if one ever surfaces this way.
// 8b-iv extracts this into SyncBar.
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

// Named here rather than inline so the three states can't drift apart; a shared theme
// constants file is 8b-iv's problem (stuck reuses the fail-count red already in this file).
const BADGE_COLOR = {
  synced: "#2e7d32",
  stuck: "#c0392b",
  pending: "#999",
} as const;

// Badge text + tint for one audit's card. The lookup can miss only if an audit completed
// between the two queries in refresh(); the fallback reads Pending for the same reason a
// drained-queue-but-unconfirmed audit does — never claim a confirmation we don't have.
function syncBadge(state: AuditSyncStateRow | undefined): { label: string; color: string } {
  if (state?.state === "synced") return { label: "Synced ✓", color: BADGE_COLOR.synced };
  if (state?.state === "stuck") return { label: "Not synced", color: BADGE_COLOR.stuck };
  const waiting = state?.pendingRows ?? 0;
  return {
    label: waiting > 0 ? `Pending — ${waiting} waiting` : "Pending",
    color: BADGE_COLOR.pending,
  };
}

export default function History() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [audits, setAudits] = useState<AuditSummary[]>([]);
  const [syncStates, setSyncStates] = useState<Record<string, AuditSyncStateRow>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // Summaries and sync states are two queries merged here by audit id — joining sync_queue
  // into the summaries query would fan out the GROUP BY that builds the pass/fail/na counts
  // (see getAuditSyncStates). MAX_ATTEMPTS is injected at this layer; src/db never sees it.
  const refresh = useCallback(async () => {
    try {
      const [completed, states] = await Promise.all([
        getCompletedAudits(db),
        getAuditSyncStates(db, MAX_ATTEMPTS),
      ]);
      setAudits(completed);
      setSyncStates(Object.fromEntries(states.map((s) => [s.auditId, s])));
    } catch (error) {
      // Catch here so every call site (focus, post-sync, post-reset) surfaces the same
      // way — and so a failed read can't strand onSyncNow or overwrite a reset's outcome.
      console.warn("[history] load failed", error);
      setSyncStatus(`Load failed — ${formatSyncError(error)}`);
    }
  }, [db]);

  // Refetch on focus — a just-completed audit (arriving via replace('/history')) is
  // present, and later completions refresh when this screen regains focus.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  // Manual sync — the third poke (the others: the reconnect edge and Submit). Goes through
  // syncNow() so all three share the engine's single-flight guard; before this, the button
  // called the worker directly and could race an in-flight auto-sync.
  async function onSyncNow() {
    setSyncing(true);
    try {
      await runSync();
    } catch (error) {
      // syncNow never throws (the engine warns and swallows internally), so only this
      // screen's own follow-up — getSyncQueueStats — can land here. Surface it rather
      // than reject silently.
      console.warn("[sync] unexpected failure", error);
      setSyncStatus(`Sync failed — ${formatSyncError(error)}`);
    } finally {
      // Without this, a throw anywhere above leaves syncing=true forever, disabling both
      // buttons until app restart.
      setSyncing(false);
    }
  }

  async function runSync() {
    // Resolves when the push finishes — or immediately, if offline or one is in flight.
    await syncNow();

    // The engine ignores the flush result on purpose, so read the outcome where it lives:
    // the queue. Empty = everything landed; leftovers are waiting or gave up. Reporting
    // given-up rows as "Up to date" would be a false statement about durability — nothing
    // retries them until the give-up rule itself dissolves in R3.
    const { total, givenUp } = await getSyncQueueStats(db, MAX_ATTEMPTS);
    if (total === 0) {
      setSyncStatus("Up to date");
    } else if (givenUp > 0) {
      setSyncStatus(`${givenUp} rows gave up after ${MAX_ATTEMPTS} attempts — not synced`);
    } else {
      setSyncStatus(`${total} rows still waiting`);
    }

    await refresh();
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
              await refresh();
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
      renderItem={({ item }) => {
        const badge = syncBadge(syncStates[item.id]);
        return (
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
            <Text style={[styles.sync, { color: badge.color }]}>{badge.label}</Text>
          </Pressable>
        );
      }}
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
