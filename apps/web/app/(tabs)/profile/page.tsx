import { Badge } from "@footylocal/ui";
import { createClient } from "@/lib/supabase/server";
import { unblockAction } from "./actions";

export default async function Profile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName: string | null = null;
  let phoneVerified = false;
  let stats = { games_played: 0, karma: 0, avg_skill: null as number | null, ratings_count: 0 };
  let blocked: { blocked_id: string; name: string | null }[] = [];

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, phone_verified")
      .eq("id", user.id)
      .single();
    displayName = profile?.display_name ?? null;
    phoneVerified = profile?.phone_verified ?? false;

    const { data: s } = await supabase.rpc("profile_stats", { p_user_id: user.id });
    if (s?.[0]) stats = s[0];

    // Two-step (avoids depending on the exact PostgREST FK-embed name):
    const { data: b } = await supabase
      .from("blocks")
      .select("blocked_id")
      .eq("blocker_id", user.id);
    const ids = (b ?? []).map((r: { blocked_id: string }) => r.blocked_id);
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      const nameById = new Map(
        (profs ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name]),
      );
      blocked = ids.map((id) => ({ blocked_id: id, name: nameById.get(id) ?? null }));
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="display text-6xl">{displayName ?? "Profile"}</h1>
      <div className="flex flex-wrap gap-2">
        {phoneVerified ? <Badge tone="accent">phone verified</Badge> : <Badge>unverified</Badge>}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Karma", value: Number(stats.karma) },
          { label: "Games", value: Number(stats.games_played) },
          { label: "Avg skill", value: stats.avg_skill != null ? Number(stats.avg_skill).toFixed(1) : "—" },
        ].map((s) => (
          <div key={s.label} className="rounded-[var(--radius-card)] bg-gray p-4 text-center">
            <div className="display text-3xl">{s.value}</div>
            <div className="text-xs uppercase text-neutral-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-xs uppercase text-neutral-500">Blocked users</h2>
        {blocked.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">You haven't blocked anyone.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {blocked.map((b) => (
              <li key={b.blocked_id} className="flex items-center justify-between text-sm">
                <span>{b.name ?? "User"}</span>
                <form>
                  <input type="hidden" name="userId" value={b.blocked_id} />
                  <button formAction={unblockAction} className="text-xs uppercase underline">Unblock</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
