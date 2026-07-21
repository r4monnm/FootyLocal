"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function unblockAction(formData: FormData): Promise<void> {
  const blockedId = String(formData.get("userId"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  await supabase.from("blocks").delete().eq("blocker_id", user.id).eq("blocked_id", blockedId);
  redirect("/profile");
}
