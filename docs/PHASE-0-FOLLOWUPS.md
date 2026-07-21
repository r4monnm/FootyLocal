# Phase 0 — Deferred Follow-ups

Non-blocking items surfaced during Phase 0 reviews, to address in later phases.

## Security / privacy (do before the relevant feature ships)
- **Column-protect `profiles.hidden_mmr`/`mmr_rd`/`mmr_volatility`/`karma`/`no_shows`.**
  The `profiles` SELECT RLS policy is currently world-readable (matches Phase 0
  intent; no data yet). Restrict these columns (column grants or a public view)
  before the Glicko-2 rating system lands. (spec § skill v3)
- **Wire `blocks` into `games_near` and roster reads.** Spec §4 requires blocked
  users never see each other's games/chats. The `blocks` table exists but is not
  consulted yet. Add to the RPC + read policies in Phase 1.
- **Harden auth error messaging.** `apps/web/app/(auth)/actions.ts` echoes raw
  Supabase `error.message` via the `?error=` query param — an account-enumeration
  surface. Map to generic messages before/at launch.
- **Verified-venue check on `tournaments.venue_id`.** `games` enforces it via RLS
  `with check`; tournaments (Phase-4 stub) do not yet.

## Robustness
- **PostGIS search_path.** `games_near`/`set_venue_location`/`handle_new_user` set
  `search_path = public`. If a deploy ever installs PostGIS into an `extensions`
  schema, use `search_path = public, extensions` so `ST_*` resolves.
- **Turbopack.** `apps/web/next.config.ts` uses a webpack `extensionAlias` to
  resolve the `.js`→`.ts` specifiers in `@footylocal/core`/`ui`. It no-ops under
  `--turbopack`; add equivalent config (or a package build step) if Turbopack
  build is adopted.
- **Geo property tests.** `packages/core/src/geo/geo.test.ts` uses a single
  coordinate fixture. Safety bounds hold by construction today; add property-based
  tests (varied lat/lng/gameId) so a future constant change can't silently break
  the fuzz-band or circle-offset guarantees.

## Design polish
- Active-tab styling colors only the dot with the accent; label stays ink. Revisit
  against "active tab highlighted in the accent color."
- `apps/web` uses Tailwind default grays (`neutral-300/400/600`) in a few places
  instead of the `ui` token gray. Consolidate onto tokens.
