import { useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text } from "react-native";
import { getLocations, type Location } from "../src/db/locations";
import { color, font, radius } from "../src/theme";


export default function Locations() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    getLocations(db).then(setLocations);
  }, [db]);

  return (
    <FlatList
      data={locations}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          onPress={() => router.push(`/audit/${item.id}`)}
        >
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.address}>{item.address}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  card: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
  },
  pressed: { opacity: 0.6 },
  name: { fontSize: font.emphasis, fontWeight: "600" },
  address: { fontSize: font.secondary, color: color.text, marginTop: 2 },
});
