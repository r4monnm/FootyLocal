/** Server-only game create: fuzzes on the server, writes via the
 * service_role-only create_game RPC. Never import into a client bundle. */
import { randomUUID } from "node:crypto";
import { fuzzToPublicPoint, type GameCreateInput } from "@footylocal/core";
import { createServiceClient } from "./client.js";

export async function createGame(
  hostId: string,
  input: GameCreateInput,
): Promise<string> {
  const supabase = createServiceClient();
  const gameId = randomUUID();

  const { data: rows, error: vErr } = await supabase.rpc("venue_latlng", {
    v_id: input.venueId,
  });
  if (vErr) throw vErr;
  const point = Array.isArray(rows) ? rows[0] : rows;
  if (!point) throw new Error("venue not found or not verified");

  const pub = fuzzToPublicPoint({ lat: point.lat, lng: point.lng }, gameId);

  const { data, error } = await supabase.rpc("create_game", {
    p_game_id: gameId,
    p_host_id: hostId,
    p_venue_id: input.venueId,
    p_title: input.title,
    p_description: input.description ?? null,
    p_starts_at: input.startsAt.toISOString(),
    p_ends_at: input.endsAt.toISOString(),
    p_skill_band: input.skillBand,
    p_format: input.format,
    p_max_players: input.maxPlayers,
    p_min_players_to_confirm: input.minPlayersToConfirm,
    p_is_women_only: input.isWomenOnly,
    p_price_cents: input.priceCents,
    p_public_lat: pub.lat,
    p_public_lng: pub.lng,
  });
  if (error) throw error;
  return (data as string) ?? gameId;
}
