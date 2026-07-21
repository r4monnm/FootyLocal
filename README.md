# FootyLocal

Discover, join, and host local pickup soccer. Web-first, mobile later.

## Stack
Turborepo + pnpm, Next.js (App Router), Supabase (Postgres + PostGIS + Auth),
Drizzle ORM, Tailwind v4, Zod, Vitest.

## Setup
1. `pnpm install`
2. Create a hosted Supabase project (see `docs/SUPABASE_SETUP.md`).
3. Copy `.env.example` to `.env` and fill in the values from your project.
4. `pnpm --filter @footylocal/db migrate` then `pnpm --filter @footylocal/db sql`
   then `pnpm --filter @footylocal/db seed`.
5. `pnpm dev` and open http://localhost:3000.

## Google Maps key scoping (do this even though Phase 0 does not use it)
In Google Cloud Console → Credentials → your key:
- Application restriction: HTTP referrers → add `http://localhost:3000/*` and
  your deploy domain.
- API restriction: restrict to Maps JavaScript API, Places API, Geocoding API,
  Directions API only.
- Set a daily quota cap and a billing budget alert.

## Packages
- `packages/core` — pure logic (geo fuzzing, skill tiers, validation).
- `packages/db` — Drizzle schema, PostGIS SQL, Supabase clients, seed.
- `packages/ui` — design tokens + primitives.
- `packages/config` — shared tsconfig/eslint.
- `apps/web` — Next.js web app.
- `apps/mobile` — Expo placeholder (later phase).
