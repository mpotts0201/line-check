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
import { PrimaryButton } from "../../../src/components/PrimaryButton";
import { getAuditItem, updateAuditItem, type AuditItem } from "../../../src/db/audits";
import { color, font, radius } from "../../../src/theme";
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
              style={[styles.segmentBtn, selected && SELECTED_STYLE[value]]}
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
            placeholderTextColor={color.muted}
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
          placeholderTextColor={color.muted}
          multiline
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <PrimaryButton label="Save" onPress={onSave} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  loading: { fontSize: font.body, color: color.muted },
  heading: { fontSize: font.title, fontWeight: "700", marginBottom: 20 },
  segment: { flexDirection: "row", gap: 8, marginBottom: 20 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    backgroundColor: color.card,
    alignItems: "center",
  },
  segmentPass: { backgroundColor: color.success, borderColor: color.success },
  segmentFail: { backgroundColor: color.danger, borderColor: color.danger },
  segmentNa: { backgroundColor: color.neutral, borderColor: color.neutral },
  segmentText: { fontSize: font.body, fontWeight: "600", color: color.text },
  segmentTextSelected: { color: color.onFill },
  field: { marginBottom: 20 },
  fieldLabel: {
    fontSize: font.secondary,
    fontWeight: "700",
    color: color.label,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  input: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    padding: 14,
    fontSize: font.body,
  },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  error: { color: color.danger, fontSize: font.note, marginBottom: 12 },
});

// The selected segment fills with its result's semantic color (white text) —
// pass/fail/na each read distinctly at a glance, not just fail.
const SELECTED_STYLE = {
  pass: styles.segmentPass,
  fail: styles.segmentFail,
  na: styles.segmentNa,
} as const;
