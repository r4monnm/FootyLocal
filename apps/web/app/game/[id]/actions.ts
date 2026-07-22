"use server";

import { redirect } from "next/navigation";
import { friendlyGameError } from "@footylocal/core";
import { createClient } from "@/lib/supabase/server";
import { settleConfirmation, settleLeave } from "@/lib/payments/settle";

export async function joinAction(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data, error } = await supabase.rpc("join_game", { p_game_id: gameId });
  if (error) {
    if (error.message.toLowerCase().includes("verify")) redirect("/verify-phone");
    redirect(`/game/${gameId}?error=${encodeURIComponent(friendlyGameError(error.message))}`);
  }
  if (data === "joined") {
    await settleConfirmation(gameId);
  }
  redirect(`/game/${gameId}`);
}

export async function leaveAction(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data, error } = await supabase.rpc("leave_game", { p_game_id: gameId });
  if (error) {
    redirect(`/game/${gameId}?error=${encodeURIComponent(friendlyGameError(error.message))}`);
  }
  const row = (data ?? [])[0] as
    | { payment_intent_id: string | null; paid: boolean; starts_at: string; was_joined: boolean }
    | undefined;
  if (row) {
    await settleLeave(row, gameId);
  }
  redirect(`/game/${gameId}`);
}
