import { useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getAuditItem, updateAuditItem, type AuditItem } from "../../../src/db/audits";
import { itemSaveSchema } from "../../../src/validation/audit";

const RESULTS = ["pass", "fail", "na"] as const;
const RESULT_LABELS: Record<(typeof RESULTS)[number], string> = {
  pass: "Pass",
  fail: "Fail",
  na: "N/A",
};

export default function CheckItem() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();

  const [item, setItem] = useState<AuditItem | null>(null);
  const [result, setResult] = useState<"pass" | "fail" | "na" | null>(null);
  const [tempInput, setTempInput] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load once on mount and seed the editable fields from the stored row, so returning
  // to a previously-saved item shows its values (drives the "reopen → persisted" AC).
  useEffect(() => {
    getAuditItem(db, itemId).then((row) => {
      setItem(row);
      if (row) {
        setResult(row.result);
        setTempInput(row.tempReading != null ? String(row.tempReading) : "");
        setNote(row.note ?? "");
      }
    });
  }, [db, itemId]);

  if (!item) {
    return (
      <View style={styles.container}>
        <Text style={styles.loading}>Loading…</Text>
      </View>
    );
  }

  const requiresTemp = !!item.requiresTemp;

  async function onSave() {
    const t = tempInput.trim();
    const parsedTemp = t === "" ? null : Number(t);
    const draft = {
      result,
      tempReading: parsedTemp != null && Number.isNaN(parsedTemp) ? null : parsedTemp,
      note: note.trim() === "" ? null : note,
    };

    const parsed = itemSaveSchema(requiresTemp).safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    await updateAuditItem(db, itemId, parsed.data);
    router.back();
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>{item.label}</Text>

      <View style={styles.segment}>
        {RESULTS.map((value) => {
          const selected = result === value;
          return (
            <Pressable
              key={value}
              onPress={() => {
                setResult(value);
                setError(null);
              }}
              style={[
                styles.segmentBtn,
                selected && styles.segmentSelected,
                selected && value === "fail" && styles.segmentFail,
              ]}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                {RESULT_LABELS[value]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {requiresTemp && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Temperature °F</Text>
          <TextInput
            style={styles.input}
            value={tempInput}
            onChangeText={(v) => {
              setTempInput(v);
              setError(null);
            }}
            keyboardType="numeric"
            placeholder="e.g. 38"
            placeholderTextColor="#999"
          />
        </View>
      )}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Note</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={note}
          onChangeText={setNote}
          placeholder="Optional"
          placeholderTextColor="#999"
          multiline
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.saveBtn} onPress={onSave}>
        <Text style={styles.saveText}>Save</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  loading: { fontSize: 15, color: "#999" },
  heading: { fontSize: 20, fontWeight: "700", marginBottom: 20 },
  segment: { flexDirection: "row", gap: 8, marginBottom: 20 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
    backgroundColor: "#fff",
    alignItems: "center",
  },
  segmentSelected: { backgroundColor: "#1a1a1a", borderColor: "#1a1a1a" },
  segmentFail: { backgroundColor: "#c0392b", borderColor: "#c0392b" },
  segmentText: { fontSize: 15, fontWeight: "600", color: "#666" },
  segmentTextSelected: { color: "#fff" },
  field: { marginBottom: 20 },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#888",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
    padding: 14,
    fontSize: 15,
  },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  error: { color: "#c0392b", fontSize: 14, marginBottom: 12 },
  saveBtn: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  saveText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
