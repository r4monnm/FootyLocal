# Architecture Decisions

## 2026-07-21 — Drizzle owns schema, Supabase owns runtime
Drizzle is the source of truth for non-geo columns and generates migrations.
PostGIS columns, GiST indexes, RLS policies, and the `games_near` RPC are
hand-written SQL applied after Drizzle migrations. Runtime access is via
`supabase-js` so RLS is always enforced. Tradeoff: two migration sources must
stay ordered; accepted as the only clean PostGIS + typed-schema combination.

## 2026-07-21 — Deterministic write-time location fuzzing
`public_location` is derived by grid-snapping the precise point and applying a
per-game offset seeded from the game UUID. No fresh per-read randomness, so it
cannot be averaged out. The public display circle is centered off the true
point (Strava Privacy-Zone fix).

## 2026-07-21 — games_near decides precise-vs-public per caller
A SECURITY DEFINER RPC returns precise_location only to on-roster callers,
public_location otherwise. Authorization lives in the DB, not the client.

## 2026-07-21 — Tailwind v4 CSS-first tokens, mirrored in TS
Tokens live in `packages/ui/src/tokens/index.ts` (source of truth for JS/native)
and are mirrored into a `@theme` block in `packages/ui/src/theme.css` for
Tailwind v4. Kept in sync manually; small surface, low churn.
