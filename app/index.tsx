import { useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text } from "react-native";
import { getLocations, type Location } from "../src/db/locations";


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
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
  },
  pressed: { opacity: 0.6 },
  name: { fontSize: 16, fontWeight: "600" },
  address: { fontSize: 13, color: "#666", marginTop: 2 },
});
