/** Game formats + discovery filter serialization. */
import type { GameBand } from "../skill/index.js";

export const GAME_FORMATS = [
  "five_a_side",
  "seven_a_side",
  "eleven_a_side",
  "other",
] as const;
export type GameFormat = (typeof GAME_FORMATS)[number];

export type DiscoverFilters = {
  skillBand?: GameBand;
  format?: GameFormat;
  priceMaxCents?: number;
  startsAfter?: string; // ISO
  startsBefore?: string; // ISO
  womenOnly?: boolean;
  radiusMeters: number;
};

/** Serialize UI filter state into the `games_near` jsonb argument. `radiusMeters`
 * is passed as a separate RPC arg, not in the jsonb, so it is not included. */
export function toGamesNearFilters(f: DiscoverFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.skillBand) out.skill_band = f.skillBand;
  if (f.format) out.format = f.format;
  if (f.priceMaxCents != null) out.price_max_cents = f.priceMaxCents;
  if (f.startsAfter) out.starts_after = f.startsAfter;
  if (f.startsBefore) out.starts_before = f.startsBefore;
  if (f.womenOnly) out.women_only = true;
  return out;
}

/** Google Maps directions deep link to a destination (turn-by-turn from the
 * viewer's current location). */
export function googleDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
