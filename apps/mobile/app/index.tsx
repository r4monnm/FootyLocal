import { Text, View } from "react-native";
import { roundPublicDistance } from "@footylocal/core";
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>FootyLocal — core says: {roundPublicDistance(1234)}</Text>
    </View>
  );
}
