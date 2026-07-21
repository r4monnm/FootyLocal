"use server";

import { redirect } from "next/navigation";
import { reportSchema } from "@footylocal/core";
import { createClient } from "@/lib/supabase/server";

export async function submitReportAction(formData: FormData): Promise<void> {
  const reportedId = formData.get("reportedId") ? String(formData.get("reportedId")) : null;
  const gameId = formData.get("gameId") ? String(formData.get("gameId")) : null;
  const parsed = reportSchema.safeParse({
    reason: String(formData.get("reason")),
    details: formData.get("details") ? String(formData.get("details")) : undefined,
  });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  if (!parsed.success) redirect(`/report?error=1`);

  await supabase.from("reports").insert({
    reporter_id: user.id,
    reported_id: reportedId,
    game_id: gameId,
    reason: parsed.data.reason,
    details: parsed.data.details ?? null,
  });
  redirect(`/report?sent=1`);
}
