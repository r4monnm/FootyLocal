import { z } from "zod";
import { SKILL_BANDS } from "../skill/index.js";

/** Signup requires an explicit 18+ attestation (literal true). */
export const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Use at least 10 characters"),
  is18Plus: z.literal(true),
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
