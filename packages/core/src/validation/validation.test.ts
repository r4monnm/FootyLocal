import { describe, it, expect } from "vitest";
import { signUpSchema, phoneSchema, otpSchema } from "./index.js";

describe("signUpSchema", () => {
  it("accepts a valid 18+ signup", () => {
    const r = signUpSchema.safeParse({
      email: "a@b.com",
      password: "hunter2hunter2",
      is18Plus: true,
    });
    expect(r.success).toBe(true);
  });
  it("rejects when is18Plus is false", () => {
    const r = signUpSchema.safeParse({
      email: "a@b.com",
      password: "hunter2hunter2",
      is18Plus: false,
    });
    expect(r.success).toBe(false);
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
