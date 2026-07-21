import { describe, it, expect } from "vitest";
import { SKILL_BANDS, skillRank, meetsBand } from "./index.js";

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
