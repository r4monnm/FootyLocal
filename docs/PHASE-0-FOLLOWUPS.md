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
- ~~**Harden auth error messaging.**~~ DONE (2026-07-21): `friendlyAuthError()`
  in `packages/core` maps raw Supabase auth errors to safe copy; the auth
  actions no longer echo raw `error.message`. The 18+ gate now shows a clear
  message instead of "Invalid literal value, expected true".
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

---

# Phase 1a — Deferred Follow-ups

Non-blocking items from Phase 1a reviews (final review verdict: ready to merge, no
Critical/Important). Prioritize the service-key guard.

## Security / robustness
- **`server-only` guard on `packages/db/src/games.ts` (do soon).** It imports the
  service-role client; today it's reached only via the `"use server"` host action
  (build-verified no client leak), but only a comment protects it. CAVEAT: a plain
  `import "server-only"` breaks `seed:games` (same module runs under `tsx`/Node,
  where `server-only` throws). Options: split the create logic so the seed path
  doesn't import the guarded module, or gate the guard behind a bundler-only entry.
- **Generate Supabase `Database` types.** The client has no `Database` generic, so
  `.rpc()/.from()` results are implicitly `any` and the `data as NearbyGame[]` casts
  are unchecked. Do before Phase 1b so RPC/column drift is type-caught.
- **Migration idempotency guards** match constraints on `conname` alone (not
  `conname + conrelid`) — theoretical collision only.

## Correctness / polish
- **`games_near` rebuilt in both 0003 and 0007** on every replay (0007 is the source
  of truth). Wasteful, converges correctly. Add a dev-docs note.
- **Host error mapping:** `createGame` DB errors (e.g. "venue not verified") are run
  through `friendlyAuthError` (auth-oriented) → collapse to generic. Add a
  game-specific error mapper for actionable host feedback.
- **DiscoverMap:** map doesn't recenter to the geolocated position when there are 0
  nearby games (list is correct); uses the deprecated `google.maps.Marker` (consider
  `AdvancedMarkerElement`); marker re-plot effect returns no cleanup (harmless).
- **Host form field coercion:** `String(formData.get())` yields `"null"` for missing
  fields (mitigated by `required` + Zod + the DB verified-venue re-check).
- **`NearbyGame.joined_count`** typed `number` but the RPC column is `bigint`
  (consumers wrap in `Number()`; type is really `number | string`).

## Deferred to 1b / 1c (by design)
- Game detail page, join, precise-location reveal + Directions (1b). The `precise_*`
  columns from `games_near` are intentionally unused in 1a (null for non-roster) and
  go live in 1b.
- Ratings, report, block (1c).
