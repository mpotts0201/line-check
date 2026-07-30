import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "../../../src/components/PrimaryButton";
import { StatTile } from "../../../src/components/StatTile";
import { SignatureBox } from "../../../src/components/review/SignatureBox";
import { SignatureModal } from "../../../src/components/review/SignatureModal";
import { getAuditItems, completeAudit, type AuditItem } from "../../../src/db/audits";
import { saveSignaturePng } from "../../../src/files/signature";
import { syncNow } from "../../../src/sync/syncEngine";
import { color, font, radius } from "../../../src/theme";
import { auditCompleteSchema } from "../../../src/validation/audit";

export default function ReviewSign() {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const [items, setItems] = useState<AuditItem[]>([]);
  // The signature lives here (base64 data URL) until Complete persists it — sign-
  // then-complete is one ceremony, so leaving the screen deliberately discards it
  // (SIGNATURE_CAPTURE_PROPOSAL.md: no draft signatures, no orphan files).
  const [signature, setSignature] = useState<string | null>(null);
  const [isSigning, setIsSigning] = useState(false);

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
  // temp-required item has a reading) AND the audit is signed. Disables Complete
  // until then. Unsigned maps to "" so the schema's min(1) does the rejecting.
  const gate = auditCompleteSchema.safeParse({
    items: items.map((i) => ({
      result: i.result,
      tempReading: i.tempReading,
      requiresTemp: !!i.requiresTemp,
    })),
    signature: signature ?? "",
  });
  const canComplete = gate.success;

  function openPad() {
    setIsSigning(true);
  }

  function closePad() {
    setIsSigning(false);
  }

  // "Clear & re-sign" is one gesture: drop the capture and go straight back to
  // the pad (which opens cleared — the modal wipes its canvas on every open).
  function clearAndResign() {
    setSignature(null);
    setIsSigning(true);
  }

  function handleSigned(signatureDataUrl: string) {
    setSignature(signatureDataUrl);
    setIsSigning(false);
  }

  async function onComplete() {
    if (signature === null) return; // unreachable — the gate disables Complete; narrows for TS
    // PNG to disk first, then the URI rides completeAudit's transaction so the
    // sync-queue snapshot carries it (see completeAudit's comment). Either step
    // can throw (disk write, SQLite) — surface it and stay on the screen rather
    // than navigating away from an audit that is still a draft. If the write
    // succeeded but completion failed, the deterministic filename means the
    // retry simply overwrites the same PNG — no orphan accumulates.
    try {
      const signatureUri = await saveSignaturePng(auditId, signature);
      await completeAudit(db, auditId, signatureUri);
    } catch (e) {
      // The warn names the actual exception in the Metro console — the Alert alone
      // proved undebuggable on device (same choke-point pattern as flush.ts).
      console.warn("completeAudit failed:", e);
      Alert.alert("Couldn't complete audit", "Something went wrong saving the audit. Please try again.");
      return;
    }
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
      <SignatureBox signature={signature} onPressSign={openPad} onClear={clearAndResign} />

      {/* One hint at a time: unanswered items are the primary blocker; the
          signature hint appears only once the checklist itself is complete. */}
      {counts.unanswered > 0 ? (
        <Text style={styles.hint}>
          {counts.unanswered} item{counts.unanswered === 1 ? "" : "s"} unanswered
        </Text>
      ) : signature === null ? (
        <Text style={styles.hint}>Signature required</Text>
      ) : null}

      <PrimaryButton label="Complete Audit" onPress={onComplete} disabled={!canComplete} />

      <SignatureModal visible={isSigning} onDone={handleSigned} onCancel={closePad} />
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
  hint: { fontSize: font.note, color: color.danger, marginBottom: 12, textAlign: "center" },
});
