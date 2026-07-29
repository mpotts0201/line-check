import { useSQLiteContext } from "expo-sqlite";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { resetAuditData } from "../../db/dev";
import { getSyncQueueStats } from "../../db/syncQueue";
import { formatSyncError } from "../../sync/formatSyncError";
import { syncNow } from "../../sync/syncEngine";
import { useSyncStore } from "../../sync/syncStore";
import { color, font, radius } from "../../theme";
import { PrimaryButton } from "../PrimaryButton";

type SyncBarProps = {
  // Parent re-reads audits + sync states after an action that changed local data
  // OUTSIDE the flush path — today that is only the dev reset. Flush outcomes
  // reach the parent through the store's flushCount signal, never this prop.
  onDataChanged: () => Promise<void>;
};

// The History header: Sync now, its status line, and the dev-only reset. Self-
// contained — owns its db handle and status message; the one thing it can't do
// alone (make the parent re-read its list) is the one prop.
export function SyncBar({ onDataChanged }: SyncBarProps) {
  const db = useSQLiteContext();
  // Derived from the engine's own status (owner decision 2026-07-29): ANY flush —
  // manual tap, reconnect edge, completion poke — shows "Syncing…" and disables
  // both buttons. The Reset disable is flush-safety (wiping sync_queue mid-upsert
  // would push rows for audits that no longer exist locally), so it must cover
  // background flushes too, which local tap-state never did.
  const isSyncing = useSyncStore((s) => s.status === "syncing");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Manual sync — one of the engine's three pokes (the others: the reconnect edge
  // and Submit). Goes through syncNow() so all three share the single-flight guard.
  // No trailing list refresh here (owner decision 2026-07-29): the engine's
  // flushCount bump already makes the parent re-read — the signal is the only
  // badge-refresh channel.
  async function onSyncNow() {
    try {
      // Resolves when the push finishes — or immediately, if offline or one is
      // already in flight. The engine ignores the flush result on purpose, so read
      // the outcome where it lives: the queue. Empty = everything landed; anything
      // left is waiting for the next poke.
      await syncNow();
      const { total } = await getSyncQueueStats(db);
      setStatusMessage(total === 0 ? "Up to date" : `${total} rows still waiting`);
    } catch (error) {
      // syncNow never throws (the engine warns and swallows internally), so only
      // this component's own follow-up — getSyncQueueStats — can land here.
      // Surface it rather than reject silently.
      console.warn("[sync] unexpected failure", error);
      setStatusMessage(`Sync failed — ${formatSyncError(error)}`);
    }
  }

  // TEMPORARY (dev/demo) — wipes local audits, items, and the sync queue. Confirmed
  // first: it is irreversible and sits one tap from "Sync now".
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
            // The disabled button gates OPENING this dialog, but a background flush
            // can start while it sits open — re-check at confirm time so the wipe
            // never runs mid-upsert.
            if (useSyncStore.getState().status === "syncing") {
              setStatusMessage("Reset skipped — sync in flight");
              return;
            }
            try {
              await resetAuditData(db);
              setStatusMessage("Local audit data cleared");
              // A reset is not a flush — no flushCount bump fires — so the parent
              // must be told to re-read explicitly.
              await onDataChanged();
            } catch (error) {
              console.warn("[dev] reset failed", error);
              setStatusMessage(`Reset failed — ${formatSyncError(error)}`);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.syncBar}>
      <PrimaryButton
        label={isSyncing ? "Syncing…" : "Sync now"}
        onPress={onSyncNow}
        disabled={isSyncing}
      />
      {statusMessage && <Text style={styles.statusText}>{statusMessage}</Text>}
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
            isSyncing && styles.resetBtnDisabled,
            pressed && styles.pressed,
          ]}
          onPress={onResetLocalData}
          disabled={isSyncing}
          accessibilityRole="button"
          accessibilityLabel="Reset local audit data"
        >
          <Text style={[styles.resetBtnText, isSyncing && styles.resetBtnTextDisabled]}>
            Reset local data
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  syncBar: { gap: 6, marginBottom: 4 },
  statusText: { fontSize: font.secondary, color: color.text, textAlign: "center" },
  resetBtn: {
    minHeight: 44, // tap-target floor
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  resetBtnDisabled: { borderColor: color.disabled },
  resetBtnText: { color: color.danger, fontSize: font.note, fontWeight: "600" },
  resetBtnTextDisabled: { color: color.disabled },
  pressed: { opacity: 0.6 },
});
