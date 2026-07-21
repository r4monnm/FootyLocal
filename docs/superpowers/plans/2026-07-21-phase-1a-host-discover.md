# FootyLocal Phase 1a: Host + Discover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-verified user hosts a game at a verified venue (server-side deterministic fuzzing, tamper-proof), and everyone discovers open games on a Google Map (clustered, fuzzed pins) + list, powered by an extended `games_near`, with filters and geolocation.

**Architecture:** Fuzzing stays in `packages/core`; the game-create write path is a server-only `packages/db` `createGame()` that uses the service client + core fuzzing and calls a `service_role`-only `create_game` SQL RPC (so a client can't inject an un-fuzzed `public_location`). Discover is a client view that queries the extended `games_near` RPC directly through the browser (anon-key, RLS-safe — precise coords never returned to non-roster callers). Google Maps loads via `@googlemaps/js-api-loader` with clustering; a missing key degrades to a working list.

**Tech Stack:** TypeScript strict, Next.js App Router, Supabase (Postgres + PostGIS + RPC), Drizzle-managed schema, `@googlemaps/js-api-loader` + `@googlemaps/markerclusterer`, Zod, Vitest.

## Global Constraints

- Inherits all Phase 0 constraints (TS strict/no-any, RLS on every table, verified-venues-only, deterministic write-time fuzzing, no precise-coordinate leakage to non-roster clients, design tokens: pills/circles + volt `#CCFF00` accent + condensed uppercase display, no gradients).
- **Fuzzing runs server-side only.** `public_location` is computed on the server via `packages/core`'s `fuzzToPublicPoint`; the client never supplies or influences it. `create_game` is granted **only** to `service_role`.
- Distances shown to non-roster users are coarse (`roundPublicDistance`), never precise.
- The Maps key is `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, referrer-restricted, scoped to Maps JavaScript API + Places API. Missing key → graceful fallback, list still works.
- The live DB (Supabase project `komtjbzslcfpctincdpa`) is already provisioned. Apply new SQL with `.env` sourced: `set -a; . ./.env; set +a` before `pnpm --filter @footylocal/db ...`.
- Frequent commits: each task ends committed.

---

## File Structure

```
packages/core/
  src/game/index.ts            # GAME_FORMATS, GameFormat, DiscoverFilters, toGamesNearFilters
  src/game/game.test.ts
  src/validation/index.ts      # + gameCreateSchema, GameCreateInput
  src/validation/validation.test.ts  # + gameCreateSchema tests
  src/index.ts                 # + export game
packages/db/
  package.json                 # + @footylocal/core dep, ./games export
  src/games.ts                 # createGame(hostId, input) — server-only
  src/seed/games.ts            # demo games seed
  migrations/sql/0005_venue_latlng.sql
  migrations/sql/0006_create_game.sql
  migrations/sql/0007_games_near_rebuild.sql
apps/web/
  package.json                 # + @googlemaps/js-api-loader, @googlemaps/markerclusterer
  app/(tabs)/host/page.tsx     # server: fetch venues, render HostGameForm (or verify prompt)
  app/(tabs)/host/actions.ts   # hostGameAction server action
  app/(tabs)/host/HostGameForm.tsx
  app/(tabs)/discover/page.tsx # server shell -> DiscoverView
  app/(tabs)/discover/DiscoverView.tsx   # client: geolocation + games_near + toggle
  app/(tabs)/discover/FilterBar.tsx
  app/(tabs)/discover/DiscoverList.tsx
  app/(tabs)/discover/DiscoverMap.tsx    # Google Map + clustering + fallback
  app/(tabs)/discover/GamePreview.tsx
  app/(tabs)/discover/types.ts # NearbyGame row type (games_near result)
  lib/maps/loader.ts           # loadGoogleMaps()
```

---

### Task 1: core — game constants, gameCreateSchema, discover filters (TDD)

**Files:**
- Create: `packages/core/src/game/index.ts`, `packages/core/src/game/game.test.ts`
- Modify: `packages/core/src/validation/index.ts`, `packages/core/src/validation/validation.test.ts`, `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `GAME_FORMATS = ["five_a_side","seven_a_side","eleven_a_side","other"] as const`; `type GameFormat`
  - `type DiscoverFilters = { skillBand?: GameBand; format?: GameFormat; priceMaxCents?: number; startsAfter?: string; startsBefore?: string; womenOnly?: boolean; radiusMeters: number }`
  - `toGamesNearFilters(f: DiscoverFilters): Record<string, unknown>`
  - `gameCreateSchema` (Zod) and `type GameCreateInput` (with `startsAt: Date`, `endsAt: Date`)
- Consumes: `GAME_BANDS` from skill.

- [ ] **Step 1: Write `packages/core/src/game/game.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { GAME_FORMATS, toGamesNearFilters } from "./index.js";

describe("GAME_FORMATS", () => {
  it("matches the DB game_format enum values", () => {
    expect(GAME_FORMATS).toEqual([
      "five_a_side",
      "seven_a_side",
      "eleven_a_side",
      "other",
    ]);
  });
});

describe("toGamesNearFilters", () => {
  it("omits unset keys", () => {
    expect(toGamesNearFilters({ radiusMeters: 5000 })).toEqual({});
  });
  it("maps set keys to the games_near jsonb shape", () => {
    const out = toGamesNearFilters({
      radiusMeters: 5000,
      skillBand: "intermediate",
      format: "five_a_side",
      priceMaxCents: 500,
      startsAfter: "2026-08-01T00:00:00.000Z",
      startsBefore: "2026-08-02T00:00:00.000Z",
      womenOnly: true,
    });
    expect(out).toEqual({
      skill_band: "intermediate",
      format: "five_a_side",
      price_max_cents: 500,
      starts_after: "2026-08-01T00:00:00.000Z",
      starts_before: "2026-08-02T00:00:00.000Z",
      women_only: true,
    });
  });
  it("omits womenOnly when false", () => {
    expect(toGamesNearFilters({ radiusMeters: 5000, womenOnly: false })).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @footylocal/core test`
Expected: FAIL — `./game/index.js` not found.

- [ ] **Step 3: Implement `packages/core/src/game/index.ts`**

```ts
/** Game formats + discovery filter serialization. */
import type { GameBand } from "../skill/index.js";

export const GAME_FORMATS = [
  "five_a_side",
  "seven_a_side",
  "eleven_a_side",
  "other",
] as const;
export type GameFormat = (typeof GAME_FORMATS)[number];

export type DiscoverFilters = {
  skillBand?: GameBand;
  format?: GameFormat;
  priceMaxCents?: number;
  startsAfter?: string; // ISO
  startsBefore?: string; // ISO
  womenOnly?: boolean;
  radiusMeters: number;
};

/** Serialize UI filter state into the `games_near` jsonb argument. `radiusMeters`
 * is passed as a separate RPC arg, not in the jsonb, so it is not included. */
export function toGamesNearFilters(f: DiscoverFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.skillBand) out.skill_band = f.skillBand;
  if (f.format) out.format = f.format;
  if (f.priceMaxCents != null) out.price_max_cents = f.priceMaxCents;
  if (f.startsAfter) out.starts_after = f.startsAfter;
  if (f.startsBefore) out.starts_before = f.startsBefore;
  if (f.womenOnly) out.women_only = true;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @footylocal/core test`
Expected: PASS (game tests green).

- [ ] **Step 5: Add gameCreateSchema tests to `packages/core/src/validation/validation.test.ts`**

Add these imports and tests (append the describe block; extend the import line):

```ts
// extend the existing import from "./index.js" to include gameCreateSchema
```

Append:

```ts
import { gameCreateSchema } from "./index.js";

describe("gameCreateSchema", () => {
  const base = {
    title: "Sunday 5s",
    venueId: "11111111-1111-1111-1111-111111111111",
    startsAt: "2999-06-01T10:00:00.000Z",
    endsAt: "2999-06-01T11:00:00.000Z",
    skillBand: "intermediate",
    format: "five_a_side",
    maxPlayers: 10,
    minPlayersToConfirm: 6,
    isWomenOnly: false,
    priceCents: 0,
  };
  it("accepts a valid future game", () => {
    expect(gameCreateSchema.safeParse(base).success).toBe(true);
  });
  it("rejects end before start", () => {
    const r = gameCreateSchema.safeParse({ ...base, endsAt: "2999-06-01T09:00:00.000Z" });
    expect(r.success).toBe(false);
  });
  it("rejects a start in the past", () => {
    const r = gameCreateSchema.safeParse({ ...base, startsAt: "2000-01-01T10:00:00.000Z", endsAt: "2000-01-01T11:00:00.000Z" });
    expect(r.success).toBe(false);
  });
  it("rejects minPlayersToConfirm above maxPlayers", () => {
    const r = gameCreateSchema.safeParse({ ...base, minPlayersToConfirm: 20 });
    expect(r.success).toBe(false);
  });
  it("rejects an invalid venue id", () => {
    const r = gameCreateSchema.safeParse({ ...base, venueId: "not-a-uuid" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @footylocal/core test`
Expected: FAIL — `gameCreateSchema` not exported.

- [ ] **Step 7: Implement `gameCreateSchema` in `packages/core/src/validation/index.ts`**

Add the import at the top (after the existing imports):

```ts
import { GAME_FORMATS } from "../game/index.js";
import { GAME_BANDS } from "../skill/index.js";
```

Append at the end of the file:

```ts
/** Validates a hosted-game submission. Dates are coerced from datetime-local /
 * ISO strings. Fuzzing/geography are applied server-side, not here. */
export const gameCreateSchema = z
  .object({
    title: z.string().min(2).max(80),
    description: z.string().max(500).optional(),
    venueId: z.string().uuid(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    skillBand: z.enum(GAME_BANDS),
    format: z.enum(GAME_FORMATS),
    maxPlayers: z.number().int().min(2).max(64),
    minPlayersToConfirm: z.number().int().min(2).max(64),
    isWomenOnly: z.boolean(),
    priceCents: z.number().int().min(0).default(0),
  })
  .refine((d) => d.endsAt > d.startsAt, {
    message: "End time must be after the start time.",
    path: ["endsAt"],
  })
  .refine((d) => d.startsAt.getTime() > Date.now(), {
    message: "Start time must be in the future.",
    path: ["startsAt"],
  })
  .refine((d) => d.minPlayersToConfirm <= d.maxPlayers, {
    message: "Min players to confirm can't exceed max players.",
    path: ["minPlayersToConfirm"],
  });
export type GameCreateInput = z.infer<typeof gameCreateSchema>;
```

- [ ] **Step 8: Update barrel `packages/core/src/index.ts`**

```ts
export * from "./geo/index.js";
export * from "./skill/index.js";
export * from "./game/index.js";
export * from "./validation/index.js";
```

- [ ] **Step 9: Run typecheck + full tests**

Run: `pnpm --filter @footylocal/core typecheck && pnpm --filter @footylocal/core test`
Expected: PASS. (Note: the validation test file now imports `gameCreateSchema` — ensure the import line includes it alongside the existing named imports rather than duplicating the `from "./index.js"` line, or keep a second import statement; both compile.)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(core): game formats, gameCreateSchema, discover filter serialization + tests"
```

---

### Task 2: db SQL — venue_latlng + create_game RPCs, rebuild games_near, apply live

**Files:**
- Create: `packages/db/migrations/sql/0005_venue_latlng.sql`, `packages/db/migrations/sql/0006_create_game.sql`, `packages/db/migrations/sql/0007_games_near_rebuild.sql`

**Interfaces:**
- Produces DB functions: `venue_latlng(uuid)`, `create_game(...)` (service_role-only), rebuilt `games_near(...)` returning extra columns (`max_players`, `joined_count`, `host_name`).

- [ ] **Step 1: Create `packages/db/migrations/sql/0005_venue_latlng.sql`**

```sql
-- Returns a verified venue's precise lat/lng for the server-side fuzz input.
-- service_role-only (used by packages/db createGame + seed).
create or replace function venue_latlng(v_id uuid)
returns table (lat double precision, lng double precision)
language sql
security definer
set search_path = public
as $$
  select st_y(location::geometry) as lat, st_x(location::geometry) as lng
  from venues
  where id = v_id and is_verified = true;
$$;

revoke execute on function venue_latlng(uuid) from public;
grant execute on function venue_latlng(uuid) to service_role;
```

- [ ] **Step 2: Create `packages/db/migrations/sql/0006_create_game.sql`**

```sql
-- Atomic game create: sets precise_location from the venue, stores the
-- server-computed fuzzed public_location, adds the host to the roster.
-- SECURITY DEFINER + granted ONLY to service_role so a client cannot call it
-- and inject an un-fuzzed public_location.
create or replace function create_game(
  p_game_id uuid,
  p_host_id uuid,
  p_venue_id uuid,
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_skill_band skill_band,
  p_format game_format,
  p_max_players integer,
  p_min_players_to_confirm integer,
  p_is_women_only boolean,
  p_price_cents integer,
  p_public_lat double precision,
  p_public_lng double precision
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location geography;
begin
  select location into v_location
  from venues
  where id = p_venue_id and is_verified = true;

  if v_location is null then
    raise exception 'venue % is not a verified venue', p_venue_id;
  end if;

  insert into games (
    id, host_id, venue_id, title, description, starts_at, ends_at,
    skill_band, format, max_players, price_cents, status,
    min_players_to_confirm, is_women_only, precise_location, public_location
  ) values (
    p_game_id, p_host_id, p_venue_id, p_title, p_description, p_starts_at, p_ends_at,
    p_skill_band, p_format, p_max_players, p_price_cents, 'open',
    p_min_players_to_confirm, p_is_women_only,
    v_location,
    st_makepoint(p_public_lng, p_public_lat)::geography
  );

  insert into game_players (game_id, player_id, role, status)
  values (p_game_id, p_host_id, 'host', 'joined');

  return p_game_id;
end;
$$;

revoke execute on function create_game(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, skill_band,
  game_format, integer, integer, boolean, integer, double precision, double precision
) from public;
grant execute on function create_game(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, skill_band,
  game_format, integer, integer, boolean, integer, double precision, double precision
) to service_role;
```

- [ ] **Step 3: Create `packages/db/migrations/sql/0007_games_near_rebuild.sql`**

```sql
-- Rebuild games_near: extended filters (format, price_max_cents, date window)
-- and extra output columns (max_players, joined_count, host_name) for cards.
-- DROP first because the return type changes (CREATE OR REPLACE can't do that).
drop function if exists games_near(double precision, double precision, integer, jsonb);

create function games_near(
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
  max_players integer,
  joined_count bigint,
  host_name text,
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
    g.max_players,
    (select count(*) from game_players gp2
       where gp2.game_id = g.id and gp2.status = 'joined') as joined_count,
    (select display_name from profiles p where p.id = g.host_id) as host_name,
    st_y(g.public_location::geometry) as public_lat,
    st_x(g.public_location::geometry) as public_lng,
    case when joined.player_id is not null
         then st_y(g.precise_location::geometry) end as precise_lat,
    case when joined.player_id is not null
         then st_x(g.precise_location::geometry) end as precise_lng,
    st_distance(g.public_location, st_makepoint(lng, lat)::geography) as distance_meters
  from games g
  left join game_players joined
    on joined.game_id = g.id
   and joined.player_id = auth.uid()
   and joined.status = 'joined'
  where g.status in ('open', 'confirmed')
    and st_dwithin(g.public_location, st_makepoint(lng, lat)::geography, radius_meters)
    and (filters->>'skill_band' is null
         or g.skill_band = (filters->>'skill_band')::skill_band)
    and (filters->>'women_only' is null
         or g.is_women_only = (filters->>'women_only')::boolean)
    and (filters->>'format' is null
         or g.format = (filters->>'format')::game_format)
    and (filters->>'price_max_cents' is null
         or g.price_cents <= (filters->>'price_max_cents')::integer)
    and (filters->>'starts_after' is null
         or g.starts_at >= (filters->>'starts_after')::timestamptz)
    and (filters->>'starts_before' is null
         or g.starts_at <= (filters->>'starts_before')::timestamptz)
  order by distance_meters asc;
$$;

grant execute on function games_near(double precision, double precision, integer, jsonb)
  to anon, authenticated;
```

- [ ] **Step 4: Apply to the live DB**

Run:
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db sql
```
Expected: prints `applying 0001..0007 ok` (0001–0004 are idempotent `create or replace`; 0005–0007 new). No errors.

- [ ] **Step 5: Verify the RPCs (live checks)**

Run (sourcing `.env`):
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db exec tsx -e "import postgres from 'postgres'; const s=postgres(process.env.DATABASE_URL,{max:1}); const cols=await s\`select column_name from information_schema.routines r join information_schema.parameters p on true where false\`.catch(()=>[]); const near=await s\`select * from games_near(33.749,-84.388,50000)\`; console.log('games_near cols:', Object.keys(near[0]??{max_players:0,joined_count:0,host_name:0})); const grants=await s\`select grantee from information_schema.role_routine_grants where routine_name='create_game'\`; console.log('create_game grantees:', grants.map(g=>g.grantee)); await s.end();"
```
Expected: `create_game grantees` includes `service_role` and NOT `anon`/`authenticated`. `games_near` runs (0 rows OK until games are seeded).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): venue_latlng + service_role-only create_game RPCs; rebuild games_near with filters + card fields"
```

---

### Task 3: db — createGame() server function + demo games seed

**Files:**
- Modify: `packages/db/package.json`
- Create: `packages/db/src/games.ts`, `packages/db/src/seed/games.ts`

**Interfaces:**
- Consumes: `fuzzToPublicPoint`, `GameCreateInput` from `@footylocal/core`; `createServiceClient` from `./client.js`; RPCs from Task 2.
- Produces: `createGame(hostId: string, input: GameCreateInput): Promise<string>` (returns gameId). Exported as `@footylocal/db/games`.

- [ ] **Step 1: Add core dep + games export to `packages/db/package.json`**

In `dependencies` add `"@footylocal/core": "workspace:*",` and in `exports` add:
```json
    "./games": "./src/games.ts",
```
(Keep the existing `"."` and `"./schema"` exports.)

- [ ] **Step 2: Create `packages/db/src/games.ts`**

```ts
/** Server-only game create: fuzzes on the server, writes via the
 * service_role-only create_game RPC. Never import into a client bundle. */
import { randomUUID } from "node:crypto";
import { fuzzToPublicPoint, type GameCreateInput } from "@footylocal/core";
import { createServiceClient } from "./client.js";

export async function createGame(
  hostId: string,
  input: GameCreateInput,
): Promise<string> {
  const supabase = createServiceClient();
  const gameId = randomUUID();

  const { data: rows, error: vErr } = await supabase.rpc("venue_latlng", {
    v_id: input.venueId,
  });
  if (vErr) throw vErr;
  const point = Array.isArray(rows) ? rows[0] : rows;
  if (!point) throw new Error("venue not found or not verified");

  const pub = fuzzToPublicPoint({ lat: point.lat, lng: point.lng }, gameId);

  const { data, error } = await supabase.rpc("create_game", {
    p_game_id: gameId,
    p_host_id: hostId,
    p_venue_id: input.venueId,
    p_title: input.title,
    p_description: input.description ?? null,
    p_starts_at: input.startsAt.toISOString(),
    p_ends_at: input.endsAt.toISOString(),
    p_skill_band: input.skillBand,
    p_format: input.format,
    p_max_players: input.maxPlayers,
    p_min_players_to_confirm: input.minPlayersToConfirm,
    p_is_women_only: input.isWomenOnly,
    p_price_cents: input.priceCents,
    p_public_lat: pub.lat,
    p_public_lng: pub.lng,
  });
  if (error) throw error;
  return (data as string) ?? gameId;
}
```

- [ ] **Step 3: Create `packages/db/src/seed/games.ts`**

```ts
/** Seeds ~3 open demo games so Discover isn't empty. Idempotent-ish: it clears
 * any prior demo-host games first. Run: pnpm --filter @footylocal/db seed:games */
import { createServiceClient } from "../client.js";
import { createGame } from "../games.js";

const DEMO_EMAIL = "demo-host@mailinator.com";

async function ensureHost(): Promise<string> {
  const supabase = createServiceClient();
  const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  let host = list?.users.find((u) => u.email === DEMO_EMAIL);
  if (!host) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: "FootyDemoHost2026!",
      email_confirm: true,
      user_metadata: { is_18_plus: true },
    });
    if (error) throw error;
    host = data.user!;
  }
  await supabase
    .from("profiles")
    .update({ phone_verified: true, verification_level: "phone", display_name: "Demo Host" })
    .eq("id", host.id);
  return host.id;
}

async function main(): Promise<void> {
  const supabase = createServiceClient();
  const hostId = await ensureHost();

  // Clear prior demo games so re-seeding doesn't pile up. game_players FK-
  // references games with no cascade, so delete the roster rows first.
  const { data: oldGames } = await supabase
    .from("games")
    .select("id")
    .eq("host_id", hostId);
  const oldIds = (oldGames ?? []).map((g) => g.id);
  if (oldIds.length) {
    await supabase.from("game_players").delete().in("game_id", oldIds);
    await supabase.from("games").delete().in("id", oldIds);
  }

  const { data: venues, error: vErr } = await supabase
    .from("venues")
    .select("id, name")
    .eq("is_verified", true)
    .limit(3);
  if (vErr) throw vErr;
  if (!venues || venues.length < 3) throw new Error("need >=3 verified venues (run venue seed first)");

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const specs = [
    { band: "open" as const, format: "five_a_side" as const, title: "Friday Night 5s", inDays: 2, max: 10, min: 6 },
    { band: "intermediate" as const, format: "seven_a_side" as const, title: "Sunday 7s", inDays: 4, max: 14, min: 8 },
    { band: "advanced" as const, format: "eleven_a_side" as const, title: "Weekend 11-a-side", inDays: 6, max: 22, min: 14 },
  ];

  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    const v = venues[i]!;
    const start = new Date(now + s.inDays * day + 18 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 90 * 60 * 1000);
    const id = await createGame(hostId, {
      title: s.title,
      description: `Demo game at ${v.name}.`,
      venueId: v.id,
      startsAt: start,
      endsAt: end,
      skillBand: s.band,
      format: s.format,
      maxPlayers: s.max,
      minPlayersToConfirm: s.min,
      isWomenOnly: false,
      priceCents: 0,
    });
    process.stdout.write(`seeded game ${s.title} (${id}) at ${v.name}\n`);
  }
  process.stdout.write("done\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Add the seed script to `packages/db/package.json`**

In `scripts` add:
```json
    "seed:games": "tsx src/seed/games.ts",
```

- [ ] **Step 5: Install, typecheck, run the seed live**

Run:
```bash
cd ~/projects/footylocal && pnpm install
pnpm --filter @footylocal/db typecheck
set -a; . ./.env; set +a
pnpm --filter @footylocal/db seed:games
```
Expected: typecheck clean; seed prints 3 `seeded game ...` lines + `done`.

- [ ] **Step 6: Verify games appear via games_near**

Run (sourcing `.env`):
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db exec tsx -e "import postgres from 'postgres'; const s=postgres(process.env.DATABASE_URL,{max:1}); const r=await s\`select id, title, host_name, max_players, joined_count from games_near(33.749,-84.388,80000)\`; console.log('rows:', r.length); r.forEach(g=>console.log(' -', g.title, '| host', g.host_name, '| spots', g.max_players - Number(g.joined_count))); await s.end();"
```
Expected: 3 rows, each with host_name "Demo Host" and 1 joined (the host), so spots = max-1.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(db): server-only createGame() + demo games seed"
```

---

### Task 4: web — Host flow (server action + form + venue picker)

**Files:**
- Create: `apps/web/app/(tabs)/host/actions.ts`, `apps/web/app/(tabs)/host/HostGameForm.tsx`
- Modify: `apps/web/app/(tabs)/host/page.tsx`

**Interfaces:**
- Consumes: `gameCreateSchema`, `GAME_BANDS`, `GAME_FORMATS` from `@footylocal/core`; `createGame` from `@footylocal/db/games`; server Supabase client.
- Produces: `hostGameAction(formData)` server action; the Host tab renders a working form (or a verify-phone prompt).

- [ ] **Step 1: Create `apps/web/app/(tabs)/host/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { gameCreateSchema, friendlyAuthError } from "@footylocal/core";
import { createGame } from "@footylocal/db/games";
import { createClient } from "@/lib/supabase/server";

export async function hostGameAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("phone_verified")
    .eq("id", user.id)
    .single();
  if (!profile?.phone_verified) redirect("/verify-phone");

  const parsed = gameCreateSchema.safeParse({
    title: String(formData.get("title")),
    description: formData.get("description")
      ? String(formData.get("description"))
      : undefined,
    venueId: String(formData.get("venueId")),
    startsAt: String(formData.get("startsAt")),
    endsAt: String(formData.get("endsAt")),
    skillBand: String(formData.get("skillBand")),
    format: String(formData.get("format")),
    maxPlayers: Number(formData.get("maxPlayers")),
    minPlayersToConfirm: Number(formData.get("minPlayersToConfirm")),
    isWomenOnly: formData.get("isWomenOnly") === "on",
    priceCents: 0,
  });
  if (!parsed.success) {
    redirect(`/host?error=${encodeURIComponent(parsed.error.issues[0]!.message)}`);
  }

  try {
    await createGame(user.id, parsed.data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "create failed";
    redirect(`/host?error=${encodeURIComponent(friendlyAuthError(msg))}`);
  }
  redirect("/discover");
}
```

- [ ] **Step 2: Create `apps/web/app/(tabs)/host/HostGameForm.tsx`**

```tsx
"use client";
import { GAME_BANDS, GAME_FORMATS } from "@footylocal/core";
import { Button } from "@footylocal/ui";
import { hostGameAction } from "./actions";

type Venue = { id: string; name: string };

const FIELD = "rounded-2xl bg-gray px-5 py-4 w-full";

export function HostGameForm({ venues }: { venues: Venue[] }) {
  return (
    <form className="flex flex-col gap-3">
      <input name="title" required placeholder="Game title" className={FIELD} />
      <textarea name="description" placeholder="Description (optional)" className={FIELD} />
      <select name="venueId" required className={FIELD} defaultValue="">
        <option value="" disabled>Choose a verified venue</option>
        {venues.map((v) => (
          <option key={v.id} value={v.id}>{v.name}</option>
        ))}
      </select>
      <label className="text-xs uppercase text-neutral-500">Starts</label>
      <input name="startsAt" type="datetime-local" required className={FIELD} />
      <label className="text-xs uppercase text-neutral-500">Ends</label>
      <input name="endsAt" type="datetime-local" required className={FIELD} />
      <select name="skillBand" required className={FIELD} defaultValue="open">
        {GAME_BANDS.map((b) => (
          <option key={b} value={b}>{b}</option>
        ))}
      </select>
      <select name="format" required className={FIELD} defaultValue="five_a_side">
        {GAME_FORMATS.map((f) => (
          <option key={f} value={f}>{f.replace(/_/g, " ")}</option>
        ))}
      </select>
      <input name="maxPlayers" type="number" min={2} max={64} required placeholder="Max players" className={FIELD} />
      <input name="minPlayersToConfirm" type="number" min={2} max={64} required placeholder="Min players to confirm" className={FIELD} />
      <label className="flex items-center gap-2 text-sm">
        <input name="isWomenOnly" type="checkbox" /> Women-only game
      </label>
      <Button variant="accent" formAction={hostGameAction}>Host game</Button>
    </form>
  );
}
```

- [ ] **Step 3: Replace `apps/web/app/(tabs)/host/page.tsx`**

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { HostGameForm } from "./HostGameForm";

export default async function Host({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let phoneVerified = false;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("phone_verified")
      .eq("id", user.id)
      .single();
    phoneVerified = data?.phone_verified ?? false;
  }

  const { data: venues } = await supabase
    .from("venues")
    .select("id, name")
    .eq("is_verified", true)
    .order("name");

  return (
    <section className="flex flex-col gap-6">
      <h1 className="display text-6xl">Host</h1>
      {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}
      {!phoneVerified ? (
        <div className="flex flex-col gap-3">
          <p className="text-neutral-600">You must verify your phone before hosting a game.</p>
          <Link href="/verify-phone" className="text-sm font-semibold uppercase text-ink underline">
            Verify your phone →
          </Link>
        </div>
      ) : (
        <HostGameForm venues={venues ?? []} />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS. (If webpack complains resolving `@footylocal/db/games`, confirm the `./games` export was added in Task 3 Step 1 and the extensionAlias in next.config.ts already covers `.js`.)

- [ ] **Step 5: Manual host smoke (live)**

With `pnpm dev` running and signed in as a phone-verified user (or the demo account after verifying phone), open `/host`, fill the form with a **future** start, submit → lands on `/discover`; the new game is now returned by `games_near` (verify with the Task 3 Step 6 query if desired). A non-phone-verified user sees the verify prompt.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): host-a-game flow (server action + form + venue picker)"
```

---

### Task 5: web — Discover list-first (DiscoverView + FilterBar + DiscoverList + GamePreview)

**Files:**
- Create: `apps/web/app/(tabs)/discover/types.ts`, `apps/web/app/(tabs)/discover/DiscoverView.tsx`, `apps/web/app/(tabs)/discover/FilterBar.tsx`, `apps/web/app/(tabs)/discover/DiscoverList.tsx`, `apps/web/app/(tabs)/discover/GamePreview.tsx`
- Modify: `apps/web/app/(tabs)/discover/page.tsx`

**Interfaces:**
- Consumes: `DiscoverFilters`, `toGamesNearFilters`, `roundPublicDistance`, `GAME_BANDS`, `GAME_FORMATS` from `@footylocal/core`; browser Supabase client.
- Produces: `type NearbyGame`; a working list Discover (map added in Task 6).

- [ ] **Step 1: Create `apps/web/app/(tabs)/discover/types.ts`**

```ts
import type { GameFormat } from "@footylocal/core";

/** One row from the games_near RPC. precise_* are null unless the caller is on
 * the game's roster. */
export type NearbyGame = {
  id: string;
  title: string;
  skill_band: string;
  format: GameFormat;
  price_cents: number;
  starts_at: string;
  is_women_only: boolean;
  max_players: number;
  joined_count: number;
  host_name: string | null;
  public_lat: number;
  public_lng: number;
  precise_lat: number | null;
  precise_lng: number | null;
  distance_meters: number;
};
```

- [ ] **Step 2: Create `apps/web/app/(tabs)/discover/DiscoverView.tsx`**

```tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import { type DiscoverFilters, toGamesNearFilters } from "@footylocal/core";
import { createClient } from "@/lib/supabase/client";
import { FilterBar } from "./FilterBar";
import { DiscoverList } from "./DiscoverList";
import { DiscoverMap } from "./DiscoverMap";
import { GamePreview } from "./GamePreview";
import type { NearbyGame } from "./types";

const ATLANTA = { lat: 33.749, lng: -84.388 };

export function DiscoverView() {
  const [center, setCenter] = useState(ATLANTA);
  const [filters, setFilters] = useState<DiscoverFilters>({ radiusMeters: 20000 });
  const [games, setGames] = useState<NearbyGame[]>([]);
  const [view, setView] = useState<"map" | "list">("list");
  const [selected, setSelected] = useState<NearbyGame | null>(null);

  // Ask for geolocation once; fall back to Atlanta.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 8000 },
    );
  }, []);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("games_near", {
      lat: center.lat,
      lng: center.lng,
      radius_meters: filters.radiusMeters,
      filters: toGamesNearFilters(filters),
    });
    if (!error && data) setGames(data as NearbyGame[]);
  }, [center, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="display text-6xl">Discover</h1>
        <div className="flex gap-2">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-[var(--radius-pill)] px-4 py-2 text-xs font-semibold uppercase ${
                view === v ? "bg-ink text-accent" : "bg-gray text-neutral-500"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <FilterBar filters={filters} onChange={setFilters} />

      {view === "list" ? (
        <DiscoverList games={games} onSelect={setSelected} />
      ) : (
        <DiscoverMap games={games} center={center} onSelect={setSelected} />
      )}

      {selected && <GamePreview game={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}
```

- [ ] **Step 3: Create `apps/web/app/(tabs)/discover/FilterBar.tsx`**

```tsx
"use client";
import { GAME_BANDS, GAME_FORMATS, type DiscoverFilters } from "@footylocal/core";

const SEL = "rounded-[var(--radius-pill)] bg-gray px-4 py-2 text-xs uppercase";

export function FilterBar({
  filters,
  onChange,
}: {
  filters: DiscoverFilters;
  onChange: (f: DiscoverFilters) => void;
}) {
  const set = (patch: Partial<DiscoverFilters>) => onChange({ ...filters, ...patch });
  return (
    <div className="flex flex-wrap gap-2">
      <select
        className={SEL}
        value={filters.skillBand ?? ""}
        onChange={(e) => set({ skillBand: (e.target.value || undefined) as DiscoverFilters["skillBand"] })}
      >
        <option value="">Any band</option>
        {GAME_BANDS.map((b) => (<option key={b} value={b}>{b}</option>))}
      </select>
      <select
        className={SEL}
        value={filters.format ?? ""}
        onChange={(e) => set({ format: (e.target.value || undefined) as DiscoverFilters["format"] })}
      >
        <option value="">Any format</option>
        {GAME_FORMATS.map((f) => (<option key={f} value={f}>{f.replace(/_/g, " ")}</option>))}
      </select>
      <select
        className={SEL}
        value={filters.radiusMeters}
        onChange={(e) => set({ radiusMeters: Number(e.target.value) })}
      >
        {[5000, 10000, 20000, 50000].map((m) => (
          <option key={m} value={m}>{m / 1000} km</option>
        ))}
      </select>
      <label className={`${SEL} flex items-center gap-2`}>
        <input
          type="checkbox"
          checked={!!filters.womenOnly}
          onChange={(e) => set({ womenOnly: e.target.checked || undefined })}
        />
        Women-only
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Create `apps/web/app/(tabs)/discover/DiscoverList.tsx`**

```tsx
"use client";
import { roundPublicDistance } from "@footylocal/core";
import { Badge, Card } from "@footylocal/ui";
import type { NearbyGame } from "./types";

export function DiscoverList({
  games,
  onSelect,
}: {
  games: NearbyGame[];
  onSelect: (g: NearbyGame) => void;
}) {
  if (games.length === 0) {
    return <p className="text-neutral-500">No games nearby yet. Try a wider distance, or host one.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {games.map((g) => {
        const spots = g.max_players - Number(g.joined_count);
        return (
          <Card key={g.id} className="border border-gray p-5">
            <button className="flex w-full flex-col gap-2 text-left" onClick={() => onSelect(g)}>
              <div className="flex items-center justify-between">
                <span className="display text-2xl">{g.title}</span>
                <Badge tone="accent">{g.skill_band}</Badge>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-neutral-600">
                <span>{g.format.replace(/_/g, " ")}</span>
                <span>{new Date(g.starts_at).toLocaleString()}</span>
                <span>{spots} spot{spots === 1 ? "" : "s"} left</span>
                <span>{roundPublicDistance(g.distance_meters)}</span>
                {g.is_women_only && <span>women-only</span>}
              </div>
            </button>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Create `apps/web/app/(tabs)/discover/GamePreview.tsx`**

```tsx
"use client";
import { roundPublicDistance } from "@footylocal/core";
import { Badge, Button } from "@footylocal/ui";
import type { NearbyGame } from "./types";

export function GamePreview({
  game,
  onClose,
}: {
  game: NearbyGame;
  onClose: () => void;
}) {
  const spots = game.max_players - Number(game.joined_count);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-t-[var(--radius-card)] bg-surface p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="display text-3xl">{game.title}</h2>
          <Badge tone="accent">{game.skill_band}</Badge>
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-neutral-600">
          <span>{game.format.replace(/_/g, " ")}</span>
          <span>{new Date(game.starts_at).toLocaleString()}</span>
          <span>{spots} spot{spots === 1 ? "" : "s"} left</span>
          <span>{roundPublicDistance(game.distance_meters)}</span>
          {game.host_name && <span>host: {game.host_name}</span>}
        </div>
        <p className="text-xs text-neutral-500">
          Approximate area shown. The exact pitch is revealed after you join.
        </p>
        <Button variant="accent" disabled>Join — coming next</Button>
        <button onClick={onClose} className="text-xs uppercase text-neutral-500">Close</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Replace `apps/web/app/(tabs)/discover/page.tsx`**

```tsx
import { DiscoverView } from "./DiscoverView";

export default function Discover() {
  return <DiscoverView />;
}
```

- [ ] **Step 7: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS. (`DiscoverMap` is imported here but created in Task 6 — create a minimal placeholder now so this task builds: see Step 8.)

- [ ] **Step 8: Create a temporary `DiscoverMap` placeholder so Task 5 builds**

Create `apps/web/app/(tabs)/discover/DiscoverMap.tsx`:

```tsx
"use client";
import type { NearbyGame } from "./types";

// Placeholder — replaced with the real Google Map in Task 6.
export function DiscoverMap({ games }: {
  games: NearbyGame[];
  center: { lat: number; lng: number };
  onSelect: (g: NearbyGame) => void;
}) {
  return (
    <div className="grid h-80 place-items-center rounded-[var(--radius-card)] bg-gray">
      <span className="display text-2xl text-neutral-300">Map — {games.length} games (Task 6)</span>
    </div>
  );
}
```

Re-run Step 7; expected PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(web): Discover list view + filters + game preview (map placeholder)"
```

---

### Task 6: web — Discover Google Map (clustered fuzzed pins) + fallback + final verification

**Files:**
- Modify: `apps/web/package.json`, `apps/web/app/(tabs)/discover/DiscoverMap.tsx`
- Create: `apps/web/lib/maps/loader.ts`

**Interfaces:**
- Consumes: `@googlemaps/js-api-loader`, `@googlemaps/markerclusterer`, `NearbyGame`.
- Produces: a real clustered Google Map plotting `public_lat/lng`; graceful fallback when the key is missing.

- [ ] **Step 1: Add map deps to `apps/web/package.json`**

In `dependencies` add:
```json
    "@googlemaps/js-api-loader": "^1.16.0",
    "@googlemaps/markerclusterer": "^2.5.0",
```
And in `devDependencies` add:
```json
    "@types/google.maps": "^3.58.0",
```
Then run `pnpm install`.

- [ ] **Step 2: Create `apps/web/lib/maps/loader.ts`**

```ts
import { Loader } from "@googlemaps/js-api-loader";

let loader: Loader | null = null;

/** Returns the google.maps namespace, or null if no key is configured. */
export async function loadGoogleMaps(): Promise<typeof google.maps | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  loader ??= new Loader({ apiKey, libraries: ["maps", "marker"] });
  await loader.load();
  return google.maps;
}
```

- [ ] **Step 3: Replace `apps/web/app/(tabs)/discover/DiscoverMap.tsx` with the real map**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { loadGoogleMaps } from "@/lib/maps/loader";
import type { NearbyGame } from "./types";

export function DiscoverMap({
  games,
  center,
  onSelect,
}: {
  games: NearbyGame[];
  center: { lat: number; lng: number };
  onSelect: (g: NearbyGame) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clusterRef = useRef<MarkerClusterer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "no-key">("loading");

  // Init the map once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const maps = await loadGoogleMaps();
      if (cancelled) return;
      if (!maps || !ref.current) {
        setStatus("no-key");
        return;
      }
      mapRef.current = new maps.Map(ref.current, {
        center,
        zoom: 11,
        disableDefaultUI: true,
        zoomControl: true,
      });
      clusterRef.current = new MarkerClusterer({ map: mapRef.current });
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-plot markers when games change.
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (status !== "ready" || !map || !cluster) return;
    cluster.clearMarkers();
    const markers = games.map((g) => {
      const marker = new google.maps.Marker({
        position: { lat: g.public_lat, lng: g.public_lng },
        title: g.title,
      });
      marker.addListener("click", () => onSelect(g));
      return marker;
    });
    cluster.addMarkers(markers);
    if (games.length > 0) {
      map.panTo({ lat: games[0]!.public_lat, lng: games[0]!.public_lng });
    }
  }, [games, status, onSelect]);

  if (status === "no-key") {
    return (
      <div className="grid h-80 place-items-center rounded-[var(--radius-card)] bg-gray text-center">
        <span className="px-6 text-sm text-neutral-500">
          Map unavailable — set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. The list view still works.
        </span>
      </div>
    );
  }
  return <div ref={ref} className="h-80 w-full rounded-[var(--radius-card)] bg-gray" />;
}
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS. (If `google` namespace types are missing, confirm `@types/google.maps` installed and picked up; it augments the global `google` namespace.)

- [ ] **Step 5: Manual map smoke (live, with key)**

With `pnpm dev` running (env sourced so the Maps key is present) and signed in, open `/discover` → toggle **map** → the Google Map renders with clustered pins at the fuzzed locations; clicking a pin opens the preview. Toggle **list** → cards render. Filters change results. If the key is removed, the map area shows the fallback and the list still works.

- [ ] **Step 6: Verify no precise leak (live)**

Run (sourcing `.env`) — confirm a non-roster query returns null precise columns:
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db exec tsx -e "import { createClient } from '@supabase/supabase-js'; const c=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY); const { data } = await c.rpc('games_near',{lat:33.749,lng:-84.388,radius_meters:80000,filters:{}}); const leaked=(data??[]).filter(g=>g.precise_lat!==null); console.log('rows',(data??[]).length,'| precise leaked to anon:', leaked.length, '(expect 0)');"
```
Expected: rows ≥ 3, precise leaked to anon: **0**.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): Google Map on Discover with clustered fuzzed pins + graceful fallback"
```

---

## Final Verification (Definition of Done)

- [ ] `pnpm typecheck` clean; `pnpm --filter @footylocal/core test` green (game + schema + filter tests); `pnpm --filter @footylocal/web build` succeeds.
- [ ] `create_game` grantees = `service_role` only (Task 2 Step 5); fuzzing runs server-side.
- [ ] Phone-verified user can host a game at a verified venue → stored with venue `precise_location` + fuzzed `public_location` + host on roster + `status='open'`; non-verified user is blocked.
- [ ] Discover shows clustered fuzzed pins (map) + distance/time cards (list) from the extended `games_near`; filters work; distances coarse; geolocation with Atlanta fallback; missing key degrades to a working list.
- [ ] Tapping a game shows the preview with a disabled "Join — coming next".
- [ ] ~3 demo games seeded and visible.
- [ ] Non-roster `games_near` call returns `precise_*` = null (Task 6 Step 6).

## Self-Review Notes (author)

- **Spec coverage:** hosting write path §3.1 → Task 2 (RPCs) + Task 3 (createGame) + Task 4 (web); extended games_near §3.2 → Task 2; discover-queries-games_near §3.3 → Task 5; maps §3.4 → Task 6; core schemas §5 → Task 1; UI §6 → Tasks 4–6; env §7 → Task 6; seed §8 → Task 3; DoD §10 → Final Verification. All covered.
- **Security:** `create_game` revoked from public, granted service_role only (Task 2); fuzzing only in `packages/core`/server (`createGame`); non-roster precise leak explicitly re-verified (Task 6 Step 6).
- **Type consistency:** `NearbyGame` matches the rebuilt `games_near` columns (Task 2 Step 3 ↔ Task 5 Step 1): id, title, skill_band, format, price_cents, starts_at, is_women_only, max_players, joined_count, host_name, public_lat/lng, precise_lat/lng, distance_meters. `createGame` param names (`p_*`) match the RPC signature. `toGamesNearFilters` keys match the SQL `filters->>'...'` reads (skill_band, format, price_max_cents, starts_after, starts_before, women_only).
- **Build ordering:** Task 5 imports `DiscoverMap`, so Step 8 adds a placeholder to keep Task 5 building; Task 6 replaces it with the real map.
- **Known follow-ups (1b/1c):** join + precise reveal + Directions + game detail page (1b); ratings + report/block (1c). The `precise_*` columns from `games_near` are unused in 1a (always null for non-roster) and become live in 1b.
