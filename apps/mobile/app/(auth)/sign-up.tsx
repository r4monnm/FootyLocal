import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { signUpSchema, friendlyAuthError } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { AuthScreen, Wordmark, AuthHeading, PillField, GradientButton, Checkbox, ErrorText, AuthFooterLink } from "../../components/ui";
import { space } from "../../theme";

export default function SignUp() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [is18, setIs18] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    const parsed = signUpSchema.safeParse({ email, password, is18Plus: is18 });
    if (!parsed.success) { setError(parsed.error.issues[0]!.message); return; }
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { is_18_plus: true } } });
    setBusy(false);
    if (error) setError(friendlyAuthError(error.message));
    else router.replace("/(auth)/verify-phone");
  }
  return (
    <AuthScreen>
      <Wordmark />
      <AuthHeading title="Create an Account" subtitle="Provide your email and set a password to start playing." />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={{ gap: space(3) }}>
        <PillField placeholder="Email address" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <PillField placeholder="Password (min 10 characters)" secureToggle value={password} onChangeText={setPassword} />
      </View>
      <View style={{ marginTop: space(1) }}>
        <Checkbox checked={is18} onToggle={() => setIs18(!is18)} label="I confirm I am 18 or older" />
      </View>
      <View style={{ marginTop: space(2) }}>
        <GradientButton label={busy ? "Creating…" : "Sign Up"} onPress={submit} disabled={busy} />
      </View>
      <AuthFooterLink prompt="Already have an account?" action="Log In" onPress={() => router.push("/(auth)/sign-in")} />
    </AuthScreen>
  );
}
