import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Anton_400Regular } from "@expo-google-fonts/anton";
import { Inter_400Regular, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { StatusBar } from "expo-status-bar";
import { SessionProvider, useSession } from "../lib/session";
import { colors } from "../theme";

SplashScreen.preventAutoHideAsync();

function Gate() {
  const { session, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === "(auth)";
    if (!session && !inAuth) router.replace("/(auth)/sign-in");
    else if (session && inAuth) router.replace("/(tabs)/discover");
  }, [session, loading, segments]);
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Anton_400Regular, Inter_400Regular, Inter_600SemiBold });
  useEffect(() => { if (fontsLoaded) SplashScreen.hideAsync(); }, [fontsLoaded]);
  if (!fontsLoaded) return null;
  return <SessionProvider><Gate /></SessionProvider>;
}
