"use server";

import { redirect } from "next/navigation";
import { gameCreateSchema, friendlyAuthError } from "@footylocal/core";
import { createGame } from "@footylocal/db/games";
import { createClient } from "@/lib/supabase/server";

export async function hostGameAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("phone_verified")
    .eq("id", user.id)
    .single();
  if (!profile?.phone_verified) redirect("/verify-phone");

  const parsed = gameCreateSchema.safeParse({
    title: String(formData.get("title")),
    description: formData.get("description")
      ? String(formData.get("description"))
      : undefined,
    venueId: String(formData.get("venueId")),
    startsAt: String(formData.get("startsAt")),
    endsAt: String(formData.get("endsAt")),
    skillBand: String(formData.get("skillBand")),
    format: String(formData.get("format")),
    maxPlayers: Number(formData.get("maxPlayers")),
    minPlayersToConfirm: Number(formData.get("minPlayersToConfirm")),
    isWomenOnly: formData.get("isWomenOnly") === "on",
    priceCents: Math.round(Number(formData.get("priceUsd") ?? 0) * 100),
  });
  if (!parsed.success) {
    redirect(`/host?error=${encodeURIComponent(parsed.error.issues[0]!.message)}`);
  }

  if (parsed.data.priceCents > 0) {
    const { data: pay } = await supabase
      .from("profiles")
      .select("stripe_charges_enabled")
      .eq("id", user.id)
      .single();
    if (!pay?.stripe_charges_enabled) {
      redirect(`/profile?payouts=required`);
    }
  }

  try {
    await createGame(user.id, parsed.data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "create failed";
    redirect(`/host?error=${encodeURIComponent(friendlyAuthError(msg))}`);
  }
  redirect("/discover");
}
