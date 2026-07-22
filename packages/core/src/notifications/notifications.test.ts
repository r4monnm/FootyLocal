import { describe, it, expect } from "vitest";
import { NOTIFICATION_TYPES } from "./index.js";

describe("NOTIFICATION_TYPES", () => {
  it("matches the DB notification_type enum values", () => {
    expect(NOTIFICATION_TYPES).toEqual(["game_confirmed", "spot_opened", "game_cancelled"]);
  });
});
