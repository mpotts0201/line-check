import { Text, View } from "react-native";

import ScreenWrapper from "@/src/components/ScreenWrapper";

export default function Index() {
  return (
    <ScreenWrapper>
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text>Edit app/index.tsx to edit this screen.</Text>
      </View>
    </ScreenWrapper>
  );
}
