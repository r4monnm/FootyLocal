import { describe, it, expect } from "vitest";
import { SKILL_BANDS, skillRank, meetsBand } from "./index.js";
import { computeTier, MIN_RATINGS_FOR_TIER } from "./index.js";

describe("skillRank", () => {
  it("orders beginner < intermediate < advanced < pro", () => {
    expect(skillRank("beginner")).toBeLessThan(skillRank("intermediate"));
    expect(skillRank("intermediate")).toBeLessThan(skillRank("advanced"));
    expect(skillRank("advanced")).toBeLessThan(skillRank("pro"));
  });
  it("covers exactly the four bands", () => {
    expect(SKILL_BANDS).toEqual(["beginner", "intermediate", "advanced", "pro"]);
  });
});

describe("meetsBand", () => {
  it("lets anyone into an open game", () => {
    expect(meetsBand("beginner", "open")).toBe(true);
  });
  it("admits players at or above the game band", () => {
    expect(meetsBand("advanced", "intermediate")).toBe(true);
    expect(meetsBand("intermediate", "intermediate")).toBe(true);
  });
  it("gates players below the game band", () => {
    expect(meetsBand("beginner", "advanced")).toBe(false);
  });
});

describe("computeTier", () => {
  it("uses self-reported below the ratings threshold", () => {
    expect(computeTier(4.5, MIN_RATINGS_FOR_TIER - 1, "beginner")).toEqual({ band: "beginner", source: "self" });
  });
  it("falls back to beginner when there is no self band and too few ratings", () => {
    expect(computeTier(null, 0, null)).toEqual({ band: "beginner", source: "self" });
  });
  it("uses peer band at/above the threshold, by cutoff", () => {
    expect(computeTier(1.9, 3, "pro")).toEqual({ band: "beginner", source: "peer" });
    expect(computeTier(2, 3, null)).toEqual({ band: "intermediate", source: "peer" });
    expect(computeTier(3, 5, null)).toEqual({ band: "advanced", source: "peer" });
    expect(computeTier(4, 10, null)).toEqual({ band: "pro", source: "peer" });
    expect(computeTier(4.9, 4, null)).toEqual({ band: "pro", source: "peer" });
  });
  it("uses self-reported when avg is null even with enough ratings", () => {
    expect(computeTier(null, 5, "advanced")).toEqual({ band: "advanced", source: "self" });
  });
});
