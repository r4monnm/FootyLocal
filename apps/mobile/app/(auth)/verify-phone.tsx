import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { otpSchema } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { AuthScreen, Wordmark, AuthHeading, PillField, GradientButton, ErrorText } from "../../components/ui";
import { colors, font, space } from "../../theme";

export default function VerifyPhone() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    const parsed = otpSchema.safeParse({ code });
    if (!parsed.success) { setError(parsed.error.issues[0]!.message); return; }
    if (code !== "000000") { setError("Invalid code"); return; } // dev stub
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("mark_phone_verified");
    setBusy(false);
    if (error) setError("Couldn't verify. Try again.");
    else router.replace("/(tabs)/discover");
  }
  return (
    <AuthScreen>
      <Wordmark />
      <AuthHeading title="Verify your phone" subtitle="Players who join games are phone-verified. Enter 000000 while SMS is stubbed." />
      {error && <ErrorText>{error}</ErrorText>}
      <PillField placeholder="6-digit code" keyboardType="number-pad" value={code} onChangeText={setCode} maxLength={6} textAlign="center" />
      <View style={{ marginTop: space(2) }}>
        <GradientButton label={busy ? "Verifying…" : "Verify"} onPress={submit} disabled={busy} />
      </View>
      <Pressable onPress={() => router.replace("/(tabs)/discover")} style={{ alignItems: "center", marginTop: space(3) }} hitSlop={8}>
        <Text style={{ color: colors.muted, fontFamily: font.body, fontSize: 14 }}>Skip for now</Text>
      </Pressable>
    </AuthScreen>
  );
}
