import Link from "next/link";
import { Button } from "@footylocal/ui";
import { createClient } from "@/lib/supabase/server";
import { rateAction } from "./actions";

type RosterEntry = { player_id: string; name: string | null; role: string };

export default async function RatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: rows } = await supabase.rpc("game_detail", { p_game_id: id });
  const game = rows?.[0] as
    | { title: string; ends_at: string; viewer_joined: boolean; roster: RosterEntry[] | null }
    | undefined;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!game || !game.viewer_joined) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-neutral-600">You can only rate a game you played in.</p>
        <Link href="/my-games" className="text-sm uppercase underline">← My Games</Link>
      </main>
    );
  }
  const isPast = new Date(game.ends_at).getTime() < Date.now();
  if (!isPast) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-neutral-600">You can rate players once the game has ended.</p>
        <Link href={`/game/${id}`} className="text-sm uppercase underline">← Game</Link>
      </main>
    );
  }

  // The viewer's existing ratings for this game (RLS: rater sees own ratings).
  const { data: mine } = await supabase.from("ratings").select("ratee_id").eq("game_id", id).eq("rater_id", user!.id);
  const rated = new Set((mine ?? []).map((r: { ratee_id: string }) => r.ratee_id));

  const others = (game.roster ?? []).filter((r) => r.player_id !== user!.id);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <Link href="/my-games" className="text-xs uppercase text-neutral-500">← My Games</Link>
      <h1 className="display text-4xl">Rate — {game.title}</h1>
      {error && <p className="text-[var(--color-error)] text-sm">Please complete the rating.</p>}
      <p className="text-sm text-neutral-500">Ratings are anonymous.</p>

      <div className="flex flex-col gap-4">
        {others.map((p) => (
          <div key={p.player_id} className="rounded-[var(--radius-card)] border border-gray p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{p.name ?? "Player"} {p.role === "host" && <span className="text-neutral-400">· host</span>}</span>
              {rated.has(p.player_id) && <span className="text-xs uppercase text-[var(--color-success)]">rated</span>}
            </div>
            <form className="mt-3 flex flex-wrap items-center gap-3">
              <input type="hidden" name="gameId" value={id} />
              <input type="hidden" name="rateeId" value={p.player_id} />
              <input type="hidden" name="isHostRating" value={p.role === "host" ? "true" : "false"} />
              <label className="text-xs uppercase text-neutral-500">Skill
                <select name="skill" defaultValue="3" className="ml-2 rounded-lg bg-gray px-2 py-1">
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="text-xs uppercase text-neutral-500">Sportsmanship
                <select name="sportsmanship" defaultValue="3" className="ml-2 rounded-lg bg-gray px-2 py-1">
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1 text-xs uppercase text-neutral-500">
                <input type="checkbox" name="showedUp" defaultChecked /> showed up
              </label>
              <Button formAction={rateAction}>{rated.has(p.player_id) ? "Update" : "Rate"}</Button>
            </form>
          </div>
        ))}
        {others.length === 0 && <p className="text-neutral-500">No one else to rate.</p>}
      </div>
    </main>
  );
}
