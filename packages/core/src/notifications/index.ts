/** In-app notification types (mirror of the DB notification_type enum). */
export const NOTIFICATION_TYPES = [
  "game_confirmed",
  "spot_opened",
  "game_cancelled",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
