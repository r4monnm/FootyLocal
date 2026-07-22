import Link from "next/link";
import { computeTier, meetsBand, googleDirectionsUrl, type SkillBand, type GameBand } from "@footylocal/core";
import { Badge, Button } from "@footylocal/ui";
import { createClient } from "@/lib/supabase/server";
import { paymentsEnabled } from "@/lib/stripe";
import { GameLocationMap } from "./GameLocationMap";
import { joinAction, leaveAction } from "./actions";
import { joinPaidAction } from "./pay-actions";
import { blockAction } from "./trust-actions";
import { cancelGameAction } from "./cancel-actions";
import { markAttendanceAction } from "./attendance-actions";

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
  min_players_to_confirm: number;
  status: string;
  price_cents: number;
  host_id: string;
  host_name: string | null;
  venue_name: string;
  venue_address: string;
  surface_type: string;
  joined_count: number;
  viewer_joined: boolean;
  viewer_status: string | null;
  precise_lat: number | null;
  precise_lng: number | null;
  roster: RosterEntry[] | null;
};

export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; paid?: string }>;
}) {
  const { id } = await params;
  const { error, paid } = await searchParams;
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

  async function tierFor(userId: string) {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.rpc("profile_stats", { p_user_id: userId }),
      supabase.from("profiles").select("self_reported_skill").eq("id", userId).single(),
    ]);
    const stat = s?.[0];
    return computeTier(
      stat?.avg_skill != null ? Number(stat.avg_skill) : null,
      stat ? Number(stat.ratings_count) : 0,
      (p?.self_reported_skill ?? null) as SkillBand | null,
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
  const isWaitlisted = game.viewer_status === "waitlisted";
  const isCancelled = game.status === "cancelled";
  const isConfirmed = game.status === "confirmed";

  const hostTier = await tierFor(game.host_id);
  // Only fetch the viewer's tier when the below-level warning could actually
  // render — avoids 2 wasted DB round trips on already-joined / cancelled /
  // waitlisted / unverified views (the common paths).
  const canWarn =
    !!user &&
    !game.viewer_joined &&
    !isCancelled &&
    !isWaitlisted &&
    phoneVerified &&
    (game.skill_band as GameBand) !== "open";
  const viewerTier = canWarn ? await tierFor(user!.id) : null;
  const belowLevel = !!viewerTier && !meetsBand(viewerTier.band, game.skill_band as GameBand);
  const isHost = user?.id === game.host_id;
  const isPast = new Date(game.ends_at).getTime() < Date.now();
  const isPaid = game.price_cents > 0;
  const priceLabel = isPaid ? ` · $${(game.price_cents / 100).toFixed(0)}` : "";

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <Link href="/discover" className="text-xs uppercase text-neutral-500">← Discover</Link>

      <div className="flex items-center justify-between">
        <h1 className="display text-5xl">{game.title}</h1>
        <Badge tone="accent">{game.skill_band}</Badge>
      </div>

      {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}
      {paid === "cancel" && <p className="text-sm text-neutral-500">Payment canceled — you're not on the roster.</p>}
      {paid === "success" && <p className="text-sm text-[var(--color-success)]">Payment received — confirming your spot…</p>}

      <div className="flex flex-col gap-1 text-sm text-neutral-600">
        <span className="text-ink">{game.venue_name}</span>
        <span>{game.venue_address}</span>
        <span>{game.surface_type} · {game.format.replace(/_/g, " ")}</span>
        <span>{new Date(game.starts_at).toLocaleString()} – {new Date(game.ends_at).toLocaleTimeString()}</span>
        <span>host: {game.host_name ?? "—"} · <span className="uppercase">{hostTier.band}</span></span>
        <span>{spots} of {game.max_players} spots left</span>
        {game.is_women_only && <span>women-only</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {isConfirmed && <Badge tone="accent">confirmed</Badge>}
        {isCancelled && <span className="text-[var(--color-error)]">This game was cancelled.</span>}
        {game.status === "open" && (
          <span className="text-neutral-600">{Number(game.joined_count)} of {game.min_players_to_confirm} to confirm</span>
        )}
      </div>
      {isHost && !isCancelled && (
        <form>
          <input type="hidden" name="gameId" value={game.id} />
          <button formAction={cancelGameAction} className="text-xs uppercase text-[var(--color-error)] underline">
            Cancel game
          </button>
        </form>
      )}

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
          {isHost && isPast && !isCancelled && (
            <form className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-gray p-4">
              <h3 className="text-xs uppercase text-neutral-500">Attendance</h3>
              <input type="hidden" name="gameId" value={game.id} />
              {(game.roster ?? []).filter((r) => r.role !== "host").map((r) => (
                <label key={r.player_id} className="flex items-center justify-between text-sm">
                  <span>{r.name ?? "Player"}</span>
                  <select name={`att:${r.player_id}`} defaultValue="skip" className="rounded-lg bg-gray px-2 py-1 text-xs">
                    <option value="skip">—</option>
                    <option value="attended">attended</option>
                    <option value="no_show">no-show</option>
                  </select>
                </label>
              ))}
              <button formAction={markAttendanceAction} className="rounded-[var(--radius-pill)] bg-ink px-6 py-3 text-sm font-semibold uppercase text-accent">
                Save attendance
              </button>
            </form>
          )}
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
          {isCancelled ? (
            <p className="text-sm text-neutral-600">This game was cancelled.</p>
          ) : isWaitlisted ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-neutral-600">You're on the waitlist. You'll take a spot if one opens.</p>
              <form>
                <input type="hidden" name="gameId" value={game.id} />
                <button formAction={leaveAction} className="rounded-[var(--radius-pill)] border border-ink px-6 py-3 text-sm font-semibold uppercase">
                  Leave waitlist
                </button>
              </form>
            </div>
          ) : !phoneVerified ? (
            <Link href="/verify-phone" className="text-sm font-semibold uppercase text-ink underline">
              Verify your phone to join →
            </Link>
          ) : (
            <>
              {belowLevel && (
                <p className="text-sm text-neutral-500">
                  This game is rated <span className="uppercase">{game.skill_band}</span> — above your{" "}
                  <span className="uppercase">{viewerTier!.band}</span> level. You can still join.
                </p>
              )}
              <form>
                <input type="hidden" name="gameId" value={game.id} />
                {isPaid && paymentsEnabled() ? (
                  <Button variant="accent" formAction={joinPaidAction}>
                    {spots > 0 ? `Join${priceLabel}` : `Join waitlist${priceLabel}`}
                  </Button>
                ) : isPaid ? (
                  <Button variant="accent" disabled>Paid join unavailable</Button>
                ) : (
                  <Button variant="accent" formAction={joinAction}>
                    {spots > 0 ? "Join game" : "Join waitlist"}
                  </Button>
                )}
              </form>
            </>
          )}
        </section>
      )}
    </main>
  );
}
