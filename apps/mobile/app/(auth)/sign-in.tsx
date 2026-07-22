import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { friendlyAuthError } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { AuthScreen, Wordmark, AuthHeading, PillField, GradientButton, ErrorText, AuthFooterLink } from "../../components/ui";
import { space } from "../../theme";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(friendlyAuthError(error.message));
    else router.replace("/(tabs)/discover");
  }
  return (
    <AuthScreen>
      <Wordmark />
      <AuthHeading title="Welcome back" subtitle="Sign in to find pickup games near you." />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={{ gap: space(3) }}>
        <PillField placeholder="Email address" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <PillField placeholder="Password" secureToggle value={password} onChangeText={setPassword} />
      </View>
      <View style={{ marginTop: space(2) }}>
        <GradientButton label={busy ? "Signing in…" : "Sign In"} onPress={submit} disabled={busy} />
      </View>
      <AuthFooterLink prompt="New here?" action="Create an account" onPress={() => router.push("/(auth)/sign-up")} />
    </AuthScreen>
  );
}
