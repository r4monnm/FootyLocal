"use server";

import { redirect } from "next/navigation";
import { friendlyGameError } from "@footylocal/core";
import { createClient } from "@/lib/supabase/server";
import { settleCancellation } from "@/lib/payments/settle";

export async function cancelGameAction(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data, error } = await supabase.rpc("cancel_game", { p_game_id: gameId });
  if (error) {
    redirect(`/game/${gameId}?error=${encodeURIComponent(friendlyGameError(error.message))}`);
  }
  const rows = (data ?? []) as { payment_intent_id: string | null; paid: boolean }[];
  await settleCancellation(rows);
  redirect(`/game/${gameId}`);
}
