"use server";

import { redirect } from "next/navigation";
import { signUpSchema, otpSchema, friendlyAuthError } from "@footylocal/core";
import { createClient } from "@/lib/supabase/server";

/** Email + password sign-in. */
export async function signInAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
  if (error) {
    redirect(`/sign-in?error=${encodeURIComponent(friendlyAuthError(error.message))}`);
  }
  redirect("/discover");
}

/** Email + password sign-up with a required 18+ attestation. */
export async function signUpAction(formData: FormData): Promise<void> {
  const parsed = signUpSchema.safeParse({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
    is18Plus: formData.get("is18Plus") === "on",
  });
  if (!parsed.success) {
    redirect(`/sign-in?error=${encodeURIComponent(parsed.error.issues[0]!.message)}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { is_18_plus: true } },
  });
  if (error) {
    redirect(`/sign-in?error=${encodeURIComponent(friendlyAuthError(error.message))}`);
  }
  // Phone verification is required before join/host. Send them to the gate.
  redirect("/verify-phone");
}

/**
 * Dev-stubbed phone verification. In Phase 0 there is no SMS provider: we accept
 * the DEV_PHONE_OTP_CODE and flip profiles.phone_verified. A later phase swaps
 * this for Supabase phone OTP.
 */
export async function verifyPhoneAction(formData: FormData): Promise<void> {
  const parsed = otpSchema.safeParse({ code: String(formData.get("code")) });
  const expected = process.env.DEV_PHONE_OTP_CODE ?? "000000";
  if (!parsed.success || parsed.data.code !== expected) {
    redirect(`/verify-phone?error=${encodeURIComponent("Invalid code")}`);
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  const { error } = await supabase
    .from("profiles")
    .update({ phone_verified: true, verification_level: "phone" })
    .eq("id", user.id);
  if (error) {
    redirect(`/verify-phone?error=${encodeURIComponent(friendlyAuthError(error.message))}`);
  }
  redirect("/discover");
}
