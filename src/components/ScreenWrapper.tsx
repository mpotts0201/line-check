import { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";

type ScreenWrapperProps = {
  children: ReactNode;
};

/**
 * Root wrapper for every screen. Provides a keyboard-avoiding, scrollable
 * container so screen content stays reachable when the keyboard is open.
 */
export default function ScreenWrapper({ children }: ScreenWrapperProps) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1 },
});
