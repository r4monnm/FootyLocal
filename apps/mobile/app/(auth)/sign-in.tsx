import { useState } from "react";
import { useRouter, Link } from "expo-router";
import { friendlyAuthError } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { Screen, Title, Field, Button, ErrorText, Muted } from "../../components/ui";

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
    <Screen>
      <Title>Sign in</Title>
      {error && <ErrorText>{error}</ErrorText>}
      <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <Button label={busy ? "…" : "Sign in"} onPress={submit} disabled={busy} variant="accent" />
      <Link href="/(auth)/sign-up"><Muted>New here? Create an account →</Muted></Link>
    </Screen>
  );
}
