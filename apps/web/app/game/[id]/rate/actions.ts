"use server";

import { redirect } from "next/navigation";
import { ratingInputSchema } from "@footylocal/core";
import { createClient } from "@/lib/supabase/server";

export async function rateAction(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId"));
  const rateeId = String(formData.get("rateeId"));
  const parsed = ratingInputSchema.safeParse({
    skill: Number(formData.get("skill")),
    sportsmanship: Number(formData.get("sportsmanship")),
    showedUp: formData.get("showedUp") === "on",
    isHostRating: formData.get("isHostRating") === "true",
  });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  if (!parsed.success) redirect(`/game/${gameId}/rate?error=1`);

  await supabase.rpc("submit_rating", {
    p_game_id: gameId,
    p_ratee_id: rateeId,
    p_skill_score: { skill: parsed.data.skill, sportsmanship: parsed.data.sportsmanship },
    p_reliability_up: parsed.data.showedUp,
    p_is_host_rating: parsed.data.isHostRating,
  });
  redirect(`/game/${gameId}/rate`);
}
