import { Tabs } from "expo-router";
import { colors } from "../../theme";
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.accent,
      tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { backgroundColor: colors.gray, borderTopColor: colors.border },
    }}>
      <Tabs.Screen name="discover" options={{ title: "Discover" }} />
      <Tabs.Screen name="my-games" options={{ title: "My Games" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
