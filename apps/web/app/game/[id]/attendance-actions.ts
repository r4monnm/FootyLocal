"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function markAttendanceAction(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  // Each roster player has a select named att:<playerId> = attended|no_show|skip.
  const attended: string[] = [];
  const noShow: string[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("att:")) continue;
    const playerId = key.slice(4);
    if (value === "attended") attended.push(playerId);
    else if (value === "no_show") noShow.push(playerId);
  }
  const { error } = await supabase.rpc("mark_attendance", {
    p_game_id: gameId,
    p_attended: attended,
    p_no_show: noShow,
  });
  if (error) redirect(`/game/${gameId}?error=${encodeURIComponent("Couldn't save attendance.")}`);
  redirect(`/game/${gameId}`);
}
