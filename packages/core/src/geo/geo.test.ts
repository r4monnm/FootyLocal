import { describe, it, expect } from "vitest";
import {
  distanceMeters,
  fuzzToPublicPoint,
  publicDisplayCircle,
  roundPublicDistance,
} from "./index.js";

// A real pitch (Atlanta area) used across tests.
const precise = { lat: 33.749, lng: -84.388 };
const gameId = "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8";

describe("distanceMeters", () => {
  it("is ~0 for identical points", () => {
    expect(distanceMeters(precise, precise)).toBeLessThan(0.001);
  });
  it("matches a known ~1.11km-per-0.01deg-lat span within 1%", () => {
    const d = distanceMeters(precise, { lat: precise.lat + 0.01, lng: precise.lng });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
  });
});

describe("fuzzToPublicPoint", () => {
  it("is deterministic: same input yields identical output", () => {
    expect(fuzzToPublicPoint(precise, gameId)).toEqual(
      fuzzToPublicPoint(precise, gameId),
    );
  });
  it("does not return the exact precise point", () => {
    const p = fuzzToPublicPoint(precise, gameId);
    expect(distanceMeters(precise, p)).toBeGreaterThan(0);
  });
  it("stays within the fuzz band (<= 1600m) of the true point", () => {
    const p = fuzzToPublicPoint(precise, gameId);
    expect(distanceMeters(precise, p)).toBeLessThanOrEqual(1600);
  });
  it("gives different public points for different game ids", () => {
    const a = fuzzToPublicPoint(precise, gameId);
    const b = fuzzToPublicPoint(precise, "00000000-1111-2222-3333-444444444444");
    expect(a).not.toEqual(b);
  });
});

describe("publicDisplayCircle", () => {
  it("centers the circle OFF the true point but within the radius", () => {
    const c = publicDisplayCircle(precise, gameId);
    const offset = distanceMeters(precise, c.center);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(c.radiusMeters);
  });
  it("is deterministic", () => {
    expect(publicDisplayCircle(precise, gameId)).toEqual(
      publicDisplayCircle(precise, gameId),
    );
  });
});

describe("roundPublicDistance", () => {
  it("coarsens distances into human buckets", () => {
    expect(roundPublicDistance(120)).toBe("under 500 m away");
    expect(roundPublicDistance(1850)).toBe("about 2 km away");
    expect(roundPublicDistance(9400)).toBe("about 9 km away");
  });
});
