import {
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { color, font, radius } from "../theme";

// Subtle tap pop: settles in ~150ms with a hair of overshoot.
// ReduceMotion.Never is deliberate (DECISIONS 2026-07-30 addendum): this is a
// brief, small state-change cue, and the runtime's reduce-motion flag proved
// unreliable on device (reported on while the system toggle was off).
const POP = {
  damping: 14, // how fast the bounce dies out
  stiffness: 300, // how fast it snaps back to rest
  reduceMotion: ReduceMotion.Never,
} as const;

type SegmentButtonProps = {
  label: string;
  selected: boolean;
  selectedStyle: StyleProp<ViewStyle>; // caller supplies the semantic fill (pass/fail/na)
  onPress: () => void;
};

// One segment of a result control. Data in, one event out — the semantic color
// mapping stays the screen's knowledge; the selection pop is self-contained.
// Press-driven on purpose: selection can only change via press, so guarding on
// !selected means "on becoming selected" — a screen that seeds its selection
// from the db renders it with no pop, and re-tapping the selected segment
// stays silent (state-change feedback only).
export function SegmentButton({ label, selected, selectedStyle, onPress }: SegmentButtonProps) {
  const scale = useSharedValue(1);
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  function handlePress() {
    if (!selected) {
      scale.value = 1.12; // snap enlarged — a bump that reads under a fingertip…
      scale.value = withSpring(1, POP); // …then settle back to rest
    }
    onPress();
  }

  return (
    <Animated.View style={[styles.wrap, pop]}>
      <Pressable
        onPress={handlePress}
        style={[styles.btn, selected && selectedStyle]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
      >
        <Text style={[styles.text, selected && styles.textSelected]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  btn: {
    paddingVertical: 14,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    backgroundColor: color.card,
    alignItems: "center",
  },
  text: { fontSize: font.body, fontWeight: "600", color: color.text },
  textSelected: { color: color.onFill },
});
