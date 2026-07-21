import { z } from "zod";
import { SKILL_BANDS } from "../skill/index.js";
import { GAME_FORMATS } from "../game/index.js";
import { GAME_BANDS } from "../skill/index.js";

/** Signup requires an explicit 18+ attestation (literal true). */
export const signUpSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(10, "Use a password of at least 10 characters."),
  is18Plus: z.literal(true, {
    errorMap: () => ({
      message: "You must confirm you're 18 or older to create an account.",
    }),
  }),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

/** E.164 phone, e.g. +14045551234. */
export const phoneSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone in E.164"),
});
export type PhoneInput = z.infer<typeof phoneSchema>;

/** 6-digit OTP code. */
export const otpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});
export type OtpInput = z.infer<typeof otpSchema>;

export const profileUpdateSchema = z.object({
  displayName: z.string().min(2).max(40),
  selfReportedSkill: z.enum(SKILL_BANDS),
});
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

/**
 * Map a raw Supabase/GoTrue auth error message to safe, user-facing copy.
 * Prevents leaking internal details (and account-enumeration signals) while
 * still giving the user something actionable. Unknown messages collapse to a
 * generic fallback rather than being echoed verbatim.
 */
export function friendlyAuthError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "That email is already registered — try signing in instead.";
  }
  if (m.includes("rate limit")) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  return "Something went wrong. Please try again.";
}

/** Validates a hosted-game submission. Dates are coerced from datetime-local /
 * ISO strings. Fuzzing/geography are applied server-side, not here. */
export const gameCreateSchema = z
  .object({
    title: z.string().min(2).max(80),
    description: z.string().max(500).optional(),
    venueId: z.string().uuid(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    skillBand: z.enum(GAME_BANDS),
    format: z.enum(GAME_FORMATS),
    maxPlayers: z.number().int().min(2).max(64),
    minPlayersToConfirm: z.number().int().min(2).max(64),
    isWomenOnly: z.boolean(),
    priceCents: z.number().int().min(0).default(0),
  })
  .refine((d) => d.endsAt > d.startsAt, {
    message: "End time must be after the start time.",
    path: ["endsAt"],
  })
  .refine((d) => d.startsAt.getTime() > Date.now(), {
    message: "Start time must be in the future.",
    path: ["startsAt"],
  })
  .refine((d) => d.minPlayersToConfirm <= d.maxPlayers, {
    message: "Min players to confirm can't exceed max players.",
    path: ["minPlayersToConfirm"],
  });
export type GameCreateInput = z.infer<typeof gameCreateSchema>;

/** Map a raw join/leave RPC error to safe, user-facing copy. */
export function friendlyGameError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("verify")) return "Verify your phone before joining a game.";
  if (m.includes("full")) return "This game is full — no spots left.";
  if (m.includes("already")) return "You're already on this game's roster.";
  if (m.includes("not open")) return "This game isn't open to join right now.";
  if (m.includes("host")) return "The host can't leave their own game.";
  if (m.includes("not on this roster")) return "You're not on this game's roster.";
  return "Couldn't complete that. Please try again.";
}

/** Report reasons — mirrors the DB report_reason enum. */
export const REPORT_REASONS = [
  "harassment",
  "no_show",
  "unsafe_behavior",
  "fake_profile",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Post-game rating input (serialized into skill_score jsonb + flags server-side). */
export const ratingInputSchema = z.object({
  skill: z.number().int().min(1).max(5),
  sportsmanship: z.number().int().min(1).max(5),
  showedUp: z.boolean(),
  isHostRating: z.boolean(),
});
export type RatingInput = z.infer<typeof ratingInputSchema>;

/** Report submission. */
export const reportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  details: z.string().max(500).optional(),
});
export type ReportInput = z.infer<typeof reportSchema>;
