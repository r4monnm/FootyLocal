"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@footylocal/db";
import { createClient } from "@/lib/supabase/server";
import { createPaidJoinCheckout } from "@/lib/stripe";

export async function joinPaidAction(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId"));
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

  const { data: rows } = await supabase.rpc("game_detail", { p_game_id: gameId });
  const game = rows?.[0] as
    | { title: string; status: string; price_cents: number; max_players: number; joined_count: number; viewer_joined: boolean; host_id: string }
    | undefined;
  if (!game) redirect("/discover");
  if (game.viewer_joined) redirect(`/game/${gameId}`);
  if (game.status !== "open" || game.max_players - Number(game.joined_count) <= 0) {
    redirect(`/game/${gameId}?error=${encodeURIComponent("This game can't be joined right now.")}`);
  }

  // Host account (service read — not exposed to the client).
  const svc = createServiceClient();
  const { data: host } = await svc
    .from("profiles")
    .select("stripe_account_id, stripe_charges_enabled")
    .eq("id", game.host_id)
    .single();
  if (!host?.stripe_charges_enabled || !host.stripe_account_id) {
    redirect(`/game/${gameId}?error=${encodeURIComponent("This host can't accept payments yet.")}`);
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const url = await createPaidJoinCheckout({
    gameId,
    playerId: user.id,
    title: game.title,
    priceCents: game.price_cents,
    hostAccountId: host.stripe_account_id,
    successUrl: `${base}/game/${gameId}?paid=success`,
    cancelUrl: `${base}/game/${gameId}?paid=cancel`,
  });
  redirect(url);
}
