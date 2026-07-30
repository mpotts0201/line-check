import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, font, radius, space } from "../../theme";

type SignatureBoxProps = {
  signature: string | null; // the pad's base64 PNG data URL, held in screen state
  onPressSign: () => void;
  onClear: () => void;
};

// One value for both states so the box doesn't jump when a signature lands.
const SIGNATURE_HEIGHT = 120;

// The review screen's signature slot: a tap-to-sign target while empty, the
// captured signature once signed. One action per state — empty offers only
// "sign", signed offers only "Clear & re-sign" (the image itself is not a
// button; re-signing always goes through the explicit clear).
export function SignatureBox({ signature, onPressSign, onClear }: SignatureBoxProps) {
  if (signature === null) {
    return (
      <Pressable
        onPress={onPressSign}
        accessibilityRole="button"
        accessibilityLabel="Tap to sign"
        style={({ pressed }) => [styles.emptyBox, pressed && styles.pressed]}
      >
        <Text style={styles.emptyLabel}>Tap to sign</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.signedBox}>
      <Image
        source={{ uri: signature }}
        style={styles.image}
        contentFit="contain"
        accessibilityLabel="Captured signature"
      />
      <Pressable
        onPress={onClear}
        accessibilityRole="button"
        hitSlop={8}
        style={({ pressed }) => [styles.clearRow, pressed && styles.pressed]}
      >
        <Text style={styles.clearLabel}>Clear &amp; re-sign</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyBox: {
    height: SIGNATURE_HEIGHT,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.disabled,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.sm,
    marginBottom: space.xl,
  },
  emptyLabel: { fontSize: font.body, color: color.muted },
  signedBox: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    backgroundColor: color.card,
    marginTop: space.sm,
    marginBottom: space.xl,
    overflow: "hidden",
  },
  image: { height: SIGNATURE_HEIGHT },
  clearRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
    paddingVertical: space.md,
    alignItems: "center",
  },
  clearLabel: { fontSize: font.body, fontWeight: "600", color: color.brand },
  pressed: { opacity: 0.6 },
});
