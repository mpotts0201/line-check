import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function ReviewSign() {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{auditId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  text: { fontSize: 15 },
});
