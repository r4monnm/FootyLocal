import { useState } from "react";
import { Pressable, View, Text } from "react-native";
import { useRouter, Link } from "expo-router";
import { signUpSchema, friendlyAuthError } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { Screen, Title, Field, Button, ErrorText, Muted } from "../../components/ui";
import { colors, space } from "../../theme";

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
    <Screen>
      <Title>Create account</Title>
      {error && <ErrorText>{error}</ErrorText>}
      <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <Field label="Password (min 10 chars)" secureTextEntry value={password} onChangeText={setPassword} />
      <Pressable onPress={() => setIs18(!is18)} style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.ink, backgroundColor: is18 ? colors.accent : colors.surface }} />
        <Text style={{ color: colors.ink }}>I confirm I am 18 or older</Text>
      </Pressable>
      <Button label={busy ? "…" : "Create account"} onPress={submit} disabled={busy} variant="accent" />
      <Link href="/(auth)/sign-in"><Muted>Already have an account? Sign in →</Muted></Link>
    </Screen>
  );
}
