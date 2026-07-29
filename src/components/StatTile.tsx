import { StyleSheet, Text, View } from "react-native";
import { color, font, radius, space } from "../theme";

type StatTileProps = {
  label: string;
  value: number;
  tint?: string;
};

// One count tile (Pass / Fail / N/A / Open) in a stats row. All three count
// surfaces — review screen, history detail, History card — render this same
// tile; extracted per THEME_POLISH P5 after DECISIONS 2026-07-17 deferred it.
export function StatTile({ label, value, tint }: StatTileProps) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.value, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    paddingVertical: space.lg,
    alignItems: "center",
  },
  value: { fontSize: font.stat, fontWeight: "700", color: color.ink },
  label: {
    fontSize: font.caption,
    fontWeight: "700",
    color: color.label,
    textTransform: "uppercase",
    marginTop: space.xs,
  },
});
