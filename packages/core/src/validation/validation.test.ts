import { describe, it, expect } from "vitest";
import {
  signUpSchema,
  phoneSchema,
  otpSchema,
  friendlyAuthError,
} from "./index.js";
import { gameCreateSchema } from "./index.js";
import { friendlyGameError } from "./index.js";
import { ratingInputSchema, reportSchema, REPORT_REASONS } from "./index.js";

describe("signUpSchema", () => {
  it("accepts a valid 18+ signup", () => {
    const r = signUpSchema.safeParse({
      email: "a@b.com",
      password: "hunter2hunter2",
      is18Plus: true,
    });
    expect(r.success).toBe(true);
  });
  it("rejects when is18Plus is false, with a human-readable message", () => {
    const r = signUpSchema.safeParse({
      email: "a@b.com",
      password: "hunter2hunter2",
      is18Plus: false,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.message).toBe(
        "You must confirm you're 18 or older to create an account.",
      );
    }
  });
  it("rejects short passwords", () => {
    const r = signUpSchema.safeParse({
      email: "a@b.com",
      password: "short",
      is18Plus: true,
    });
    expect(r.success).toBe(false);
  });
});

describe("phoneSchema", () => {
  it("accepts E.164", () => {
    expect(phoneSchema.safeParse({ phone: "+14045551234" }).success).toBe(true);
  });
  it("rejects non-E.164", () => {
    expect(phoneSchema.safeParse({ phone: "404-555-1234" }).success).toBe(false);
  });
});

describe("otpSchema", () => {
  it("accepts a 6-digit code", () => {
    expect(otpSchema.safeParse({ code: "000000" }).success).toBe(true);
  });
  it("rejects non-6-digit codes", () => {
    expect(otpSchema.safeParse({ code: "12ab" }).success).toBe(false);
  });
});

describe("friendlyAuthError", () => {
  it("maps invalid credentials to friendly copy", () => {
    expect(friendlyAuthError("Invalid login credentials")).toBe(
      "Incorrect email or password.",
    );
  });
  it("maps an already-registered email", () => {
    expect(friendlyAuthError("User already registered")).toMatch(
      /already registered/i,
    );
  });
  it("maps rate-limit errors to a wait message", () => {
    expect(friendlyAuthError("email rate limit exceeded")).toMatch(
      /wait a few minutes/i,
    );
  });
  it("never leaks an unrecognized raw message", () => {
    expect(friendlyAuthError("pq: relation does not exist")).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

describe("gameCreateSchema", () => {
  const base = {
    title: "Sunday 5s",
    venueId: "11111111-1111-1111-1111-111111111111",
    startsAt: "2999-06-01T10:00:00.000Z",
    endsAt: "2999-06-01T11:00:00.000Z",
    skillBand: "intermediate",
    format: "five_a_side",
    maxPlayers: 10,
    minPlayersToConfirm: 6,
    isWomenOnly: false,
    priceCents: 0,
  };
  it("accepts a valid future game", () => {
    expect(gameCreateSchema.safeParse(base).success).toBe(true);
  });
  it("rejects end before start", () => {
    const r = gameCreateSchema.safeParse({ ...base, endsAt: "2999-06-01T09:00:00.000Z" });
    expect(r.success).toBe(false);
  });
  it("rejects a start in the past", () => {
    const r = gameCreateSchema.safeParse({ ...base, startsAt: "2000-01-01T10:00:00.000Z", endsAt: "2000-01-01T11:00:00.000Z" });
    expect(r.success).toBe(false);
  });
  it("rejects minPlayersToConfirm above maxPlayers", () => {
    const r = gameCreateSchema.safeParse({ ...base, minPlayersToConfirm: 20 });
    expect(r.success).toBe(false);
  });
  it("rejects an invalid venue id", () => {
    const r = gameCreateSchema.safeParse({ ...base, venueId: "not-a-uuid" });
    expect(r.success).toBe(false);
  });
  it("rejects a paid price below the $5 floor", () => {
    expect(gameCreateSchema.safeParse({ ...base, priceCents: 300 }).success).toBe(false);
  });
  it("allows free and >=$5", () => {
    expect(gameCreateSchema.safeParse({ ...base, priceCents: 0 }).success).toBe(true);
    expect(gameCreateSchema.safeParse({ ...base, priceCents: 500 }).success).toBe(true);
  });
});

describe("friendlyGameError", () => {
  it("maps phone-verify errors", () => {
    expect(friendlyGameError("you must verify your phone to join")).toMatch(/verify your phone/i);
  });
  it("maps full games", () => {
    expect(friendlyGameError("this game is full")).toMatch(/full/i);
  });
  it("maps already-joined", () => {
    expect(friendlyGameError("you are already on this roster")).toMatch(/already/i);
  });
  it("maps host-cannot-leave", () => {
    expect(friendlyGameError("the host cannot leave their own game")).toMatch(/host/i);
  });
  it("falls back generically for unknown errors", () => {
    expect(friendlyGameError("pq: deadlock detected")).toBe("Couldn't complete that. Please try again.");
  });
});

describe("ratingInputSchema", () => {
  const base = { skill: 4, sportsmanship: 5, showedUp: true, isHostRating: false };
  it("accepts a valid rating", () => {
    expect(ratingInputSchema.safeParse(base).success).toBe(true);
  });
  it("rejects skill out of 1..5", () => {
    expect(ratingInputSchema.safeParse({ ...base, skill: 0 }).success).toBe(false);
    expect(ratingInputSchema.safeParse({ ...base, skill: 6 }).success).toBe(false);
  });
  it("rejects non-integer scores", () => {
    expect(ratingInputSchema.safeParse({ ...base, sportsmanship: 3.5 }).success).toBe(false);
  });
});

describe("reportSchema", () => {
  it("accepts a valid reason", () => {
    expect(reportSchema.safeParse({ reason: "harassment", details: "x" }).success).toBe(true);
  });
  it("allows omitting details", () => {
    expect(reportSchema.safeParse({ reason: "no_show" }).success).toBe(true);
  });
  it("rejects an unknown reason", () => {
    expect(reportSchema.safeParse({ reason: "banana" }).success).toBe(false);
  });
  it("exposes the DB report_reason values", () => {
    expect(REPORT_REASONS).toEqual([
      "harassment", "no_show", "unsafe_behavior", "fake_profile", "other",
    ]);
  });
});
