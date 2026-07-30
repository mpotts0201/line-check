import { useEffect, useRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SignatureCanvas, { type SignatureViewRef } from "react-native-signature-canvas";
import { color, font, radius, space } from "../../theme";
import { PrimaryButton } from "../PrimaryButton";

type SignatureModalProps = {
  visible: boolean;
  onDone: (signatureDataUrl: string) => void;
  onCancel: () => void;
};

// CSS injected INTO the WebView — our StyleSheet can't reach inside it. Hides the
// library's built-in footer (the RN buttons below own Clear/Done) and strips
// signature_pad's default card chrome so the canvas reads as one clean sheet.
const PAD_WEB_STYLE = `
  .m-signature-pad { box-shadow: none; border: none; height: 100%; margin: 0; }
  .m-signature-pad--body { border: none; }
  .m-signature-pad--footer { display: none; margin: 0; }
  body, html { width: 100%; height: 100%; background-color: ${color.card}; }
`;

// Full-screen on purpose: a real signing area for a finger, and no ScrollView
// underneath to steal downward strokes (the review screen scrolls).
export function SignatureModal({ visible, onDone, onCancel }: SignatureModalProps) {
  const padRef = useRef<SignatureViewRef>(null);
  const insets = useSafeAreaInsets();

  // RN Modal normally unmounts its content on dismiss, so most reopens mount a
  // fresh, empty canvas anyway. The wipe covers the exception: on iOS the content
  // stays mounted through the dismiss animation, so a rapid cancel-and-reopen can
  // hit a still-live canvas holding the previous strokes. Every open starts clean —
  // re-signing means signing again, not editing. (A not-yet-ready ref on first
  // mount is harmless: the canvas is empty and the call optional-chains away.)
  useEffect(() => {
    if (visible) padRef.current?.clearSignature();
  }, [visible]);

  function clearPad() {
    padRef.current?.clearSignature();
  }

  // readSignature() asks the WebView for the drawing; the result arrives via
  // onOK(base64DataUrl). An empty canvas fires onEmpty instead of onOK — we leave
  // it unhandled, so Done on a blank pad simply does nothing and the modal stays
  // open (nothing to save is not an error).
  function readPad() {
    padRef.current?.readSignature();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View
        style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Sign to complete</Text>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            hitSlop={12}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>

        <View style={styles.canvasFrame}>
          <SignatureCanvas
            ref={padRef}
            onOK={onDone}
            webStyle={PAD_WEB_STYLE}
            penColor={color.ink}
            backgroundColor={color.card}
            descriptionText=""
            autoClear={false}
          />
        </View>
        <Text style={styles.hint}>Sign above with your finger</Text>

        <View style={styles.actions}>
          <Pressable
            onPress={clearPad}
            accessibilityRole="button"
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
          >
            <Text style={styles.clearLabel}>Clear</Text>
          </Pressable>
          <View style={styles.doneWrap}>
            <PrimaryButton label="Done" onPress={readPad} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.screen,
    paddingHorizontal: space.lg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: space.md,
  },
  title: { fontSize: font.title, fontWeight: "700", color: color.ink },
  cancelLabel: { fontSize: font.body, color: color.brand, fontWeight: "600" },
  canvasFrame: {
    flex: 1,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    backgroundColor: color.card,
    // The WebView won't clip itself to our rounded corners without this.
    overflow: "hidden",
  },
  hint: {
    fontSize: font.secondary,
    color: color.muted,
    textAlign: "center",
    marginTop: space.sm,
    marginBottom: space.lg,
  },
  actions: { flexDirection: "row", gap: space.md },
  clearButton: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.card,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
    alignItems: "center",
  },
  clearLabel: { fontSize: font.body, fontWeight: "600", color: color.ink },
  doneWrap: { flex: 1 },
  pressed: { opacity: 0.6 },
});
