import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import {
  verificationLevel,
  selfReportedSkill,
  surfaceType,
  skillBand,
  gameFormat,
  gameStatus,
  playerRole,
  playerStatus,
  reportReason,
  reportStatus,
  tournamentFormat,
  notificationType,
} from "./enums";

export * from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

/** Extends auth.users (same id). Geo: none. */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // references auth.users(id); FK added in SQL
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  phoneVerified: boolean("phone_verified").default(false).notNull(),
  photoVerified: boolean("photo_verified").default(false).notNull(),
  idVerified: boolean("id_verified").default(false).notNull(),
  verificationLevel: verificationLevel("verification_level").default("none").notNull(),
  selfReportedSkill: selfReportedSkill("self_reported_skill"),
  hiddenMmr: numeric("hidden_mmr"),
  mmrRd: numeric("mmr_rd"),
  mmrVolatility: numeric("mmr_volatility"),
  karma: integer("karma").default(0).notNull(),
  gamesPlayed: integer("games_played").default(0).notNull(),
  noShows: integer("no_shows").default(0).notNull(),
  preferredPosition: text("preferred_position"),
  is18Plus: boolean("is_18_plus").default(false).notNull(),
  stripeAccountId: text("stripe_account_id"),
  stripeChargesEnabled: boolean("stripe_charges_enabled").default(false).notNull(),
  ...timestamps,
});

/** Curated public venues. `location geography(Point,4326)` added in SQL. */
export const venues = pgTable("venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  surfaceType: surfaceType("surface_type").notNull(),
  isVerified: boolean("is_verified").default(false).notNull(),
  photoUrl: text("photo_url"),
  ...timestamps,
});

/** precise_location + public_location geography columns added in SQL. */
export const games = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  hostId: uuid("host_id").notNull().references(() => profiles.id),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  title: text("title").notNull(),
  description: text("description"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  skillBand: skillBand("skill_band").notNull(),
  format: gameFormat("format").notNull(),
  maxPlayers: integer("max_players").notNull(),
  priceCents: integer("price_cents").default(0).notNull(),
  status: gameStatus("status").default("draft").notNull(),
  minPlayersToConfirm: integer("min_players_to_confirm").notNull(),
  isWomenOnly: boolean("is_women_only").default(false).notNull(),
  genderPolicy: text("gender_policy"),
  guestPolicy: text("guest_policy"),
  ...timestamps,
});

export const gamePlayers = pgTable(
  "game_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull().references(() => games.id),
    playerId: uuid("player_id").notNull().references(() => profiles.id),
    role: playerRole("role").default("player").notNull(),
    status: playerStatus("status").default("joined").notNull(),
    paid: boolean("paid").default(false).notNull(),
    paymentIntentId: text("payment_intent_id"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => ({ uniqPlayer: unique().on(t.gameId, t.playerId) }),
);

export const ratings = pgTable(
  "ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull().references(() => games.id),
    raterId: uuid("rater_id").notNull().references(() => profiles.id),
    rateeId: uuid("ratee_id").notNull().references(() => profiles.id),
    skillScore: jsonb("skill_score").notNull(), // { [category]: 1..5 }
    reliabilityUp: boolean("reliability_up").default(false).notNull(),
    isHostRating: boolean("is_host_rating").default(false).notNull(),
    ...timestamps,
  },
  (t) => ({ uniqRating: unique().on(t.gameId, t.raterId, t.rateeId) }),
);

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterId: uuid("reporter_id").notNull().references(() => profiles.id),
  reportedId: uuid("reported_id").references(() => profiles.id),
  gameId: uuid("game_id").references(() => games.id),
  reason: reportReason("reason").notNull(),
  details: text("details"),
  status: reportStatus("status").default("open").notNull(),
  ...timestamps,
});

export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockerId: uuid("blocker_id").notNull().references(() => profiles.id),
    blockedId: uuid("blocked_id").notNull().references(() => profiles.id),
    ...timestamps,
  },
  (t) => ({ uniqBlock: unique().on(t.blockerId, t.blockedId) }),
);

// --- Tournaments (stubs; fleshed out in Phase 4) ---
export const tournaments = pgTable("tournaments", {
  id: uuid("id").primaryKey().defaultRandom(),
  hostId: uuid("host_id").notNull().references(() => profiles.id),
  name: text("name").notNull(),
  format: tournamentFormat("format").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  maxTeams: integer("max_teams").notNull(),
  status: gameStatus("status").default("draft").notNull(),
  ...timestamps,
});

export const tournamentTeams = pgTable("tournament_teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id),
  name: text("name").notNull(),
  captainId: uuid("captain_id").references(() => profiles.id),
  ...timestamps,
});

export const tournamentMatches = pgTable("tournament_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id),
  homeTeamId: uuid("home_team_id").references(() => tournamentTeams.id),
  awayTeamId: uuid("away_team_id").references(() => tournamentTeams.id),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  round: integer("round"),
  ...timestamps,
});

export const standings = pgTable("standings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id),
  teamId: uuid("team_id").notNull().references(() => tournamentTeams.id),
  points: integer("points").default(0).notNull(),
  played: integer("played").default(0).notNull(),
  goalDiff: integer("goal_diff").default(0).notNull(),
  ...timestamps,
});

export const trustedContacts = pgTable("trusted_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id),
  contactName: text("contact_name").notNull(),
  contactPhone: text("contact_phone").notNull(),
  ...timestamps,
});

// In-app notifications. Written only by SECURITY DEFINER RPCs (RLS in SQL:
// own-row read/update, no user insert).
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id),
  type: notificationType("type").notNull(),
  gameId: uuid("game_id").references(() => games.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
