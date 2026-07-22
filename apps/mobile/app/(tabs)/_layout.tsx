import { Tabs } from "expo-router";
import { colors } from "../../theme";
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.ink, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.surface } }}>
      <Tabs.Screen name="discover" options={{ title: "Discover" }} />
      <Tabs.Screen name="my-games" options={{ title: "My Games" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
