import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Anton_400Regular } from "@expo-google-fonts/anton";
import { Inter_400Regular, Inter_600SemiBold } from "@expo-google-fonts/inter";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({ Anton_400Regular, Inter_400Regular, Inter_600SemiBold });
  useEffect(() => { if (loaded) SplashScreen.hideAsync(); }, [loaded]);
  if (!loaded) return null;
  return <Stack screenOptions={{ headerShown: false }} />;
}
