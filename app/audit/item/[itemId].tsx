import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function CheckItem() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{itemId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  text: { fontSize: 15 },
});
