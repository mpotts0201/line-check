import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

// Stub (T6.5 bullet 1): read the param and render it. The full read-only record
// (getAudit + all items, no Complete/signature/gate) lands in a later bullet.
export default function AuditDetail() {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Audit detail: {auditId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  text: { fontSize: 15 },
});
