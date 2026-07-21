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
