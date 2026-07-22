"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@footylocal/db";
import { createClient } from "@/lib/supabase/server";
import { identityEnabled, createIdentityVerificationSession } from "@/lib/stripe";

export async function startIdentityVerificationAction(): Promise<void> {
  if (!identityEnabled()) redirect("/profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { url, sessionId } = await createIdentityVerificationSession({
    userId: user.id,
    returnUrl: `${base}/profile?identity=done`,
  });

  const svc = createServiceClient();
  await svc
    .from("profiles")
    .update({ stripe_identity_session_id: sessionId })
    .eq("id", user.id);

  redirect(url);
}
