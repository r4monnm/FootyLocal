import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ColorValue } from "react-native";
import { colors, font } from "../../theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const icon = (active: IoniconName, inactive: IoniconName) =>
  ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <Ionicons name={focused ? active : inactive} size={size} color={color as string} />
  );

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.accent,
      tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { backgroundColor: colors.gray, borderTopColor: colors.border },
      tabBarLabelStyle: { fontFamily: font.bodySemibold, fontSize: 11 },
    }}>
      <Tabs.Screen name="discover" options={{ title: "Discover", tabBarIcon: icon("football", "football-outline") }} />
      <Tabs.Screen name="my-games" options={{ title: "Fixtures", tabBarIcon: icon("calendar", "calendar-outline") }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: icon("shirt", "shirt-outline") }} />
    </Tabs>
  );
}
