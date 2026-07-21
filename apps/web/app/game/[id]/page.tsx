import Link from "next/link";
import { googleDirectionsUrl } from "@footylocal/core";
import { Badge, Button } from "@footylocal/ui";
import { createClient } from "@/lib/supabase/server";
import { GameLocationMap } from "./GameLocationMap";
import { joinAction, leaveAction } from "./actions";
import { blockAction } from "./trust-actions";

type RosterEntry = { player_id: string; name: string | null; role: string };
type Detail = {
  id: string;
  title: string;
  description: string | null;
  skill_band: string;
  format: string;
  starts_at: string;
  ends_at: string;
  is_women_only: boolean;
  max_players: number;
  status: string;
  host_id: string;
  host_name: string | null;
  venue_name: string;
  venue_address: string;
  surface_type: string;
  joined_count: number;
  viewer_joined: boolean;
  precise_lat: number | null;
  precise_lng: number | null;
  roster: RosterEntry[] | null;
};

export default async function GamePage({
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
  const game = (rows?.[0] ?? null) as Detail | null;
  if (!game) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-neutral-600">Game not found.</p>
        <Link href="/discover" className="text-sm uppercase underline">← Discover</Link>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  let phoneVerified = false;
  if (user) {
    const { data } = await supabase.from("profiles").select("phone_verified").eq("id", user.id).single();
    phoneVerified = data?.phone_verified ?? false;
  }

  const spots = game.max_players - Number(game.joined_count);
  const isHost = user?.id === game.host_id;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <Link href="/discover" className="text-xs uppercase text-neutral-500">← Discover</Link>

      <div className="flex items-center justify-between">
        <h1 className="display text-5xl">{game.title}</h1>
        <Badge tone="accent">{game.skill_band}</Badge>
      </div>

      {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}

      <div className="flex flex-col gap-1 text-sm text-neutral-600">
        <span className="text-ink">{game.venue_name}</span>
        <span>{game.venue_address}</span>
        <span>{game.surface_type} · {game.format.replace(/_/g, " ")}</span>
        <span>{new Date(game.starts_at).toLocaleString()} – {new Date(game.ends_at).toLocaleTimeString()}</span>
        <span>host: {game.host_name ?? "—"}</span>
        <span>{spots} of {game.max_players} spots left</span>
        {game.is_women_only && <span>women-only</span>}
      </div>

      {!isHost && (
        <div className="flex gap-3 text-xs">
          <a className="uppercase underline text-neutral-500"
             href={`/report?reported=${game.host_id}&game=${game.id}`}>Report host</a>
          <form>
            <input type="hidden" name="userId" value={game.host_id} />
            <input type="hidden" name="gameId" value={game.id} />
            <button formAction={blockAction} className="uppercase underline text-neutral-500">Block host</button>
          </form>
        </div>
      )}

      {game.description && <p className="text-neutral-700">{game.description}</p>}

      {game.viewer_joined ? (
        <section className="flex flex-col gap-4">
          <h2 className="display text-2xl">You're in</h2>
          {game.precise_lat != null && game.precise_lng != null && (
            <>
              <GameLocationMap lat={game.precise_lat} lng={game.precise_lng} />
              <a
                className="text-sm font-semibold uppercase underline"
                href={googleDirectionsUrl(game.precise_lat, game.precise_lng)}
                target="_blank"
                rel="noreferrer"
              >
                Open in Google Maps →
              </a>
            </>
          )}
          <div>
            <h3 className="text-xs uppercase text-neutral-500">Roster</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {(game.roster ?? []).map((r) => (
                <li key={r.player_id} className="flex items-center justify-between text-sm">
                  <span>{r.name ?? "Player"} {r.role === "host" && <span className="text-neutral-400">· host</span>}</span>
                  {user && r.player_id !== user.id && r.role !== "host" && (
                    <span className="flex gap-2 text-xs text-neutral-400">
                      <a className="uppercase underline" href={`/report?reported=${r.player_id}&game=${game.id}`}>Report</a>
                      <form>
                        <input type="hidden" name="userId" value={r.player_id} />
                        <input type="hidden" name="gameId" value={game.id} />
                        <button formAction={blockAction} className="uppercase underline">Block</button>
                      </form>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {!isHost && (
            <form>
              <input type="hidden" name="gameId" value={game.id} />
              <button formAction={leaveAction} className="rounded-[var(--radius-pill)] border border-ink px-6 py-3 text-sm font-semibold uppercase">
                Leave game
              </button>
            </form>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <p className="text-xs text-neutral-500">
            Approximate area only. The exact pitch and directions appear once you join.
          </p>
          {game.status !== "open" ? (
            <p className="text-sm text-neutral-600">This game isn't open for joining.</p>
          ) : spots <= 0 ? (
            <p className="text-sm text-neutral-600">This game is full.</p>
          ) : !phoneVerified ? (
            <Link href="/verify-phone" className="text-sm font-semibold uppercase text-ink underline">
              Verify your phone to join →
            </Link>
          ) : (
            <form>
              <input type="hidden" name="gameId" value={game.id} />
              <Button variant="accent" formAction={joinAction}>Join game</Button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
