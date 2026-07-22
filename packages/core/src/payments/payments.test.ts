import { describe, it, expect } from "vitest";
import { platformFeeCents, isValidPriceCents, PRICE_FLOOR_CENTS } from "./index.js";

describe("platformFeeCents", () => {
  it("is 10% of the price", () => {
    expect(platformFeeCents(500)).toBe(50);
    expect(platformFeeCents(1000)).toBe(100);
    expect(platformFeeCents(0)).toBe(0);
  });
  it("rounds to the nearest cent", () => {
    expect(platformFeeCents(555)).toBe(56); // 55.5 -> 56
  });
});

describe("isValidPriceCents", () => {
  it("allows free ($0)", () => {
    expect(isValidPriceCents(0)).toBe(true);
  });
  it("rejects 1..floor-1", () => {
    expect(isValidPriceCents(1)).toBe(false);
    expect(isValidPriceCents(PRICE_FLOOR_CENTS - 1)).toBe(false);
  });
  it("allows the floor and above", () => {
    expect(isValidPriceCents(PRICE_FLOOR_CENTS)).toBe(true);
    expect(isValidPriceCents(2000)).toBe(true);
  });
});
