import { Pressable, StyleSheet, Text } from "react-native";
import { color, font, radius, space } from "../theme";

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

// The one filled action button (brand blue): Save, Review & Complete, Complete
// Audit, Sync now. Carries no layout of its own — a call site that needs
// positioning wraps it in a View.
export function PrimaryButton({ label, onPress, disabled }: PrimaryButtonProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: color.brand,
    borderRadius: radius.card,
    padding: space.lg,
    alignItems: "center",
  },
  buttonDisabled: { backgroundColor: color.disabled },
  pressed: { opacity: 0.6 },
  label: { color: color.onFill, fontWeight: "600", fontSize: font.body },
});
