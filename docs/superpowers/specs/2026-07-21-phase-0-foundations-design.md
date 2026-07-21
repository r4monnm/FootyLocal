# FootyLocal — Phase 0: Foundations (Design Spec)

**Date:** 2026-07-21
**Status:** Approved for planning
**Scope:** Phase 0 only. Phases 1–4 are out of scope and referenced only where they constrain Phase 0 decisions.

## 1. Goal

Deliver a running Turborepo monorepo with:

- The Next.js (App Router, TypeScript strict) web app.
- Shared packages (`db`, `core`, `ui`, `config`) structured so a future Expo app reuses them.
- A Nike-inspired design-token layer + Tailwind preset.
- A **hosted** Supabase (cloud) Postgres database with the **PostGIS** extension, the full domain schema (all Phase 0–4 tables), Row Level Security on every table, and the `games_near` RPC.
- Email + **phone-OTP auth**, where the phone-verification gate is fully built but OTP is stubbed in dev (no paid SMS provider yet).
- A handful of seeded **verified venues**.
- An **empty Discover screen** inside a five-tab bottom-nav shell.

At the end of Phase 0: `pnpm dev` runs the web app; a user can sign up (email + dev phone-OTP) and land on an empty Discover tab; the database holds the complete schema with RLS and seeded venues queryable via `games_near`.

### Non-goals for Phase 0 (deferred, but tables designed now)

Map/clustered pins, host-a-game flow, join/precise-location reveal, post-game ratings, report/block UI, payments (Stripe Connect), identity verification (Stripe Identity), tournaments, trusted contacts, Realtime messaging. **All corresponding tables are created in Phase 0** so RLS and relationships are designed once; only auth + schema + empty Discover are wired end-to-end.

## 2. Environment & Constraints (confirmed with user)

- **Database:** Hosted Supabase cloud. No Docker / Supabase CLI required locally. User creates the project and holds the keys.
- **Phone verification:** Flow built (schema flag + join/host gate + UI), OTP stubbed via Supabase dev/test path. Real SMS provider (e.g. Twilio) deferred to a later phase.
- **Credential handling:** Claude generates exact CLI/dashboard steps + SQL; the user runs them and pastes the project ref + anon/service keys into a local `.env` that is never committed. `.env.example` documents every variable with placeholders only.
- **Tooling present:** Node 26, pnpm 11.9, git. No Docker.
- **Type safety:** TypeScript strict mode across the whole monorepo. No `any` without a justifying comment.

## 3. Architecture Decisions

### 3.1 Drizzle owns schema; Supabase owns runtime

Drizzle ORM is the source of truth for tables/columns/relations and generates migrations against a direct Postgres connection (`postgres-js`, service-role connection string, server/tooling only).

PostGIS constructs Drizzle cannot express are hand-written SQL migrations in `packages/db/migrations/sql/`, applied **after** Drizzle's generated migrations:

- `CREATE EXTENSION postgis;`
- `geography(Point,4326)` columns on `venues.location`, `games.precise_location`, `games.public_location`.
- GiST indexes on all geography columns.
- RLS policies on every table.
- The `games_near` RPC (`SECURITY DEFINER`).

Runtime reads/writes go through `supabase-js` so **RLS is always enforced**. Three client factories in `packages/db/client.ts`:

- **browser** — anon key, RLS-enforced, used in client components.
- **server** — anon key + user session (from cookies), RLS-enforced, used in server components / route handlers.
- **service** — service-role key, bypasses RLS, used **only** in trusted server code (seeding, privileged jobs). Never imported into client bundles.

**Tradeoff:** two migration sources must stay ordered (Drizzle first, then SQL). Accepted because it is the only clean way to combine typed schema with PostGIS + RLS + RPC.

### 3.2 Deterministic location fuzzing, computed at write time

`packages/core/geo` exposes pure functions:

- `fuzzToPublicPoint(precise: LatLng, gameId: string): LatLng` — snaps `precise` to a geohash-6 grid cell, then applies a **fixed** per-game display offset seeded deterministically from `gameId`. Same `(precise, gameId)` → identical output forever. This defeats averaging attacks (no fresh random noise per read).
- `publicDisplayCircle(precise: LatLng, gameId: string): { center: LatLng; radiusMeters: number }` — returns a circle whose **center is offset from the true point** by a seeded amount smaller than the radius (Strava Privacy-Zone fix), so the true pitch is never the circle center.
- `roundPublicDistance(meters: number): string` — coarse, human-readable ("about 2 km away"); never high-precision.

Unit tests prove: determinism (same input → same output), that the fuzzed point lies within the expected band of the true point, and that the display center is not the true point. In Phase 0 no games exist, but the functions + tests ship so Phase 1 host-flow just calls them.

### 3.3 `games_near` decides precise-vs-public per caller

A `SECURITY DEFINER` Postgres function, callable as a Supabase RPC:

```
games_near(lat double precision, lng double precision, radius_meters int, filters jsonb)
```

- Returns open games whose `public_location` is within `radius_meters`, using `ST_DWithin(public_location, ST_MakePoint(lng,lat)::geography, radius_meters)`, ordered by `ST_Distance`.
- For each game, returns `precise_location` **only** when `auth.uid()` is on that game's roster (`game_players.status = 'joined'`); otherwise returns only `public_location`.
- Distances exposed to non-participants are coarse. Authorization lives in the database, not the client.

`filters` (jsonb) supports the Phase 1 filter set (skill_band, date range, format, price, women-only, distance) but Phase 0 only needs the function to exist and be correct; UI wiring is Phase 1.

## 4. Domain Model (all tables created in Phase 0)

UUID primary keys, `created_at` / `updated_at` timestamps, RLS enabled on every table. Enum types created in SQL. Full column lists follow the master build prompt; summarized here:

- **profiles** (extends `auth.users`): display_name, avatar_url, phone_verified (default false), photo_verified, id_verified, verification_level (none|phone|photo|id), self_reported_skill (beginner|intermediate|advanced|pro), hidden_mmr + mmr_rd + mmr_volatility (nullable, Glicko-2, later), karma (int default 0), games_played, no_shows, preferred_position, is_18_plus (enforced at signup).
- **venues** (curated, public places): name, address, location `geography(Point,4326)` (precise, no fuzzing — public places), surface_type (turf|grass|indoor|court|street), is_verified, photo_url. Only `is_verified = true` venues may host games.
- **games**: host_id→profiles, venue_id→venues, title, description, starts_at, ends_at, skill_band (beginner|intermediate|advanced|pro|open), format (five_a_side|seven_a_side|eleven_a_side|other), max_players, price_cents (default 0), status (draft|open|confirmed|cancelled|completed), min_players_to_confirm, is_women_only (default false), precise_location `geography(Point,4326)`, public_location `geography(Point,4326)` (pre-fuzzed at write time), gender_policy, guest_policy.
- **game_players**: game_id, player_id, role (host|player|waitlist), status (joined|waitlisted|cancelled|no_show|attended), paid, payment_intent_id (nullable), joined_at.
- **ratings**: game_id, rater_id, ratee_id, skill_score (jsonb of category scores), reliability_up (bool), is_host_rating (bool), created_at. Unique constraint: one rating per (rater, ratee, game).
- **reports**: reporter_id, reported_id (nullable), game_id (nullable), reason (harassment|no_show|unsafe_behavior|fake_profile|other), details, status (open|reviewing|actioned|dismissed).
- **blocks**: blocker_id, blocked_id (bidirectional invisibility).
- **tournaments** (+ `tournament_teams`, `tournament_matches`, `standings` — created as stubs in Phase 0, fleshed out in Phase 4): host_id, name, format (round_robin|single_elim|double_elim|group_then_knockout), starts_at, venue_id, max_teams, status.
- **trusted_contacts**: user_id, contact_name, contact_phone (safety, later phase).

### RLS policy intent (per table)

- Everyone can read public data (verified venues, open games' **public** fields).
- Users write only their own rows (`auth.uid() = owner column`).
- Hosts manage only their own games.
- `precise_location` is never exposed to non-participants — enforced via the `games_near` RPC and by not granting direct `SELECT` on the raw column to non-roster users (column-level protection / view or RPC-only access for precise fields).
- Blocked users never appear in each other's games/chats (blocks consulted in read policies / RPC).

## 5. Auth Flow (Phase 0)

1. Email sign-up/sign-in via Supabase Auth.
2. **18+ enforcement** at signup (attestation → `profiles.is_18_plus`).
3. Phone-OTP step: user enters phone → OTP challenge. In dev, OTP is stubbed (Supabase test OTP / fixed dev code); on success `profiles.phone_verified = true` and `verification_level = 'phone'`.
4. Gate: a user cannot join or host any game until `phone_verified = true`. In Phase 0 there is nothing to join/host yet, but the gate + the "verify your phone" UI state exist.
5. A `profiles` row is created on first sign-in (via trigger on `auth.users` or first-login upsert).

## 6. Design System (packages/ui)

Tokens (shared with future native app) + Tailwind preset:

- **Color:** surface/text near-black `#111111` on white `#FFFFFF` + soft gray `#F5F5F5`. One accent: electric volt green (~`#CCFF00`, contrast-adjusted). Color reserved for accent + functional red (error) / green (success). No gradients, no decorative color.
- **Typography:** massive uppercase condensed display headlines, line-height ~0.90 (Anton / Archivo Condensed / League Spartan); clean neutral sans (Inter) for body. Fonts loaded locally / via next/font.
- **Shape:** pill-shaped fully-rounded black CTA buttons; circular icon buttons. Shape vocabulary limited to pills + circles.
- **Primitives shipped in Phase 0:** `Button` (pill), `Badge` (skill band / verification), `Card` (photography-forward shell). Enough to render the tab shell + empty Discover; more added in Phase 1.

## 7. Information Architecture (Phase 0 slice)

Five-tab bottom nav (active tab highlighted in accent): **Discover**, **My Games**, **Host**, **Messages**, **Profile**. In Phase 0 only the shell + **Discover (empty state)** are built; the other four tabs render placeholder empty states. No map yet.

## 8. Monorepo File Tree

```
footylocal/
  package.json                # pnpm workspace root, turbo scripts
  pnpm-workspace.yaml
  turbo.json
  .env.example                # every secret documented, placeholders only
  .gitignore
  README.md                   # setup + Google Maps key scoping notes
  DECISIONS.md                # architectural log (seeded with §3 decisions)
  apps/
    web/                      # Next.js App Router, TS strict
      app/(auth)/…            # sign-in, verify-phone
      app/(tabs)/discover/    # empty Discover screen + bottom-tab shell
      lib/supabase/           # re-exports packages/db client factories
    mobile/                   # empty placeholder + README
  packages/
    db/
      schema/                 # Drizzle tables (all Phase 0–4 tables)
      migrations/             # Drizzle-generated migrations
      migrations/sql/         # PostGIS ext, geography cols, GiST, RLS, games_near
      client.ts               # browser/server/service client factories
      seed/venues.ts          # ~6 verified venues
    core/
      geo/                    # fuzzing + tests
      skill/                  # v1 tier enum helpers + tests
      validation/             # shared Zod schemas
      index.ts
    ui/
      tokens/                 # colors, type scale, spacing
      tailwind-preset.ts
      primitives/             # Button, Badge, Card
    config/                   # shared tsconfig, eslint, tailwind base
```

## 9. Secrets / Env

`.env.example` documents (placeholders only; real values live in uncommitted `.env`):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, never `NEXT_PUBLIC_`)
- `DATABASE_URL` (direct Postgres, for Drizzle migrations)
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (documented now, used Phase 1)

README documents how to scope/restrict the Google Maps key and set usage limits (even though it's unused in Phase 0).

## 10. Testing

- `packages/core/geo`: determinism, fuzz-band bounds, non-centered display circle.
- `packages/core/skill`: v1 tier enum ordering / comparison helpers.
- `packages/core/validation`: representative Zod schema round-trips.
- Vitest as the test runner in `packages/core`.

## 11. Deliverable Checklist (Definition of Done for Phase 0)

- [ ] Turborepo + pnpm workspace boots; `pnpm dev` runs the web app.
- [ ] TS strict passes across all packages; lint clean.
- [ ] Hosted Supabase project created; PostGIS enabled; all tables + enums migrated; RLS enabled on every table; `games_near` RPC exists and returns precise-vs-public correctly.
- [ ] ~6 verified venues seeded.
- [ ] Email + dev-stubbed phone-OTP auth works; profile row created on first login; join/host gated on `phone_verified`.
- [ ] Design tokens + Tailwind preset + Button/Badge/Card primitives render the five-tab shell + empty Discover.
- [ ] `packages/core` tests pass (geo fuzzing + skill helpers + validation).
- [ ] `.env.example`, `README.md`, `DECISIONS.md` present and accurate; no real secrets committed.
