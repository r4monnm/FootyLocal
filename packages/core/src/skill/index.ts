/** v1 skill tiers: self-reported band + per-game band gating. */

export const SKILL_BANDS = [
  "beginner",
  "intermediate",
  "advanced",
  "pro",
] as const;
export type SkillBand = (typeof SKILL_BANDS)[number];

export const GAME_BANDS = [...SKILL_BANDS, "open"] as const;
export type GameBand = (typeof GAME_BANDS)[number];

/** Numeric rank of a skill band (higher = stronger). */
export function skillRank(band: SkillBand): number {
  return SKILL_BANDS.indexOf(band);
}

/** Whether a player at `playerSkill` may join a game of `gameBand`. */
export function meetsBand(playerSkill: SkillBand, gameBand: GameBand): boolean {
  if (gameBand === "open") return true;
  return skillRank(playerSkill) >= skillRank(gameBand);
}

/** Minimum peer ratings before a player's tier is peer-derived (vs self-reported). */
export const MIN_RATINGS_FOR_TIER = 3;

function bandFromAvgSkill(avg: number): SkillBand {
  if (avg < 2) return "beginner";
  if (avg < 3) return "intermediate";
  if (avg < 4) return "advanced";
  return "pro";
}

/** A player's displayed skill tier: peer-derived once they have enough ratings,
 * otherwise their self-reported band (default beginner). */
export function computeTier(
  avgSkill: number | null,
  ratingsCount: number,
  selfReported: SkillBand | null,
): { band: SkillBand; source: "peer" | "self" } {
  if (ratingsCount >= MIN_RATINGS_FOR_TIER && avgSkill != null) {
    return { band: bandFromAvgSkill(avgSkill), source: "peer" };
  }
  return { band: selfReported ?? "beginner", source: "self" };
}
