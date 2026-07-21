# FootyLocal — Phase 1a: Host + Discover (Design Spec)

**Date:** 2026-07-21
**Status:** Approved for planning
**Scope:** Phase 1a only. The rest of Phase 1 — 1b (join + precise reveal + game detail) and 1c (ratings + report/block) — is out of scope and referenced only where it constrains 1a.

## 1. Goal

The core loop: a phone-verified user hosts a game at a verified venue → the game appears as a **fuzzed** pin on everyone's Discover map and list, powered by `games_near` → filters narrow it down. This is the first slice of the "core usable product."

At the end of 1a:
- A phone-verified user can create a game at one of the curated verified venues; the game is stored with `precise_location` (the venue) and a deterministically-fuzzed `public_location`, the host on the roster, status `open`.
- Discover shows nearby open games as a Google Map with **clustered, fuzzed** pins and a list toggle, both powered by `games_near`, with filters (skill band, date, format, price, women-only, distance) and browser geolocation.
- Tapping a game shows a **preview** (band, time, spots, fuzzed area) with a disabled "Join — coming next"; the detail page + join + precise reveal are 1b.
- Precise coordinates never reach a non-roster client (already enforced by the `games_near` RPC + column-level protection from Phase 0).

### Non-goals for 1a (deferred)
Game detail page, joining, precise-location reveal + Directions (all 1b). Ratings, report, block (1c). Payments (Phase 2). Adding/curating venues (admin, later). Places autocomplete.

## 2. Constraints

Inherits all Phase 0 global constraints (TS strict/no-any, RLS, verified-venues-only, deterministic write-time fuzzing, no precise leakage, design tokens: pills/circles, volt accent, condensed uppercase display). Plus:

- **Fuzzing runs server-side**, never in the browser. The write path computes `public_location` on the server using the tested `packages/core` fuzzing; the client never supplies or influences it.
- Google Maps key is referrer-restricted and scoped to Maps JavaScript API + Places API (README/setup documents limits).

## 3. Architecture Decisions

### 3.1 Game-create write path: server-only orchestration in `packages/db`, fuzzing in `packages/core`, atomic RPC

Creating a game must (a) run the fuzz on the server, (b) set `precise_location` from the venue and store the fuzzed `public_location`, (c) add the host to the roster — atomically, and (d) be impossible for a client to tamper with (e.g. setting `public_location = precise`).

Flow:
1. **Web server action `hostGameAction`** (`apps/web`, `"use server"`): calls `getUser()` → `hostId`; validates input with `gameCreateSchema` (core); confirms the caller is `phone_verified`; calls `db.createGame(hostId, input)`.
2. **`packages/db` server-only `createGame(hostId, input)`**: generates the game UUID; reads the venue's precise lat/lng via the `venue_latlng` RPC; computes `public_location` via `fuzzToPublicPoint(venueLatLng, gameId)` (core); calls the `create_game` RPC (via the **service client**) with the fields + fuzzed `public_lat/lng`.
3. **`create_game` RPC** (`SECURITY DEFINER`, **granted only to `service_role`** — clients cannot call it): re-checks the venue is `is_verified`; inserts the game with `precise_location = venues.location`, `public_location = ST_MakePoint(public_lng, public_lat)`, `status = 'open'`, `host_id = hostId`; inserts the host `game_players` row (`role='host'`, `status='joined'`) — all in one statement/transaction.

**Why:** keeps fuzzing in `packages/core` (single tested source), keeps the service client inside `packages/db` (consistent with the Phase 0 DECISIONS note), makes the write atomic, and — because `create_game` is service-role-only — a client cannot inject an un-fuzzed `public_location`. The service client is used only in server-only code, never a client bundle.

**Tradeoff:** two RPCs (`venue_latlng` read, `create_game` write) and a server hop to fetch venue lat/lng before fuzzing. Accepted for the security + atomicity guarantees.

### 3.2 Extend `games_near` for server-side filtering

`games_near` already filters `skill_band` + `women_only` and returns fuzzed public coordinates + coarse distance. Extend its `filters` jsonb (new SQL migration, `CREATE OR REPLACE`) to also filter:
- `format` (game_format)
- `price_max_cents` (int; `price_cents <= x`)
- `starts_after` / `starts_before` (timestamptz window)

Distance is already `radius_meters`. Filtering server-side (not client) avoids over-fetching and scales. The precise-vs-public roster gate and column protection are unchanged.

### 3.3 Discover is a client view that queries `games_near` directly

Geolocation is client-side, so Discover fetches its own data:
- `discover/page.tsx` (server component) renders `<DiscoverView>` (client).
- `DiscoverView` obtains the user's location via `navigator.geolocation` (fallback center: Atlanta `33.749, -84.388` if denied/unavailable), holds filter state, and calls `supabase.rpc('games_near', { lat, lng, radius_meters, filters })` through the **browser** (anon-key, RLS-safe) client. `games_near` returns only public data for non-joined games, so browser access is safe.
- Results render as either the **map** (clustered fuzzed pins) or the **list** (distance/time-sorted cards), toggled by a control; a filter bar updates the query.

### 3.4 Google Maps loading

Load the Maps JavaScript API via `@googlemaps/js-api-loader` with `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`; cluster pins with `@googlemaps/markerclusterer`. Pins are placed at `public_location` only. If the key is absent, the map area shows a graceful "Map unavailable — add a Maps key" state and the **list still works**, so development isn't blocked on the key.

## 4. Data Model Changes

No new tables. New/changed database objects (SQL migrations, applied after Phase 0's):
- `venue_latlng(v_id uuid) returns table(lat double precision, lng double precision)` — returns a verified venue's precise lat/lng for the server-side fuzz input. `SECURITY DEFINER`, granted to `service_role` (and `authenticated` is unnecessary; keep it `service_role`-only).
- `create_game(...)` — `SECURITY DEFINER`, granted **only** to `service_role`; inserts the game + host roster row atomically (see §3.1).
- `games_near` — `CREATE OR REPLACE` with the extended filters (§3.2).

RLS is unchanged. `game_players` insert for the host happens inside `create_game` (definer), so it isn't subject to the host racing their own RLS insert policy.

## 5. Shared Logic (`packages/core`)

New, with unit tests:
- `gameCreateSchema` (Zod): `title` (2–80), `description?` (≤500), `venueId` (uuid), `startsAt` / `endsAt` (ISO), `skillBand` (GameBand), `format` (game format enum), `maxPlayers` (int 2–64), `minPlayersToConfirm` (int ≥2, ≤ maxPlayers), `isWomenOnly` (bool), `priceCents` (int ≥0, default 0). Refinements: `endsAt > startsAt`; `startsAt` in the future; `minPlayersToConfirm ≤ maxPlayers`.
- `discoverFilters` type + `toGamesNearFilters(filters): Record<string, unknown>` — serializes UI filter state to the `games_near` jsonb (`skill_band`, `format`, `price_max_cents`, `starts_after`, `starts_before`, `women_only`), omitting unset keys. Plus `GAME_FORMATS` constant for the form/filter selects.
- Tests: schema accept/reject (time ordering, min≤max, future start, women-only), and `toGamesNearFilters` omitting unset keys + mapping set ones.

The format/skill enums already exist (`GAME_BANDS`, and a new `GAME_FORMATS` mirroring the DB `game_format`).

## 6. UI (within Phase 0 design tokens)

- **Host tab** (`app/(tabs)/host/page.tsx`): `HostGameForm` — venue searchable dropdown (from the verified `venues` table, fetched server-side and passed in), title, description, start/end datetime, skill band, format, max players, min-to-confirm, women-only toggle. Submit → `hostGameAction`. Blocked with a "verify your phone" prompt if not phone-verified. Price field present but fixed at £0 (Phase 2).
- **Discover tab**: `DiscoverView` with a map/list segmented toggle, a `FilterBar` (skill band, date, format, price, women-only, distance), the `DiscoverMap` (clustered fuzzed pins) and `DiscoverList` (cards: band badge, format, time, spots-remaining, coarse distance). Tapping a pin or card opens a `GamePreview` sheet (band, time, spots, fuzzed area note, host display name) with a disabled **"Join — coming next"** pill.
- Headlines condensed uppercase; buttons pills; single volt accent (active toggle, filter chips); no gradients.

## 7. Environment

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — the referrer-restricted Maps key (already a placeholder in `.env.example`). README documents restriction + quota caps.

## 8. Seed

`packages/db/src/seed/games.ts`: ensures a demo host profile exists, then hosts ~3 open games at 3 seeded venues (via the same `createGame` path so they get real fuzzing), spread across skill bands/formats/times, so Discover isn't empty on first load. Idempotent; removable later.

## 9. Testing

- `packages/core`: `gameCreateSchema` and `toGamesNearFilters` unit tests (Vitest).
- Fuzzing is already tested (Phase 0).
- Manual/live: host a game → appears on Discover map + list; filters narrow results; geolocation prompts; a non-joined browser session never receives precise coordinates (re-confirm via the `games_near` result shape).

## 10. Definition of Done

- [ ] Phone-verified user can host a game at a verified venue; row has `precise_location` = venue, deterministically-fuzzed `public_location`, host on roster, `status='open'`. A non-phone-verified user is blocked with the verify prompt.
- [ ] `create_game` is service-role-only; a direct client RPC call is rejected. Fuzzing runs server-side; the client cannot set `public_location`.
- [ ] `games_near` supports the extended filters; Discover map shows clustered fuzzed pins, list shows distance/time-sorted cards, both from `games_near`.
- [ ] Filters (skill band, date, format, price, women-only, distance) work; distances shown are coarse.
- [ ] Geolocation works with an Atlanta fallback; missing Maps key degrades gracefully to a working list.
- [ ] Tapping a game shows the preview with a disabled Join.
- [ ] ~3 demo games seeded and visible.
- [ ] `packages/core` tests pass (schema + filter serialization); typecheck clean; `next build` succeeds.
- [ ] No precise coordinates reach a non-roster client (verified from the `games_near` result shape).
