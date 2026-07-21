# FootyLocal Phase 0: Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the FootyLocal monorepo with a hosted Supabase Postgres+PostGIS database (full schema, RLS, `games_near` RPC), email + dev-stubbed phone-OTP auth, seeded verified venues, and an empty five-tab Discover shell.

**Architecture:** Turborepo + pnpm workspaces. Pure logic (geo fuzzing, skill tiers, validation) lives in `packages/core`; design tokens/primitives in `packages/ui`; Drizzle schema + PostGIS SQL migrations + Supabase client factories in `packages/db`. The Next.js App Router web app in `apps/web` consumes all three. Drizzle is the schema source of truth for non-geo columns; PostGIS columns, GiST indexes, RLS policies, and the `games_near` RPC are hand-written SQL applied after Drizzle migrations. Runtime data access goes through `supabase-js` so RLS is always enforced.

**Tech Stack:** pnpm, Turborepo, TypeScript (strict), Next.js App Router, React, Tailwind CSS v4, Supabase (Postgres, Auth, PostGIS), Drizzle ORM + drizzle-kit + postgres-js, Zod, Vitest.

## Global Constraints

- TypeScript strict mode across every package/app. No `any` without a one-line justifying comment.
- Never send `precise_location` or high-precision distance to a client not on a game's roster. Precise reveal is gated in the DB (`games_near` RPC + RLS), never the client.
- `public_location` is computed at write time by deterministic fuzzing (no fresh per-read randomness). Same `(precise, gameId)` → identical output.
- All locations use `geography(Point,4326)` (meters). GiST index on every geography column.
- RLS enabled on every table. Users write only their own rows; hosts manage only their own games.
- Games may only reference `venues` where `is_verified = true`. No free-form addresses.
- Secrets only via env. `.env` is never committed; `.env.example` holds placeholders only. Service-role key is server-only, never prefixed `NEXT_PUBLIC_`.
- Design tokens: surface/text `#111111` on `#FFFFFF` + gray `#F5F5F5`; single accent volt `#CCFF00`; functional red/green only. No gradients, no decorative color. Pills + circles only. Condensed uppercase display headlines (line-height ~0.90).
- 18+ attestation required at signup. Phone verification required before join/host (flow built; OTP stubbed in dev).
- Frequent commits: each task ends committed.

---

## File Structure

```
footylocal/
  package.json                      # workspace root scripts
  pnpm-workspace.yaml
  turbo.json
  .env.example                      # placeholders only
  .gitignore                        # (exists)
  README.md
  DECISIONS.md
  packages/
    config/
      package.json
      tsconfig.base.json
      eslint.preset.cjs
    core/
      package.json
      tsconfig.json
      vitest.config.ts
      src/index.ts
      src/geo/index.ts              # LatLng, distanceMeters, fuzzToPublicPoint, publicDisplayCircle, roundPublicDistance
      src/geo/geo.test.ts
      src/skill/index.ts            # bands, skillRank, meetsBand
      src/skill/skill.test.ts
      src/validation/index.ts       # Zod: signUp, phone, profile
      src/validation/validation.test.ts
    ui/
      package.json
      tsconfig.json
      src/tokens/index.ts           # TS source of truth for tokens
      src/theme.css                 # Tailwind v4 @theme mirror
      src/primitives/Button.tsx
      src/primitives/Badge.tsx
      src/primitives/Card.tsx
      src/index.ts
    db/
      package.json
      tsconfig.json
      drizzle.config.ts
      src/schema/enums.ts
      src/schema/index.ts           # all tables (non-geo columns)
      src/client.ts                 # browser/server/service factories
      src/seed/venues.ts
      migrations/                   # drizzle-kit output (generated)
      migrations/sql/0001_postgis.sql
      migrations/sql/0002_rls.sql
      migrations/sql/0003_games_near.sql
      migrations/sql/0004_profile_trigger.sql
      scripts/apply-sql.ts          # applies migrations/sql/*.sql in order
  apps/
    web/
      package.json
      tsconfig.json
      next.config.ts
      postcss.config.mjs
      app/globals.css
      app/layout.tsx
      app/page.tsx                  # redirects to /discover or /sign-in
      app/(auth)/sign-in/page.tsx
      app/(auth)/verify-phone/page.tsx
      app/(auth)/actions.ts         # server actions: signUp, verifyPhone
      app/(tabs)/layout.tsx         # bottom tab shell
      app/(tabs)/discover/page.tsx  # empty state
      app/(tabs)/my-games/page.tsx
      app/(tabs)/host/page.tsx
      app/(tabs)/messages/page.tsx
      app/(tabs)/profile/page.tsx
      lib/supabase/server.ts
      lib/supabase/client.ts
      lib/supabase/middleware.ts
      middleware.ts
    mobile/
      README.md                     # placeholder
```

---

### Task 1: Root workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.env.example`, `README.md`, `DECISIONS.md`, `apps/mobile/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: workspace globs `apps/*`, `packages/*`; root scripts `dev`, `build`, `lint`, `typecheck`, `test`.

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "footylocal",
  "private": true,
  "packageManager": "pnpm@11.9.0",
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "test": {}
  }
}
```

- [ ] **Step 4: Create `.env.example`**

```bash
# Supabase (get from your project's API settings)
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
# Server-only. NEVER prefix with NEXT_PUBLIC_.
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# Direct Postgres connection for Drizzle migrations (Session pooler or direct).
DATABASE_URL=postgresql://postgres:PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres

# Google Maps (documented now, used in Phase 1). Restrict the key per README.
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-maps-key

# Dev phone-OTP stub code (Phase 0 only; real SMS provider comes later).
DEV_PHONE_OTP_CODE=000000
```

- [ ] **Step 5: Create `README.md`**

```markdown
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
```

- [ ] **Step 6: Create `DECISIONS.md`**

```markdown
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
```

- [ ] **Step 7: Create `apps/mobile/README.md`**

```markdown
# FootyLocal Mobile (placeholder)

Expo / React Native app. Scaffolded in Phase 4, reusing `packages/core`,
`packages/db`, and `packages/ui`. Intentionally empty until then.
```

- [ ] **Step 8: Install and verify**

Run: `cd ~/projects/footylocal && pnpm install`
Expected: installs turbo + typescript, creates `pnpm-lock.yaml`, no errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Turborepo workspace root"
```

---

### Task 2: Shared config package

**Files:**
- Create: `packages/config/package.json`, `packages/config/tsconfig.base.json`, `packages/config/eslint.preset.cjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `@footylocal/config/tsconfig.base.json` (extended by every package) with `strict: true`; `@footylocal/config/eslint.preset.cjs`.

- [ ] **Step 1: Create `packages/config/package.json`**

```json
{
  "name": "@footylocal/config",
  "version": "0.0.0",
  "private": true,
  "files": ["tsconfig.base.json", "eslint.preset.cjs"]
}
```

- [ ] **Step 2: Create `packages/config/tsconfig.base.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Create `packages/config/eslint.preset.cjs`**

```js
/** Shared ESLint flat-config preset. */
module.exports = {
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  },
};
```

- [ ] **Step 4: Verify workspace resolves the package**

Run: `pnpm install`
Expected: `@footylocal/config` linked into workspace, no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: shared tsconfig + eslint preset"
```

---

### Task 3: core/geo — deterministic location fuzzing (TDD)

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/geo/index.ts`, `packages/core/src/geo/geo.test.ts`, `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `@footylocal/config`.
- Produces:
  - `type LatLng = { lat: number; lng: number }`
  - `distanceMeters(a: LatLng, b: LatLng): number`
  - `fuzzToPublicPoint(precise: LatLng, gameId: string): LatLng`
  - `publicDisplayCircle(precise: LatLng, gameId: string): { center: LatLng; radiusMeters: number }`
  - `roundPublicDistance(meters: number): string`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@footylocal/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./geo": "./src/geo/index.ts",
    "./skill": "./src/skill/index.ts",
    "./validation": "./src/validation/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@footylocal/config": "workspace:*",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "@footylocal/config/tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 4: Write the failing test `packages/core/src/geo/geo.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  distanceMeters,
  fuzzToPublicPoint,
  publicDisplayCircle,
  roundPublicDistance,
} from "./index.js";

// A real pitch (Atlanta area) used across tests.
const precise = { lat: 33.749, lng: -84.388 };
const gameId = "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8";

describe("distanceMeters", () => {
  it("is ~0 for identical points", () => {
    expect(distanceMeters(precise, precise)).toBeLessThan(0.001);
  });
  it("matches a known ~1.11km-per-0.01deg-lat span within 1%", () => {
    const d = distanceMeters(precise, { lat: precise.lat + 0.01, lng: precise.lng });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
  });
});

describe("fuzzToPublicPoint", () => {
  it("is deterministic: same input yields identical output", () => {
    expect(fuzzToPublicPoint(precise, gameId)).toEqual(
      fuzzToPublicPoint(precise, gameId),
    );
  });
  it("does not return the exact precise point", () => {
    const p = fuzzToPublicPoint(precise, gameId);
    expect(distanceMeters(precise, p)).toBeGreaterThan(0);
  });
  it("stays within the fuzz band (<= 1600m) of the true point", () => {
    const p = fuzzToPublicPoint(precise, gameId);
    expect(distanceMeters(precise, p)).toBeLessThanOrEqual(1600);
  });
  it("gives different public points for different game ids", () => {
    const a = fuzzToPublicPoint(precise, gameId);
    const b = fuzzToPublicPoint(precise, "00000000-1111-2222-3333-444444444444");
    expect(a).not.toEqual(b);
  });
});

describe("publicDisplayCircle", () => {
  it("centers the circle OFF the true point but within the radius", () => {
    const c = publicDisplayCircle(precise, gameId);
    const offset = distanceMeters(precise, c.center);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(c.radiusMeters);
  });
  it("is deterministic", () => {
    expect(publicDisplayCircle(precise, gameId)).toEqual(
      publicDisplayCircle(precise, gameId),
    );
  });
});

describe("roundPublicDistance", () => {
  it("coarsens distances into human buckets", () => {
    expect(roundPublicDistance(120)).toBe("under 500 m away");
    expect(roundPublicDistance(1850)).toBe("about 2 km away");
    expect(roundPublicDistance(9400)).toBe("about 9 km away");
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @footylocal/core test`
Expected: FAIL — module `./index.js` has no such exports.

- [ ] **Step 6: Implement `packages/core/src/geo/index.ts`**

```ts
/**
 * Deterministic location privacy. `public_location` is computed once at write
 * time; the same (precise, gameId) always yields the same fuzzed output so it
 * cannot be averaged out across reads.
 */

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;
// Grid cell ~0.01deg (~1.1km). We snap to the cell then add a seeded sub-offset.
const GRID_DEG = 0.01;
const MAX_OFFSET_M = 400; // seeded offset applied to the snapped cell center
const DISPLAY_RADIUS_M = 800; // public circle radius shown on the map

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Offset a point by distance (m) along a bearing (radians). Equirectangular
 * approximation — accurate to well under a meter at sub-km scales. */
function offsetPoint(p: LatLng, distM: number, bearing: number): LatLng {
  const dLat = (distM * Math.cos(bearing)) / 111_320;
  const dLng = (distM * Math.sin(bearing)) / (111_320 * Math.cos(toRad(p.lat)));
  return { lat: p.lat + dLat, lng: p.lng + dLng };
}

/** FNV-1a 32-bit hash → uint32. Deterministic per string. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic unit float in [0, 1) from a seed. */
function seededUnit(seed: string): number {
  return fnv1a(seed) / 0x100000000;
}

/** Snap a coordinate to the center of its grid cell. */
function snapToCellCenter(value: number): number {
  return Math.floor(value / GRID_DEG) * GRID_DEG + GRID_DEG / 2;
}

/**
 * Fuzzed public point: snap the precise point to its grid cell center, then
 * add a fixed per-game offset seeded from the game id. Stored as
 * `games.public_location`.
 */
export function fuzzToPublicPoint(precise: LatLng, gameId: string): LatLng {
  const snapped: LatLng = {
    lat: snapToCellCenter(precise.lat),
    lng: snapToCellCenter(precise.lng),
  };
  const bearing = seededUnit(`${gameId}:bearing`) * 2 * Math.PI;
  const dist = seededUnit(`${gameId}:dist`) * MAX_OFFSET_M;
  return offsetPoint(snapped, dist, bearing);
}

/**
 * Public display circle. Its center is offset from the TRUE point by a seeded
 * amount smaller than the radius, so the true pitch is never the circle center
 * (Strava Privacy-Zone fix).
 */
export function publicDisplayCircle(
  precise: LatLng,
  gameId: string,
): { center: LatLng; radiusMeters: number } {
  const bearing = seededUnit(`${gameId}:circle-bearing`) * 2 * Math.PI;
  // Offset between 30% and 70% of the radius: always > 0 and < radius.
  const frac = 0.3 + seededUnit(`${gameId}:circle-dist`) * 0.4;
  const center = offsetPoint(precise, DISPLAY_RADIUS_M * frac, bearing);
  return { center, radiusMeters: DISPLAY_RADIUS_M };
}

/** Coarse, human-readable distance for un-joined viewers. Never precise. */
export function roundPublicDistance(meters: number): string {
  if (meters < 500) return "under 500 m away";
  const km = Math.round(meters / 1000);
  return `about ${km} km away`;
}
```

- [ ] **Step 7: Create `packages/core/src/index.ts`**

```ts
export * from "./geo/index.js";
export * from "./skill/index.js";
export * from "./validation/index.js";
```

Note: `skill` and `validation` are added in Tasks 4–5. Until then, comment out those two re-export lines so the geo test can run; re-enable them in Task 5, Step 7. Replace this file's contents with:

```ts
export * from "./geo/index.js";
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @footylocal/core test`
Expected: PASS — all geo tests green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(core): deterministic location fuzzing with tests"
```

---

### Task 4: core/skill — v1 tier helpers (TDD)

**Files:**
- Create: `packages/core/src/skill/index.ts`, `packages/core/src/skill/skill.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const SKILL_BANDS = ["beginner","intermediate","advanced","pro"] as const`
  - `type SkillBand = (typeof SKILL_BANDS)[number]`
  - `const GAME_BANDS = [...SKILL_BANDS, "open"] as const`
  - `type GameBand = (typeof GAME_BANDS)[number]`
  - `skillRank(band: SkillBand): number`
  - `meetsBand(playerSkill: SkillBand, gameBand: GameBand): boolean`

- [ ] **Step 1: Write the failing test `packages/core/src/skill/skill.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { SKILL_BANDS, skillRank, meetsBand } from "./index.js";

describe("skillRank", () => {
  it("orders beginner < intermediate < advanced < pro", () => {
    expect(skillRank("beginner")).toBeLessThan(skillRank("intermediate"));
    expect(skillRank("intermediate")).toBeLessThan(skillRank("advanced"));
    expect(skillRank("advanced")).toBeLessThan(skillRank("pro"));
  });
  it("covers exactly the four bands", () => {
    expect(SKILL_BANDS).toEqual(["beginner", "intermediate", "advanced", "pro"]);
  });
});

describe("meetsBand", () => {
  it("lets anyone into an open game", () => {
    expect(meetsBand("beginner", "open")).toBe(true);
  });
  it("admits players at or above the game band", () => {
    expect(meetsBand("advanced", "intermediate")).toBe(true);
    expect(meetsBand("intermediate", "intermediate")).toBe(true);
  });
  it("gates players below the game band", () => {
    expect(meetsBand("beginner", "advanced")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @footylocal/core test`
Expected: FAIL — `./skill/index.js` not found.

- [ ] **Step 3: Implement `packages/core/src/skill/index.ts`**

```ts
/** v1 skill tiers: self-reported band + per-game band gating. */

export const SKILL_BANDS = [
  "beginner",
  "intermediate",
  "advanced",
  "pro",
] as const;
export type SkillBand = (typeof SKILL_BANDS)[number];

export const GAME_BANDS = [...SKILL_BANDS, "open"] as const;
export type GameBand = (typeof GAME_BANDS)[number];

/** Numeric rank of a skill band (higher = stronger). */
export function skillRank(band: SkillBand): number {
  return SKILL_BANDS.indexOf(band);
}

/** Whether a player at `playerSkill` may join a game of `gameBand`. */
export function meetsBand(playerSkill: SkillBand, gameBand: GameBand): boolean {
  if (gameBand === "open") return true;
  return skillRank(playerSkill) >= skillRank(gameBand);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @footylocal/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): v1 skill tier helpers with tests"
```

---

### Task 5: core/validation — shared Zod schemas (TDD)

**Files:**
- Create: `packages/core/src/validation/index.ts`, `packages/core/src/validation/validation.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `zod`, `SKILL_BANDS` from `../skill`.
- Produces:
  - `signUpSchema` → `{ email: string; password: string; is18Plus: true }`
  - `phoneSchema` → `{ phone: string }` (E.164)
  - `otpSchema` → `{ code: string }` (6 digits)
  - `profileUpdateSchema` → `{ displayName: string; selfReportedSkill: SkillBand }`

- [ ] **Step 1: Write the failing test `packages/core/src/validation/validation.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { signUpSchema, phoneSchema, otpSchema } from "./index.js";

describe("signUpSchema", () => {
  it("accepts a valid 18+ signup", () => {
    const r = signUpSchema.safeParse({
      email: "a@b.com",
      password: "hunter2hunter2",
      is18Plus: true,
    });
    expect(r.success).toBe(true);
  });
  it("rejects when is18Plus is false", () => {
    const r = signUpSchema.safeParse({
      email: "a@b.com",
      password: "hunter2hunter2",
      is18Plus: false,
    });
    expect(r.success).toBe(false);
  });
  it("rejects short passwords", () => {
    const r = signUpSchema.safeParse({
      email: "a@b.com",
      password: "short",
      is18Plus: true,
    });
    expect(r.success).toBe(false);
  });
});

describe("phoneSchema", () => {
  it("accepts E.164", () => {
    expect(phoneSchema.safeParse({ phone: "+14045551234" }).success).toBe(true);
  });
  it("rejects non-E.164", () => {
    expect(phoneSchema.safeParse({ phone: "404-555-1234" }).success).toBe(false);
  });
});

describe("otpSchema", () => {
  it("accepts a 6-digit code", () => {
    expect(otpSchema.safeParse({ code: "000000" }).success).toBe(true);
  });
  it("rejects non-6-digit codes", () => {
    expect(otpSchema.safeParse({ code: "12ab" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @footylocal/core test`
Expected: FAIL — `./validation/index.js` not found.

- [ ] **Step 3: Implement `packages/core/src/validation/index.ts`**

```ts
import { z } from "zod";
import { SKILL_BANDS } from "../skill/index.js";

/** Signup requires an explicit 18+ attestation (literal true). */
export const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Use at least 10 characters"),
  is18Plus: z.literal(true),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

/** E.164 phone, e.g. +14045551234. */
export const phoneSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone in E.164"),
});
export type PhoneInput = z.infer<typeof phoneSchema>;

/** 6-digit OTP code. */
export const otpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});
export type OtpInput = z.infer<typeof otpSchema>;

export const profileUpdateSchema = z.object({
  displayName: z.string().min(2).max(40),
  selfReportedSkill: z.enum(SKILL_BANDS),
});
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @footylocal/core test`
Expected: PASS.

- [ ] **Step 5: Re-enable full barrel `packages/core/src/index.ts`**

```ts
export * from "./geo/index.js";
export * from "./skill/index.js";
export * from "./validation/index.js";
```

- [ ] **Step 6: Run typecheck + full test suite**

Run: `pnpm --filter @footylocal/core typecheck && pnpm --filter @footylocal/core test`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): shared Zod validation schemas with tests"
```

---

### Task 6: ui — design tokens, Tailwind v4 theme, primitives

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/src/tokens/index.ts`, `packages/ui/src/theme.css`, `packages/ui/src/primitives/Button.tsx`, `packages/ui/src/primitives/Badge.tsx`, `packages/ui/src/primitives/Card.tsx`, `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `react`.
- Produces:
  - `tokens` object (colors/typography/spacing) — TS source of truth.
  - `theme.css` — Tailwind v4 `@theme` mirror, imported by the web app.
  - `Button`, `Badge`, `Card` React components.

- [ ] **Step 1: Create `packages/ui/package.json`**

```json
{
  "name": "@footylocal/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./tokens": "./src/tokens/index.ts",
    "./theme.css": "./src/theme.css"
  },
  "scripts": { "typecheck": "tsc --noEmit" },
  "peerDependencies": { "react": "^19.0.0" },
  "devDependencies": {
    "@footylocal/config": "workspace:*",
    "@types/react": "^19.0.0",
    "react": "^19.0.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/ui/tsconfig.json`**

```json
{
  "extends": "@footylocal/config/tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/ui/src/tokens/index.ts`**

```ts
/** Design tokens — source of truth for JS/native. Mirrored in theme.css for
 * Tailwind v4. Keep the two in sync (see DECISIONS.md). */
export const tokens = {
  color: {
    surface: "#FFFFFF",
    ink: "#111111",
    gray: "#F5F5F5",
    accent: "#CCFF00", // electric volt
    error: "#E5484D",
    success: "#30A46C",
  },
  font: {
    display: '"Anton", system-ui, sans-serif',
    body: '"Inter", system-ui, sans-serif',
  },
  radius: {
    pill: "9999px",
    card: "20px",
  },
} as const;

export type Tokens = typeof tokens;
```

- [ ] **Step 4: Create `packages/ui/src/theme.css`**

```css
/* Tailwind v4 theme mirror of packages/ui/src/tokens. Imported by the web app
   after `@import "tailwindcss";`. */
@theme {
  --color-surface: #ffffff;
  --color-ink: #111111;
  --color-gray: #f5f5f5;
  --color-accent: #ccff00;
  --color-error: #e5484d;
  --color-success: #30a46c;

  --font-display: "Anton", system-ui, sans-serif;
  --font-body: "Inter", system-ui, sans-serif;

  --radius-pill: 9999px;
  --radius-card: 20px;
}
```

- [ ] **Step 5: Create `packages/ui/src/primitives/Button.tsx`**

```tsx
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "accent";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/** Pill CTA. `primary` = black on white; `accent` = volt on black. */
export function Button({
  variant = "primary",
  className = "",
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-[var(--radius-pill)] px-8 py-4 text-sm font-semibold uppercase tracking-wide transition-transform active:scale-95 disabled:opacity-40";
  const styles: Record<Variant, string> = {
    primary: "bg-ink text-surface",
    accent: "bg-ink text-accent",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...rest} />;
}
```

- [ ] **Step 6: Create `packages/ui/src/primitives/Badge.tsx`**

```tsx
import type { ReactNode } from "react";

export interface BadgeProps {
  children: ReactNode;
  tone?: "ink" | "accent";
}

/** Small uppercase pill used for skill band / verification. */
export function Badge({ children, tone = "ink" }: BadgeProps) {
  const styles =
    tone === "accent"
      ? "bg-accent text-ink"
      : "bg-ink text-surface";
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-pill)] px-3 py-1 text-xs font-semibold uppercase tracking-wide ${styles}`}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 7: Create `packages/ui/src/primitives/Card.tsx`**

```tsx
import type { ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  className?: string;
}

/** Photography-forward card shell. */
export function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`overflow-hidden rounded-[var(--radius-card)] bg-surface ${className}`}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 8: Create `packages/ui/src/index.ts`**

```ts
export { tokens } from "./tokens/index.js";
export type { Tokens } from "./tokens/index.js";
export { Button } from "./primitives/Button.js";
export type { ButtonProps } from "./primitives/Button.js";
export { Badge } from "./primitives/Badge.js";
export type { BadgeProps } from "./primitives/Badge.js";
export { Card } from "./primitives/Card.js";
export type { CardProps } from "./primitives/Card.js";
```

- [ ] **Step 9: Install and typecheck**

Run: `pnpm install && pnpm --filter @footylocal/ui typecheck`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(ui): design tokens, Tailwind v4 theme, pill/badge/card primitives"
```

---

### Task 7: db — Drizzle schema (enums + all tables, non-geo columns)

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`, `packages/db/src/schema/enums.ts`, `packages/db/src/schema/index.ts`

**Interfaces:**
- Consumes: `drizzle-orm`, `@footylocal/config`.
- Produces: exported Drizzle tables `profiles, venues, games, gamePlayers, ratings, reports, blocks, tournaments, tournamentTeams, tournamentMatches, standings, trustedContacts` and all `pgEnum`s. Geography columns are NOT in Drizzle; they are added by SQL migration (Task 8).

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@footylocal/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/client.ts",
    "./schema": "./src/schema/index.ts"
  },
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate",
    "sql": "tsx scripts/apply-sql.ts",
    "seed": "tsx src/seed/venues.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "@footylocal/config": "workspace:*",
    "drizzle-kit": "^0.28.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "@footylocal/config/tsconfig.base.json",
  "include": ["src", "scripts", "drizzle.config.ts"]
}
```

- [ ] **Step 3: Create `packages/db/drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
```

- [ ] **Step 4: Create `packages/db/src/schema/enums.ts`**

```ts
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
```

- [ ] **Step 5: Create `packages/db/src/schema/index.ts`**

```ts
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
} from "./enums.js";

export * from "./enums.js";

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
```

- [ ] **Step 6: Typecheck**

Run: `pnpm install && pnpm --filter @footylocal/db typecheck`
Expected: PASS.

- [ ] **Step 7: Generate the Drizzle migration**

Run: `pnpm --filter @footylocal/db generate`
Expected: creates `packages/db/migrations/0000_*.sql` + snapshot. (No DB connection needed to generate.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(db): Drizzle schema for all tables + enums; generate migration"
```

---

### Task 8: db — PostGIS SQL migrations (geo columns, indexes, RLS, RPC, trigger)

**Files:**
- Create: `packages/db/migrations/sql/0001_postgis.sql`, `.../0002_rls.sql`, `.../0003_games_near.sql`, `.../0004_profile_trigger.sql`, `packages/db/scripts/apply-sql.ts`

**Interfaces:**
- Consumes: tables from Task 7 (already migrated by drizzle-kit).
- Produces: geography columns + GiST indexes; RLS enabled with policies; `games_near(lat,lng,radius_meters,filters)` RPC; `handle_new_user` trigger creating a `profiles` row.

- [ ] **Step 1: Create `packages/db/migrations/sql/0001_postgis.sql`**

```sql
-- PostGIS extension + geography columns + GiST indexes.
create extension if not exists postgis;

alter table venues add column if not exists location geography(Point, 4326);
alter table games  add column if not exists precise_location geography(Point, 4326);
alter table games  add column if not exists public_location  geography(Point, 4326);

create index if not exists venues_location_gix
  on venues using gist (location);
create index if not exists games_precise_location_gix
  on games using gist (precise_location);
create index if not exists games_public_location_gix
  on games using gist (public_location);
```

- [ ] **Step 2: Create `packages/db/migrations/sql/0002_rls.sql`**

```sql
-- Enable RLS on every table and add baseline policies.
alter table profiles          enable row level security;
alter table venues            enable row level security;
alter table games             enable row level security;
alter table game_players      enable row level security;
alter table ratings           enable row level security;
alter table reports           enable row level security;
alter table blocks            enable row level security;
alter table tournaments       enable row level security;
alter table tournament_teams  enable row level security;
alter table tournament_matches enable row level security;
alter table standings         enable row level security;
alter table trusted_contacts  enable row level security;

-- profiles: anyone can read; users write only their own row.
create policy profiles_read on profiles for select using (true);
create policy profiles_write_own on profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);
create policy profiles_insert_own on profiles for insert
  with check (auth.uid() = id);

-- venues: verified venues readable by all; no client writes (seeded by service role).
create policy venues_read_verified on venues for select using (is_verified = true);

-- games: open games readable by all (precise column protected by RPC, not here);
-- hosts manage only their own games.
create policy games_read_open on games for select
  using (status in ('open','confirmed','completed'));
create policy games_host_all on games for all
  using (auth.uid() = host_id) with check (auth.uid() = host_id);

-- game_players: a player sees rosters of games they're on; writes only own rows.
create policy game_players_read on game_players for select
  using (
    auth.uid() = player_id
    or exists (
      select 1 from game_players gp
      where gp.game_id = game_players.game_id and gp.player_id = auth.uid()
    )
  );
create policy game_players_write_own on game_players for all
  using (auth.uid() = player_id) with check (auth.uid() = player_id);

-- ratings: raters manage their own ratings; ratees can read ratings about them.
create policy ratings_rw_own on ratings for all
  using (auth.uid() = rater_id) with check (auth.uid() = rater_id);
create policy ratings_read_about_me on ratings for select
  using (auth.uid() = ratee_id);

-- reports: reporters manage their own reports.
create policy reports_rw_own on reports for all
  using (auth.uid() = reporter_id) with check (auth.uid() = reporter_id);

-- blocks: users manage their own block list.
create policy blocks_rw_own on blocks for all
  using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- tournaments: readable by all; hosts manage their own.
create policy tournaments_read on tournaments for select using (true);
create policy tournaments_host_all on tournaments for all
  using (auth.uid() = host_id) with check (auth.uid() = host_id);
create policy tournament_teams_read on tournament_teams for select using (true);
create policy tournament_matches_read on tournament_matches for select using (true);
create policy standings_read on standings for select using (true);

-- trusted_contacts: strictly private to the owner.
create policy trusted_contacts_rw_own on trusted_contacts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 3: Create `packages/db/migrations/sql/0003_games_near.sql`**

```sql
-- SECURITY DEFINER RPC: returns fuzzed public_location to everyone, and the
-- precise_location ONLY for games the caller is on the roster of.
create or replace function games_near(
  lat double precision,
  lng double precision,
  radius_meters integer,
  filters jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  title text,
  skill_band skill_band,
  format game_format,
  price_cents integer,
  starts_at timestamptz,
  is_women_only boolean,
  public_lat double precision,
  public_lng double precision,
  precise_lat double precision,
  precise_lng double precision,
  distance_meters double precision
)
language sql
security definer
set search_path = public
as $$
  select
    g.id,
    g.title,
    g.skill_band,
    g.format,
    g.price_cents,
    g.starts_at,
    g.is_women_only,
    st_y(g.public_location::geometry) as public_lat,
    st_x(g.public_location::geometry) as public_lng,
    case when joined.player_id is not null
         then st_y(g.precise_location::geometry) end as precise_lat,
    case when joined.player_id is not null
         then st_x(g.precise_location::geometry) end as precise_lng,
    st_distance(
      g.public_location,
      st_makepoint(lng, lat)::geography
    ) as distance_meters
  from games g
  left join game_players joined
    on joined.game_id = g.id
   and joined.player_id = auth.uid()
   and joined.status = 'joined'
  where g.status in ('open', 'confirmed')
    and st_dwithin(
      g.public_location,
      st_makepoint(lng, lat)::geography,
      radius_meters
    )
    and (filters->>'skill_band' is null
         or g.skill_band = (filters->>'skill_band')::skill_band)
    and (filters->>'women_only' is null
         or g.is_women_only = (filters->>'women_only')::boolean)
  order by distance_meters asc;
$$;

grant execute on function games_near(double precision, double precision, integer, jsonb)
  to anon, authenticated;
```

- [ ] **Step 4: Create `packages/db/migrations/sql/0004_profile_trigger.sql`**

```sql
-- Create a profiles row automatically when an auth user is created, carrying
-- the 18+ attestation captured at signup (passed in user metadata).
alter table profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade
  not valid;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, is_18_plus)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'is_18_plus')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

- [ ] **Step 5: Create `packages/db/scripts/apply-sql.ts`**

```ts
/** Applies migrations/sql/*.sql in filename order against DATABASE_URL. */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(here, "..", "migrations", "sql");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });
  try {
    const files = readdirSync(sqlDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const text = readFileSync(join(sqlDir, file), "utf8");
      process.stdout.write(`applying ${file}... `);
      await sql.unsafe(text);
      process.stdout.write("ok\n");
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Typecheck the script**

Run: `pnpm --filter @footylocal/db typecheck`
Expected: PASS.

- [ ] **Step 7: Commit** (application against a live DB happens in Task 11)

```bash
git add -A
git commit -m "feat(db): PostGIS columns, GiST, RLS, games_near RPC, profile trigger"
```

---

### Task 9: db — Supabase client factories + venue seed

**Files:**
- Create: `packages/db/src/client.ts`, `packages/db/src/seed/venues.ts`

**Interfaces:**
- Consumes: `@supabase/supabase-js`, env vars.
- Produces:
  - `createServiceClient(): SupabaseClient` — service-role, server-only, RLS-bypassing.
  - `SEED_VENUES` data + a runnable seed that inserts them with real coordinates.

- [ ] **Step 1: Create `packages/db/src/client.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Server-only — bypasses RLS. NEVER import into client
 * bundles. Used for seeding and privileged jobs.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

- [ ] **Step 2: Create `packages/db/src/seed/venues.ts`**

```ts
/** Seeds ~6 verified public venues. Run: pnpm --filter @footylocal/db seed */
import { createServiceClient } from "../client.js";

type SeedVenue = {
  name: string;
  address: string;
  surface_type: "turf" | "grass" | "indoor" | "court" | "street";
  lat: number;
  lng: number;
};

export const SEED_VENUES: SeedVenue[] = [
  { name: "Piedmont Park Active Oval", address: "400 Park Dr NE, Atlanta, GA", surface_type: "grass", lat: 33.7859, lng: -84.3733 },
  { name: "Grant Park Field", address: "840 Cherokee Ave SE, Atlanta, GA", surface_type: "grass", lat: 33.7377, lng: -84.3699 },
  { name: "Historic Fourth Ward Turf", address: "680 Dallas St NE, Atlanta, GA", surface_type: "turf", lat: 33.7616, lng: -84.3653 },
  { name: "Westside Park Pitch", address: "1660 Johnson Rd NW, Atlanta, GA", surface_type: "turf", lat: 33.7961, lng: -84.4308 },
  { name: "Chastain Park Court", address: "216 W Wieuca Rd NW, Atlanta, GA", surface_type: "court", lat: 33.8858, lng: -84.3831 },
  { name: "Decatur Indoor Soccer", address: "245 Pharr Rd, Decatur, GA", surface_type: "indoor", lat: 33.7748, lng: -84.2963 },
];

async function main(): Promise<void> {
  const supabase = createServiceClient();
  for (const v of SEED_VENUES) {
    // Insert non-geo columns via the SDK, then set geography via RPC-free SQL
    // using a PostGIS point. We use the service role and a raw RPC helper.
    const { data, error } = await supabase
      .from("venues")
      .upsert(
        {
          name: v.name,
          address: v.address,
          surface_type: v.surface_type,
          is_verified: true,
        },
        { onConflict: "name" },
      )
      .select("id")
      .single();
    if (error) throw error;

    const { error: geoErr } = await supabase.rpc("set_venue_location", {
      venue_id: data.id,
      lat: v.lat,
      lng: v.lng,
    });
    if (geoErr) throw geoErr;
    process.stdout.write(`seeded ${v.name}\n`);
  }
  process.stdout.write("done\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Add the `set_venue_location` helper to `packages/db/migrations/sql/0001_postgis.sql`**

Append to the end of `0001_postgis.sql`:

```sql
-- Helper so seeds can set a venue's geography point by lat/lng.
create or replace function set_venue_location(venue_id uuid, lat double precision, lng double precision)
returns void
language sql
security definer
set search_path = public
as $$
  update venues set location = st_makepoint(lng, lat)::geography where id = venue_id;
$$;
```

Also add a unique constraint on venue name so upsert works — append to `0001_postgis.sql`:

```sql
alter table venues add constraint venues_name_unique unique (name);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm install && pnpm --filter @footylocal/db typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): service client factory + verified-venue seed"
```

---

### Task 10: Supabase project setup guide (user-run) + DB bring-up

**Files:**
- Create: `docs/SUPABASE_SETUP.md`

**Interfaces:**
- Consumes: everything in Tasks 7–9.
- Produces: a live database with schema, PostGIS, RLS, RPC, and seeded venues; a filled-in local `.env`.

> This task is executed by the USER (they hold the keys). The implementer writes the doc and runs the migrate/sql/seed commands once the user reports `.env` is filled.

- [ ] **Step 1: Create `docs/SUPABASE_SETUP.md`**

```markdown
# Supabase Setup (hosted, Phase 0)

1. Go to https://supabase.com → New project. Pick a region near you. Save the
   database password.
2. Project Settings → API:
   - Copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`.
   - Copy **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - Copy **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret).
3. Project Settings → Database → Connection string → **URI** (Session pooler is
   fine). Put it in `DATABASE_URL`, inserting your DB password.
4. Auth → Providers → Email: enable. (Phone provider stays OFF in Phase 0 — we
   stub OTP in dev.)
5. Copy `.env.example` to `.env` and paste all four values.
6. Tell your engineer the `.env` is ready.

## Applying schema (engineer runs)
```bash
pnpm --filter @footylocal/db migrate   # Drizzle: tables + enums
pnpm --filter @footylocal/db sql       # PostGIS, RLS, games_near, trigger
pnpm --filter @footylocal/db seed      # 6 verified venues
```

## Verify
In Supabase SQL editor:
```sql
select count(*) from venues where is_verified;      -- 6
select * from games_near(33.749, -84.388, 20000);   -- runs, returns 0 rows
```
```

- [ ] **Step 2: Wait for the user to confirm `.env` is filled, then apply migrations**

Run (only after user confirms):
```bash
pnpm --filter @footylocal/db migrate
pnpm --filter @footylocal/db sql
pnpm --filter @footylocal/db seed
```
Expected: migrate creates tables; sql prints `applying 0001..0004 ok`; seed prints 6 `seeded ...` lines.

- [ ] **Step 3: Verify in SQL editor** (paste the two queries from the doc)

Expected: `count = 6`; `games_near(...)` returns 0 rows without error.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: Supabase setup guide; bring up hosted DB"
```

---

### Task 11: web — Next.js app scaffold + Tailwind v4 + fonts

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`

**Interfaces:**
- Consumes: `@footylocal/ui` (theme.css + primitives), `@footylocal/core`.
- Produces: a booting Next.js app at `/` that redirects to `/discover`.

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@footylocal/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@footylocal/core": "workspace:*",
    "@footylocal/db": "workspace:*",
    "@footylocal/ui": "workspace:*",
    "@supabase/ssr": "^0.5.0",
    "@supabase/supabase-js": "^2.45.0",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@footylocal/config": "workspace:*",
    "@tailwindcss/postcss": "^4.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "@footylocal/config/tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] },
    "noEmit": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `apps/web/next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@footylocal/ui", "@footylocal/core", "@footylocal/db"],
};

export default nextConfig;
```

- [ ] **Step 4: Create `apps/web/postcss.config.mjs`**

```js
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

- [ ] **Step 5: Create `apps/web/app/globals.css`**

```css
@import "tailwindcss";
@import "@footylocal/ui/theme.css";

/* Load display + body faces. Anton (display) + Inter (body) via Google Fonts. */
@import url("https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap");

body {
  background: var(--color-surface);
  color: var(--color-ink);
  font-family: var(--font-body);
}

.display {
  font-family: var(--font-display);
  text-transform: uppercase;
  line-height: 0.9;
  letter-spacing: -0.01em;
}
```

- [ ] **Step 6: Create `apps/web/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FootyLocal",
  description: "Find, join, and host local pickup soccer.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Create `apps/web/app/page.tsx`**

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/discover");
}
```

- [ ] **Step 8: Install, build, and boot**

Run: `pnpm install && pnpm --filter @footylocal/web build`
Expected: build succeeds (redirect from `/`). If fonts warning appears, ignore.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(web): Next.js App Router scaffold with Tailwind v4 tokens"
```

---

### Task 12: web — Supabase auth clients + middleware session

**Files:**
- Create: `apps/web/lib/supabase/client.ts`, `apps/web/lib/supabase/server.ts`, `apps/web/lib/supabase/middleware.ts`, `apps/web/middleware.ts`

**Interfaces:**
- Consumes: `@supabase/ssr`, env vars.
- Produces:
  - `createBrowserClient()` (client components).
  - `createServerClient()` (server components / actions, cookie-bound).
  - `updateSession(request)` for middleware refresh + route protection.

- [ ] **Step 1: Create `apps/web/lib/supabase/client.ts`**

```ts
"use client";
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 2: Create `apps/web/lib/supabase/server.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component; middleware refreshes the session.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 3: Create `apps/web/lib/supabase/middleware.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/sign-in", "/verify-phone", "/auth"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }
  return response;
}
```

- [ ] **Step 4: Create `apps/web/middleware.ts`**

```ts
import { type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @footylocal/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): Supabase SSR clients + session middleware with route guard"
```

---

### Task 13: web — auth screens + server actions (email signup + dev phone-OTP)

**Files:**
- Create: `apps/web/app/(auth)/actions.ts`, `apps/web/app/(auth)/sign-in/page.tsx`, `apps/web/app/(auth)/verify-phone/page.tsx`

**Interfaces:**
- Consumes: `signUpSchema`, `phoneSchema`, `otpSchema` from `@footylocal/core`; server Supabase client.
- Produces: server actions `signInAction`, `signUpAction`, `verifyPhoneAction`; two rendered screens.

- [ ] **Step 1: Create `apps/web/app/(auth)/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { signUpSchema, otpSchema } from "@footylocal/core";
import { createClient } from "@/lib/supabase/server";

/** Email + password sign-in. */
export async function signInAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
  if (error) redirect(`/sign-in?error=${encodeURIComponent(error.message)}`);
  redirect("/discover");
}

/** Email + password sign-up with a required 18+ attestation. */
export async function signUpAction(formData: FormData): Promise<void> {
  const parsed = signUpSchema.safeParse({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
    is18Plus: formData.get("is18Plus") === "on",
  });
  if (!parsed.success) {
    redirect(`/sign-in?error=${encodeURIComponent(parsed.error.issues[0]!.message)}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { is_18_plus: true } },
  });
  if (error) redirect(`/sign-in?error=${encodeURIComponent(error.message)}`);
  // Phone verification is required before join/host. Send them to the gate.
  redirect("/verify-phone");
}

/**
 * Dev-stubbed phone verification. In Phase 0 there is no SMS provider: we accept
 * the DEV_PHONE_OTP_CODE and flip profiles.phone_verified. A later phase swaps
 * this for Supabase phone OTP.
 */
export async function verifyPhoneAction(formData: FormData): Promise<void> {
  const parsed = otpSchema.safeParse({ code: String(formData.get("code")) });
  const expected = process.env.DEV_PHONE_OTP_CODE ?? "000000";
  if (!parsed.success || parsed.data.code !== expected) {
    redirect(`/verify-phone?error=${encodeURIComponent("Invalid code")}`);
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  const { error } = await supabase
    .from("profiles")
    .update({ phone_verified: true, verification_level: "phone" })
    .eq("id", user.id);
  if (error) redirect(`/verify-phone?error=${encodeURIComponent(error.message)}`);
  redirect("/discover");
}
```

- [ ] **Step 2: Create `apps/web/app/(auth)/sign-in/page.tsx`**

```tsx
import { Button } from "@footylocal/ui";
import { signInAction, signUpAction } from "../actions";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6">
      <h1 className="display text-6xl">Footy&nbsp;Local</h1>
      {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}

      <form className="flex flex-col gap-3">
        <input name="email" type="email" required placeholder="Email"
          className="rounded-2xl bg-gray px-5 py-4" />
        <input name="password" type="password" required placeholder="Password"
          className="rounded-2xl bg-gray px-5 py-4" />
        <Button formAction={signInAction}>Sign in</Button>
      </form>

      <form className="flex flex-col gap-3">
        <input name="email" type="email" required placeholder="Email (new account)"
          className="rounded-2xl bg-gray px-5 py-4" />
        <input name="password" type="password" required placeholder="Password (min 10)"
          className="rounded-2xl bg-gray px-5 py-4" />
        <label className="flex items-center gap-2 text-sm">
          <input name="is18Plus" type="checkbox" /> I am 18 or older
        </label>
        <Button variant="accent" formAction={signUpAction}>Create account</Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Create `apps/web/app/(auth)/verify-phone/page.tsx`**

```tsx
import { Button } from "@footylocal/ui";
import { verifyPhoneAction } from "../actions";

export default async function VerifyPhone({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <h1 className="display text-5xl">Verify your phone</h1>
      <p className="text-sm text-neutral-600">
        Phone verification is required before you can join or host a game. In
        development, enter <code>000000</code>.
      </p>
      {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}
      <form className="flex flex-col gap-3">
        <input name="code" inputMode="numeric" placeholder="6-digit code"
          className="rounded-2xl bg-gray px-5 py-4 tracking-[0.5em]" />
        <Button formAction={verifyPhoneAction}>Verify</Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS.

- [ ] **Step 5: Manual smoke test** (requires live DB from Task 10)

Run: `pnpm dev`, open http://localhost:3000 → redirected to `/sign-in`. Create an account (check 18+), land on `/verify-phone`, enter `000000`, land on `/discover`. In Supabase, `select phone_verified from profiles` shows `true` for the new user.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): email signup + dev phone-OTP verification flow"
```

---

### Task 14: web — five-tab shell + empty Discover + placeholder tabs

**Files:**
- Create: `apps/web/app/(tabs)/layout.tsx`, `apps/web/app/(tabs)/discover/page.tsx`, `apps/web/app/(tabs)/my-games/page.tsx`, `apps/web/app/(tabs)/host/page.tsx`, `apps/web/app/(tabs)/messages/page.tsx`, `apps/web/app/(tabs)/profile/page.tsx`

**Interfaces:**
- Consumes: `@footylocal/ui` primitives; server Supabase client (to show verify banner).
- Produces: the bottom-tab shell; empty Discover; four placeholder tabs.

- [ ] **Step 1: Create `apps/web/app/(tabs)/layout.tsx`**

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const TABS = [
  { href: "/discover", label: "Discover" },
  { href: "/my-games", label: "My Games" },
  { href: "/host", label: "Host" },
  { href: "/messages", label: "Messages" },
  { href: "/profile", label: "Profile" },
];

export default async function TabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let phoneVerified = true;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("phone_verified")
      .eq("id", user.id)
      .single();
    phoneVerified = data?.phone_verified ?? false;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
      {!phoneVerified && (
        <Link href="/verify-phone"
          className="bg-accent px-6 py-3 text-sm font-semibold uppercase text-ink">
          Verify your phone to join or host →
        </Link>
      )}
      <div className="flex-1 px-6 py-8">{children}</div>
      <nav className="sticky bottom-0 flex justify-around border-t border-gray bg-surface py-3">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href}
            className="text-xs font-semibold uppercase tracking-wide">
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
```

Note: active-tab accent highlighting needs the current path. Add a small client component in Step 2.

- [ ] **Step 2: Replace the `<nav>` with an active-aware client component**

Create `apps/web/app/(tabs)/TabBar.tsx`:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/discover", label: "Discover" },
  { href: "/my-games", label: "My Games" },
  { href: "/host", label: "Host" },
  { href: "/messages", label: "Messages" },
  { href: "/profile", label: "Profile" },
];

export function TabBar() {
  const path = usePathname();
  return (
    <nav className="sticky bottom-0 flex justify-around border-t border-gray bg-surface py-3">
      {TABS.map((t) => {
        const active = path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href}
            className={`text-xs font-semibold uppercase tracking-wide ${
              active ? "text-ink" : "text-neutral-400"
            }`}>
            {active ? <span className="text-accent">●</span> : null} {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

Then in `layout.tsx`, replace the inline `<nav>…</nav>` with `<TabBar />` and import it: `import { TabBar } from "./TabBar";`. Remove the now-unused `Link`/`TABS` from the layout (keep the `Link` used by the verify banner).

- [ ] **Step 3: Create `apps/web/app/(tabs)/discover/page.tsx`** (empty state)

```tsx
import { Button } from "@footylocal/ui";

export default function Discover() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="display text-7xl">Discover</h1>
      <p className="max-w-sm text-neutral-600">
        No games near you yet. The map and nearby games arrive in the next phase.
      </p>
      <div className="grid h-64 place-items-center rounded-[var(--radius-card)] bg-gray">
        <span className="display text-3xl text-neutral-300">Map coming soon</span>
      </div>
      <Button variant="accent" disabled>Host the first game</Button>
    </section>
  );
}
```

- [ ] **Step 4: Create the four placeholder tabs**

`apps/web/app/(tabs)/my-games/page.tsx`:

```tsx
export default function MyGames() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="display text-6xl">My Games</h1>
      <p className="text-neutral-600">Your upcoming, past, and hosted games live here.</p>
    </section>
  );
}
```

`apps/web/app/(tabs)/host/page.tsx`:

```tsx
export default function Host() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="display text-6xl">Host</h1>
      <p className="text-neutral-600">Create a game or tournament. Arrives in Phase 1.</p>
    </section>
  );
}
```

`apps/web/app/(tabs)/messages/page.tsx`:

```tsx
export default function Messages() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="display text-6xl">Messages</h1>
      <p className="text-neutral-600">Per-game boards and host announcements.</p>
    </section>
  );
}
```

`apps/web/app/(tabs)/profile/page.tsx`:

```tsx
export default function Profile() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="display text-6xl">Profile</h1>
      <p className="text-neutral-600">Verification badges, skill band, karma, settings.</p>
    </section>
  );
}
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS; routes `/discover`, `/my-games`, `/host`, `/messages`, `/profile` compile.

- [ ] **Step 6: Manual smoke test**

Run: `pnpm dev`. Signed-in + verified user sees Discover empty state and can tab between all five; the active tab shows the accent dot. An unverified user sees the volt "Verify your phone" banner.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): five-tab shell, empty Discover, placeholder tabs"
```

---

## Final Verification (Definition of Done)

- [ ] `pnpm install && pnpm typecheck` — clean across all packages.
- [ ] `pnpm --filter @footylocal/core test` — geo + skill + validation green.
- [ ] `pnpm --filter @footylocal/web build` — succeeds.
- [ ] Supabase: `select count(*) from venues where is_verified;` → 6; RLS enabled on all 12 tables; `games_near(...)` runs.
- [ ] Sign up (18+) → verify-phone (`000000`) → `/discover`; `profiles.phone_verified = true`.
- [ ] Five tabs render; Discover shows empty state; unverified users see the verify banner.
- [ ] No real secrets committed (`git log -p | grep -i service_role` finds nothing but `.env.example` placeholders).

## Self-Review Notes (author)

- **Spec coverage:** monorepo (§8→T1–T2,T6,T7,T9,T11), tokens/primitives (§6→T6), geo fuzzing (§3.2→T3), skill v1 (§ skill→T4), validation (T5), all tables + RLS + RPC (§3.1,§3.3,§4→T7,T8), auth + phone gate + 18+ (§5→T13), seeded venues (§4→T9,T10), empty Discover + tabs (§7→T14), env/secrets (§9→T1,T10). Google Maps key scoping documented in README (T1) though unused in Phase 0. All DoD items (§11) covered.
- **Deferred-but-created:** tournaments/trusted_contacts tables exist (T7) with RLS (T8), no UI — matches spec.
- **Type consistency:** `createServiceClient` (T9) used by seed (T9); `createClient` server/browser names distinct by file; `games_near` column names match between RPC (T8) and the DoD query.
- **Known follow-up:** real SMS provider, Google Map render, host/join flows are Phase 1+ and intentionally absent.
```

