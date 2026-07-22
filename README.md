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

## Payments (Stripe Connect, test mode — optional)
Paid games are seam-gated: without Stripe keys the app runs normally and paid
features are hidden. To enable:
1. Create a Stripe account; enable **Connect** (test mode).
2. Developers → API keys: copy the **test** secret + publishable keys into
   `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
3. Local webhooks: install the Stripe CLI and run
   `stripe listen --forward-to localhost:3000/api/stripe/webhook`; copy the
   printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`.
4. Restart `pnpm dev`. Test card: `4242 4242 4242 4242`, any future expiry/CVC.
