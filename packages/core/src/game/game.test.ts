import { describe, it, expect } from "vitest";
import { GAME_FORMATS, toGamesNearFilters } from "./index.js";
import { googleDirectionsUrl } from "./index.js";

describe("GAME_FORMATS", () => {
  it("matches the DB game_format enum values", () => {
    expect(GAME_FORMATS).toEqual([
      "five_a_side",
      "seven_a_side",
      "eleven_a_side",
      "other",
    ]);
  });
});

describe("toGamesNearFilters", () => {
  it("omits unset keys", () => {
    expect(toGamesNearFilters({ radiusMeters: 5000 })).toEqual({});
  });
  it("maps set keys to the games_near jsonb shape", () => {
    const out = toGamesNearFilters({
      radiusMeters: 5000,
      skillBand: "intermediate",
      format: "five_a_side",
      priceMaxCents: 500,
      startsAfter: "2026-08-01T00:00:00.000Z",
      startsBefore: "2026-08-02T00:00:00.000Z",
      womenOnly: true,
    });
    expect(out).toEqual({
      skill_band: "intermediate",
      format: "five_a_side",
      price_max_cents: 500,
      starts_after: "2026-08-01T00:00:00.000Z",
      starts_before: "2026-08-02T00:00:00.000Z",
      women_only: true,
    });
  });
  it("omits womenOnly when false", () => {
    expect(toGamesNearFilters({ radiusMeters: 5000, womenOnly: false })).toEqual({});
  });
});

describe("googleDirectionsUrl", () => {
  it("builds a Google Maps directions deep link to the destination", () => {
    expect(googleDirectionsUrl(33.749, -84.388)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=33.749,-84.388",
    );
  });
});
