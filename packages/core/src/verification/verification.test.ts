import { describe, it, expect } from "vitest";
import { verificationSummary } from "./index.js";

describe("verificationSummary", () => {
  it("returns none with no badges when nothing is verified", () => {
    expect(verificationSummary({ phone_verified: false, photo_verified: false, id_verified: false }))
      .toEqual({ level: "none", badges: [] });
  });
  it("phone only", () => {
    expect(verificationSummary({ phone_verified: true, photo_verified: false, id_verified: false }))
      .toEqual({ level: "phone", badges: ["phone"] });
  });
  it("phone + photo", () => {
    expect(verificationSummary({ phone_verified: true, photo_verified: true, id_verified: false }))
      .toEqual({ level: "photo", badges: ["phone", "photo"] });
  });
  it("all three, ordered phone→photo→id", () => {
    expect(verificationSummary({ phone_verified: true, photo_verified: true, id_verified: true }))
      .toEqual({ level: "id", badges: ["phone", "photo", "id"] });
  });
  it("id without photo still reports level id", () => {
    expect(verificationSummary({ phone_verified: false, photo_verified: false, id_verified: true }))
      .toEqual({ level: "id", badges: ["id"] });
  });
});
