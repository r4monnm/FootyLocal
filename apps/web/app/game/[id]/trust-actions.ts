"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Block a user (bidirectional-invisible via games_near/game_detail). */
export async function blockAction(formData: FormData): Promise<void> {
  const blockedId = String(formData.get("userId"));
  const gameId = String(formData.get("gameId"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  if (blockedId && blockedId !== user.id) {
    await supabase
      .from("blocks")
      .upsert({ blocker_id: user.id, blocked_id: blockedId }, { onConflict: "blocker_id,blocked_id" });
  }
  // The blocked host's game is now hidden; go back to Discover.
  redirect(gameId ? `/game/${gameId}` : "/discover");
}
