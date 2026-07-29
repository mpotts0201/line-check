import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text } from "react-native";
import { AuditCard } from "../../src/components/history/AuditCard";
import { SyncBar } from "../../src/components/history/SyncBar";
import { getCompletedAudits, type AuditSummary } from "../../src/db/audits";
import {
  getAuditSyncStates,
  type AuditSyncStateRow,
} from "../../src/db/syncQueue";
import { formatSyncError } from "../../src/sync/formatSyncError";
import { useSyncStore } from "../../src/sync/syncStore";
import { color, font } from "../../src/theme";

// The History screen: load completed audits + their sync states, render the
// list. The sync controls live in SyncBar; a card is AuditCard.
export default function History() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [audits, setAudits] = useState<AuditSummary[]>([]);
  const [syncStates, setSyncStates] = useState<Record<string, AuditSyncStateRow>>({});
  // The screen's own failure state ("did the read work"), separate from SyncBar's
  // status line ("did the push land") — the two answer different questions.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Selector = re-render only when the counter moves, not on status flips
  // (this screen doesn't read status; SyncBar watches it for the button).
  const flushCount = useSyncStore((s) => s.flushCount);

  // Summaries and sync states are two queries merged here by audit id — joining
  // sync_queue into the summaries query would fan out the GROUP BY that builds
  // the pass/fail/na counts (see getAuditSyncStates).
  const refresh = useCallback(async () => {
    try {
      const [completed, states] = await Promise.all([
        getCompletedAudits(db),
        getAuditSyncStates(db),
      ]);
      setAudits(completed);
      setSyncStates(Object.fromEntries(states.map((s) => [s.auditId, s])));
      setLoadError(null); // a successful read retires any stale error
    } catch (error) {
      // Catch here so every call site (focus, flush signal, post-reset) surfaces
      // the same way.
      console.warn("[history] load failed", error);
      setLoadError(`Load failed — ${formatSyncError(error)}`);
    }
  }, [db]);

  // Refetch on focus — a just-completed audit (arriving via replace('/history')) is
  // present, and later completions refresh when this screen regains focus.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  // The engine's sync_finished signal: a flush ended (manual, reconnect edge, or a
  // completion poke from another screen) — re-read badges from SQLite. This is the
  // ONLY badge-refresh channel for flushes. Fires once on mount too, doubling the
  // focus effect's read; both are cheap SELECTs of the same truth, so a first-run
  // latch isn't worth its lifecycle footnote.
  useEffect(() => {
    refresh();
  }, [flushCount, refresh]);

  const onCardPress = useCallback(
    (auditId: string) => {
      router.push(`/history/${auditId}`);
    },
    [router]
  );

  const renderItem = useCallback(
    ({ item }: { item: AuditSummary }) => (
      <AuditCard audit={item} syncState={syncStates[item.id]} onPress={onCardPress} />
    ),
    [syncStates, onCardPress]
  );

  const listHeader = useMemo(
    () => (
      <>
        <SyncBar onDataChanged={refresh} />
        {loadError && <Text style={styles.loadError}>{loadError}</Text>}
      </>
    ),
    [refresh, loadError]
  );

  return (
    <FlatList
      data={audits}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={<Text style={styles.empty}>No completed audits yet.</Text>}
      renderItem={renderItem}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  empty: { fontSize: font.body, color: color.muted, padding: 16 },
  loadError: { fontSize: font.secondary, color: color.danger, textAlign: "center" },
});
