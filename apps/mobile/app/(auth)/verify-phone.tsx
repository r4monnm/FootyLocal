import { useState } from "react";
import { useRouter } from "expo-router";
import { otpSchema } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { Screen, Title, Field, Button, ErrorText, Muted } from "../../components/ui";

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
    <Screen>
      <Title>Verify phone</Title>
      <Muted>Enter 000000 (dev). Real SMS comes later.</Muted>
      {error && <ErrorText>{error}</ErrorText>}
      <Field label="6-digit code" keyboardType="number-pad" value={code} onChangeText={setCode} maxLength={6} />
      <Button label={busy ? "…" : "Verify"} onPress={submit} disabled={busy} variant="accent" />
      <Button label="Skip for now" onPress={() => router.replace("/(tabs)/discover")} variant="outline" />
    </Screen>
  );
}
