import type { GameFormat } from "@footylocal/core";

/** One row from the games_near RPC. precise_* are null unless the caller is on
 * the game's roster. */
export type NearbyGame = {
  id: string;
  title: string;
  skill_band: string;
  format: GameFormat;
  price_cents: number;
  starts_at: string;
  is_women_only: boolean;
  max_players: number;
  joined_count: number;
  host_name: string | null;
  public_lat: number;
  public_lng: number;
  precise_lat: number | null;
  precise_lng: number | null;
  distance_meters: number;
};
