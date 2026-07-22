"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@footylocal/db";
import { createClient } from "@/lib/supabase/server";
import {
  paymentsEnabled,
  createConnectAccount,
  createAccountLink,
} from "@/lib/stripe";

export async function startOnboardingAction(): Promise<void> {
  if (!paymentsEnabled()) redirect("/profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const svc = createServiceClient();
  const { data: profile } = await svc
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", user.id)
    .single();

  let accountId = profile?.stripe_account_id ?? null;
  if (!accountId) {
    accountId = await createConnectAccount(user.email ?? "");
    await svc.from("profiles").update({ stripe_account_id: accountId }).eq("id", user.id);
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const url = await createAccountLink(
    accountId,
    `${base}/profile?onboarding=done`,
    `${base}/profile`,
  );
  redirect(url);
}
