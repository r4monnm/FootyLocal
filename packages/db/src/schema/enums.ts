import { pgEnum } from "drizzle-orm/pg-core";

export const verificationLevel = pgEnum("verification_level", [
  "none",
  "phone",
  "photo",
  "id",
]);
export const selfReportedSkill = pgEnum("self_reported_skill", [
  "beginner",
  "intermediate",
  "advanced",
  "pro",
]);
export const surfaceType = pgEnum("surface_type", [
  "turf",
  "grass",
  "indoor",
  "court",
  "street",
]);
export const skillBand = pgEnum("skill_band", [
  "beginner",
  "intermediate",
  "advanced",
  "pro",
  "open",
]);
export const gameFormat = pgEnum("game_format", [
  "five_a_side",
  "seven_a_side",
  "eleven_a_side",
  "other",
]);
export const gameStatus = pgEnum("game_status", [
  "draft",
  "open",
  "confirmed",
  "cancelled",
  "completed",
]);
export const playerRole = pgEnum("player_role", ["host", "player", "waitlist"]);
export const playerStatus = pgEnum("player_status", [
  "joined",
  "waitlisted",
  "cancelled",
  "no_show",
  "attended",
]);
export const reportReason = pgEnum("report_reason", [
  "harassment",
  "no_show",
  "unsafe_behavior",
  "fake_profile",
  "other",
]);
export const reportStatus = pgEnum("report_status", [
  "open",
  "reviewing",
  "actioned",
  "dismissed",
]);
export const tournamentFormat = pgEnum("tournament_format", [
  "round_robin",
  "single_elim",
  "double_elim",
  "group_then_knockout",
]);
export const notificationType = pgEnum("notification_type", [
  "game_confirmed",
  "spot_opened",
  "game_cancelled",
]);
