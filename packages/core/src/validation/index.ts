import { z } from "zod";
import { SKILL_BANDS } from "../skill/index.js";

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
