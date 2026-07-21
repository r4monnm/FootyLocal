# FootyLocal Phase 1c: Trust & Post-Game — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post-game ratings (anonymous, past games you were on) + computed karma/stats; report + block via RLS-scoped writes; bidirectional host-level block invisibility in `games_near`/`game_detail`; the My Games + Profile tabs and the rating flow.

**Architecture:** New `SECURITY DEFINER` RPCs granted to `authenticated`/`anon`: `submit_rating` (validates past-game + roster membership, upserts), `profile_stats` (computed karma/games/avg — no stored counter), `my_games` (the caller's roster games). `games_near` + `game_detail` are rebuilt to exclude any game whose host is in a block relationship with the caller (either direction). Report and block are plain RLS-scoped inserts/deletes via the user client (Phase 0 policies already allow own-row writes).

**Tech Stack:** TypeScript strict, Next.js App Router, Supabase (Postgres RPC + RLS), Zod, Vitest.

## Global Constraints

- Inherits all prior constraints (TS strict/no-any, RLS, no precise/roster leakage to non-roster clients, design tokens: pills/circles + volt `#CCFF00` accent + condensed uppercase display, no gradients).
- Ratings are **anonymous**: the ratee never learns who rated them; `profile_stats` returns only aggregates.
- A user rates/reports/blocks only as themselves (`auth.uid()`). Rating requires a **past** game (`ends_at < now()`) the rater was on the roster of, rating a co-participant (not self).
- Block invisibility is enforced in the DB (`games_near`/`game_detail` block exclusion on host), never the client.
- Live DB is provisioned; source `.env` for live commands: `set -a; . ./.env; set +a`. `tsx -e` fails here — use a temp `.ts` file, delete before committing.
- Frequent commits: each task ends committed.

---

## File Structure

```
packages/core/
  src/validation/index.ts       # + REPORT_REASONS, ratingInputSchema, reportSchema
  src/validation/validation.test.ts
packages/db/
  migrations/sql/0010_trust_postgame.sql  # submit_rating, profile_stats, my_games; rebuild games_near + game_detail (block)
apps/web/
  app/(tabs)/profile/page.tsx   # stats + blocked-users list (replace placeholder)
  app/(tabs)/profile/actions.ts # unblockAction
  app/(tabs)/my-games/page.tsx  # upcoming/past (replace placeholder)
  app/game/[id]/page.tsx        # + report/block actions on host + roster (modify)
  app/game/[id]/trust-actions.ts # reportAction (redirect helper), blockAction
  app/game/[id]/rate/page.tsx   # rating flow
  app/game/[id]/rate/actions.ts # rateAction
  app/report/page.tsx           # report reason form
  app/report/actions.ts         # submitReportAction
```

---

### Task 1: core — REPORT_REASONS + ratingInputSchema + reportSchema (TDD)

**Files:**
- Modify: `packages/core/src/validation/index.ts`, `packages/core/src/validation/validation.test.ts`

**Interfaces:**
- Produces: `REPORT_REASONS` (+ `ReportReason` type), `ratingInputSchema` (+ `RatingInput`), `reportSchema` (+ `ReportInput`).

- [ ] **Step 1: Add tests to `packages/core/src/validation/validation.test.ts`**

Add imports and append:

```ts
import { ratingInputSchema, reportSchema, REPORT_REASONS } from "./index.js";

describe("ratingInputSchema", () => {
  const base = { skill: 4, sportsmanship: 5, showedUp: true, isHostRating: false };
  it("accepts a valid rating", () => {
    expect(ratingInputSchema.safeParse(base).success).toBe(true);
  });
  it("rejects skill out of 1..5", () => {
    expect(ratingInputSchema.safeParse({ ...base, skill: 0 }).success).toBe(false);
    expect(ratingInputSchema.safeParse({ ...base, skill: 6 }).success).toBe(false);
  });
  it("rejects non-integer scores", () => {
    expect(ratingInputSchema.safeParse({ ...base, sportsmanship: 3.5 }).success).toBe(false);
  });
});

describe("reportSchema", () => {
  it("accepts a valid reason", () => {
    expect(reportSchema.safeParse({ reason: "harassment", details: "x" }).success).toBe(true);
  });
  it("allows omitting details", () => {
    expect(reportSchema.safeParse({ reason: "no_show" }).success).toBe(true);
  });
  it("rejects an unknown reason", () => {
    expect(reportSchema.safeParse({ reason: "banana" }).success).toBe(false);
  });
  it("exposes the DB report_reason values", () => {
    expect(REPORT_REASONS).toEqual([
      "harassment", "no_show", "unsafe_behavior", "fake_profile", "other",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @footylocal/core test`
Expected: FAIL — `ratingInputSchema`/`reportSchema`/`REPORT_REASONS` not exported.

- [ ] **Step 3: Implement in `packages/core/src/validation/index.ts`**

Append:

```ts
/** Report reasons — mirrors the DB report_reason enum. */
export const REPORT_REASONS = [
  "harassment",
  "no_show",
  "unsafe_behavior",
  "fake_profile",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Post-game rating input (serialized into skill_score jsonb + flags server-side). */
export const ratingInputSchema = z.object({
  skill: z.number().int().min(1).max(5),
  sportsmanship: z.number().int().min(1).max(5),
  showedUp: z.boolean(),
  isHostRating: z.boolean(),
});
export type RatingInput = z.infer<typeof ratingInputSchema>;

/** Report submission. */
export const reportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  details: z.string().max(500).optional(),
});
export type ReportInput = z.infer<typeof reportSchema>;
```

- [ ] **Step 4: Run typecheck + tests**

Run: `pnpm --filter @footylocal/core typecheck && pnpm --filter @footylocal/core test`
Expected: PASS (all core tests green).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): REPORT_REASONS + ratingInputSchema + reportSchema with tests"
```

---

### Task 2: db SQL — submit_rating + profile_stats + my_games; rebuild games_near/game_detail (block); apply live + smoke

**Files:**
- Create: `packages/db/migrations/sql/0010_trust_postgame.sql`

**Interfaces:**
- Produces `submit_rating(uuid,uuid,jsonb,boolean,boolean)`, `profile_stats(uuid)`, `my_games()`, and rebuilt `games_near`/`game_detail` (host block exclusion).

- [ ] **Step 1: Create `packages/db/migrations/sql/0010_trust_postgame.sql`**

```sql
-- Phase 1c: post-game ratings, computed profile stats, my games, and
-- bidirectional host-level block invisibility in games_near/game_detail.

-- Rate a co-participant of a PAST game you were on. Anonymous; upsert.
create or replace function submit_rating(
  p_game_id uuid,
  p_ratee_id uuid,
  p_skill_score jsonb,
  p_reliability_up boolean,
  p_is_host_rating boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rater uuid := auth.uid();
  v_ends timestamptz;
begin
  if v_rater is null then raise exception 'not authenticated'; end if;
  if v_rater = p_ratee_id then raise exception 'you cannot rate yourself'; end if;

  select ends_at into v_ends from games where id = p_game_id;
  if not found then raise exception 'game not found'; end if;
  if v_ends >= now() then raise exception 'you can only rate a past game'; end if;

  if not exists (
    select 1 from game_players
    where game_id = p_game_id and player_id = v_rater and status = 'joined'
  ) then raise exception 'you were not on this game roster'; end if;

  if not exists (
    select 1 from game_players
    where game_id = p_game_id and player_id = p_ratee_id and status = 'joined'
  ) then raise exception 'that player was not on this game roster'; end if;

  insert into ratings (game_id, rater_id, ratee_id, skill_score, reliability_up, is_host_rating)
  values (p_game_id, v_rater, p_ratee_id, p_skill_score, p_reliability_up, p_is_host_rating)
  on conflict (game_id, rater_id, ratee_id) do update
    set skill_score = excluded.skill_score,
        reliability_up = excluded.reliability_up,
        is_host_rating = excluded.is_host_rating;

  return 'rated';
end;
$$;

grant execute on function submit_rating(uuid, uuid, jsonb, boolean, boolean) to authenticated;

-- Computed public profile stats (no stored counter; preserves rater anonymity).
create or replace function profile_stats(p_user_id uuid)
returns table (
  games_played bigint,
  karma bigint,
  avg_skill numeric,
  ratings_count bigint
)
language sql
security definer
set search_path = public
as $$
  select
    (select count(distinct gp.game_id)
       from game_players gp join games g on g.id = gp.game_id
       where gp.player_id = p_user_id and gp.status = 'joined' and g.ends_at < now()),
    (select count(*) from ratings where ratee_id = p_user_id and reliability_up),
    (select avg((skill_score->>'skill')::numeric)
       from ratings where ratee_id = p_user_id and skill_score ? 'skill'),
    (select count(*) from ratings where ratee_id = p_user_id);
$$;

grant execute on function profile_stats(uuid) to anon, authenticated;

-- The caller's roster games (upcoming + past), for the My Games tab.
create or replace function my_games()
returns table (
  id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  venue_name text,
  role player_role,
  is_past boolean
)
language sql
security definer
set search_path = public
as $$
  select g.id, g.title, g.starts_at, g.ends_at, ve.name, gp.role, (g.ends_at < now())
  from game_players gp
  join games g on g.id = gp.game_id
  join venues ve on ve.id = g.venue_id
  where gp.player_id = auth.uid() and gp.status = 'joined'
  order by g.starts_at;
$$;

grant execute on function my_games() to authenticated;

-- Rebuild games_near: add bidirectional host block exclusion. Same return shape
-- as 0007, so CREATE OR REPLACE is valid.
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
    g.id, g.title, g.skill_band, g.format, g.price_cents, g.starts_at, g.is_women_only,
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
    and (filters->>'skill_band' is null or g.skill_band = (filters->>'skill_band')::skill_band)
    and (filters->>'women_only' is null or g.is_women_only = (filters->>'women_only')::boolean)
    and (filters->>'format' is null or g.format = (filters->>'format')::game_format)
    and (filters->>'price_max_cents' is null or g.price_cents <= (filters->>'price_max_cents')::integer)
    and (filters->>'starts_after' is null or g.starts_at >= (filters->>'starts_after')::timestamptz)
    and (filters->>'starts_before' is null or g.starts_at <= (filters->>'starts_before')::timestamptz)
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = g.host_id)
         or (b.blocker_id = g.host_id  and b.blocked_id = auth.uid())
    )
  order by distance_meters asc;
$$;

grant execute on function games_near(double precision, double precision, integer, jsonb)
  to anon, authenticated;

-- Rebuild game_detail: add the same host block exclusion (blocked host's game
-- returns no row). Same return shape as 0008, so CREATE OR REPLACE is valid.
create or replace function game_detail(p_game_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  skill_band skill_band,
  format game_format,
  price_cents integer,
  starts_at timestamptz,
  ends_at timestamptz,
  is_women_only boolean,
  max_players integer,
  min_players_to_confirm integer,
  status game_status,
  host_id uuid,
  host_name text,
  venue_name text,
  venue_address text,
  surface_type surface_type,
  public_lat double precision,
  public_lng double precision,
  joined_count bigint,
  viewer_joined boolean,
  precise_lat double precision,
  precise_lng double precision,
  roster jsonb
)
language sql
security definer
set search_path = public
as $$
  with v as (
    select exists (
      select 1 from game_players gp
      where gp.game_id = p_game_id and gp.player_id = auth.uid() and gp.status = 'joined'
    ) as joined
  )
  select
    g.id, g.title, g.description, g.skill_band, g.format,
    g.price_cents, g.starts_at, g.ends_at, g.is_women_only,
    g.max_players, g.min_players_to_confirm, g.status,
    g.host_id, hp.display_name as host_name,
    ve.name as venue_name, ve.address as venue_address, ve.surface_type,
    st_y(g.public_location::geometry) as public_lat,
    st_x(g.public_location::geometry) as public_lng,
    (select count(*) from game_players gp2
       where gp2.game_id = g.id and gp2.status = 'joined') as joined_count,
    v.joined as viewer_joined,
    case when v.joined then st_y(g.precise_location::geometry) end as precise_lat,
    case when v.joined then st_x(g.precise_location::geometry) end as precise_lng,
    case when v.joined then (
      select jsonb_agg(
        jsonb_build_object('player_id', p.id, 'name', p.display_name, 'role', gp3.role)
        order by gp3.role
      )
      from game_players gp3 join profiles p on p.id = gp3.player_id
      where gp3.game_id = g.id and gp3.status = 'joined'
    ) end as roster
  from games g
  join profiles hp on hp.id = g.host_id
  join venues ve on ve.id = g.venue_id
  cross join v
  where g.id = p_game_id
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = g.host_id)
         or (b.blocker_id = g.host_id  and b.blocked_id = auth.uid())
    );
$$;

grant execute on function game_detail(uuid) to anon, authenticated;
```

- [ ] **Step 2: Apply to the live DB**

Run:
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db sql
```
Expected: applies through `0010 ok`, no errors.

- [ ] **Step 3: Comprehensive live smoke (rating gate + block invisibility + profile_stats)**

Create `packages/db/scripts/_smoke1c.ts` (temporary — delete before committing). It builds a self-contained scenario using TWO temp games hosted by the demo host (one past, one future) and two temp users, then cleans everything up (so the 3 real demo games are never touched):

```ts
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, svc, { auth: { persistSession: false } });
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

async function mkUser(tag: string) {
  const email = `1c-${tag}-${Date.now()}@mailinator.com`;
  const { data } = await admin.auth.admin.createUser({ email, password: "Smoke1c2026!", email_confirm: true, user_metadata: { is_18_plus: true } });
  const id = data.user!.id;
  await admin.from("profiles").update({ phone_verified: true, verification_level: "phone", display_name: `1c ${tag}` }).eq("id", id);
  const c = createClient(url, anon);
  await c.auth.signInWithPassword({ email, password: "Smoke1c2026!" });
  return { id, email, client: c };
}

const hostId = (await admin.from("profiles").select("id").eq("display_name", "Demo Host").single()).data!.id;
const venueId = (await admin.from("venues").select("id").eq("is_verified", true).limit(1).single()).data!.id;

// Create a PAST and a FUTURE game via the create_game RPC (service role).
async function mkGame(pastMs: number) {
  const gid = randomUUID();
  const start = new Date(Date.now() + pastMs);
  await admin.rpc("create_game", {
    p_game_id: gid, p_host_id: hostId, p_venue_id: venueId,
    p_title: pastMs < 0 ? "Smoke Past" : "Smoke Future", p_description: null,
    p_starts_at: start.toISOString(), p_ends_at: new Date(start.getTime() + 3600000).toISOString(),
    p_skill_band: "open", p_format: "five_a_side", p_max_players: 10,
    p_min_players_to_confirm: 4, p_is_women_only: false, p_price_cents: 0,
    p_public_lat: 33.75, p_public_lng: -84.39,
  });
  return gid;
}
const pastGame = await mkGame(-2 * 3600000);   // ended 1h ago (start -2h, +1h duration)
const futureGame = await mkGame(2 * 24 * 3600000); // starts in 2 days

const A = await mkUser("A");
const B = await mkUser("B");
for (const g of [pastGame, futureGame]) { await A.client.rpc("join_game", { p_game_id: g }); await B.client.rpc("join_game", { p_game_id: g }); }

// Rating: A rates B in the past game.
console.log("rate B (past):", (await A.client.rpc("submit_rating", { p_game_id: pastGame, p_ratee_id: B.id, p_skill_score: { skill: 4, sportsmanship: 5 }, p_reliability_up: true, p_is_host_rating: false })).data ?? "err");
console.log("rate self rejected:", !!(await A.client.rpc("submit_rating", { p_game_id: pastGame, p_ratee_id: A.id, p_skill_score: {}, p_reliability_up: true, p_is_host_rating: false })).error);
console.log("rate future rejected:", !!(await A.client.rpc("submit_rating", { p_game_id: futureGame, p_ratee_id: B.id, p_skill_score: {}, p_reliability_up: true, p_is_host_rating: false })).error);

// profile_stats(B): karma 1, ratings_count 1, avg_skill 4.
const st = (await A.client.rpc("profile_stats", { p_user_id: B.id })).data![0];
console.log("B stats: karma", st.karma, "ratings", st.ratings_count, "avg_skill", st.avg_skill);

// Block: A blocks the host -> games_near excludes host's games; game_detail returns no row.
const nearBefore = (await A.client.rpc("games_near", { lat: 33.75, lng: -84.39, radius_meters: 80000, filters: {} })).data!;
await A.client.from("blocks").upsert({ blocker_id: A.id, blocked_id: hostId }, { onConflict: "blocker_id,blocked_id" });
const nearAfter = (await A.client.rpc("games_near", { lat: 33.75, lng: -84.39, radius_meters: 80000, filters: {} })).data!;
const detailAfter = (await A.client.rpc("game_detail", { p_game_id: futureGame })).data!;
console.log("games_near before block:", nearBefore.length, "-> after block:", nearAfter.length, "(host games hidden)");
console.log("game_detail after block: rows", detailAfter.length, "(expect 0)");
await A.client.from("blocks").delete().eq("blocker_id", A.id).eq("blocked_id", hostId);
const nearUnblocked = (await A.client.rpc("games_near", { lat: 33.75, lng: -84.39, radius_meters: 80000, filters: {} })).data!;
console.log("games_near after unblock:", nearUnblocked.length, "(restored)");

// Cleanup: remove temp games (game_players first), temp users, any leftover blocks.
await sql`delete from game_players where game_id = any(${sql.array([pastGame, futureGame])})`;
await sql`delete from ratings where game_id = ${pastGame}`;
await sql`delete from games where id = any(${sql.array([pastGame, futureGame])})`;
await admin.auth.admin.deleteUser(A.id);
await admin.auth.admin.deleteUser(B.id);
await sql.end();
console.log("cleanup done");
```

Run:
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db exec tsx scripts/_smoke1c.ts
rm -f packages/db/scripts/_smoke1c.ts
```
Expected:
- `rate B (past): rated`
- `rate self rejected: true`
- `rate future rejected: true`
- `B stats: karma 1 ratings 1 avg_skill 4` (avg_skill may print as `4` or `4.0000000000000000`)
- `games_near before block: N -> after block: M` with M < N (host's games gone)
- `game_detail after block: rows 0`
- `games_near after unblock: N` (restored)
- `cleanup done`

If rating/self/future/block behavior deviates, STOP and report BLOCKED. Delete the temp script regardless.

- [ ] **Step 4: Verify demo games untouched**

Run (sourcing `.env`):
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db exec tsx scripts/_check.ts
```
Create `packages/db/scripts/_check.ts` (delete after) that prints each demo game's joined count:
```ts
import postgres from "postgres";
const s = postgres(process.env.DATABASE_URL!, { max: 1 });
const r = await s`select g.title, count(gp.*) filter (where gp.status='joined') as joined from games g left join game_players gp on gp.game_id=g.id group by g.id, g.title order by g.title`;
for (const x of r) console.log(x.title, "joined:", x.joined);
await s.end();
```
Then `rm -f packages/db/scripts/_check.ts`. Expected: only the 3 demo games remain, each `joined: 1` (host only). No "Smoke Past/Future" rows.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): submit_rating + profile_stats + my_games; block-exclusion in games_near/game_detail"
```

---

### Task 3: web — Profile (stats + blocked list) + report/block on game detail + /report page

**Files:**
- Create: `apps/web/app/(tabs)/profile/actions.ts`, `apps/web/app/game/[id]/trust-actions.ts`, `apps/web/app/report/page.tsx`, `apps/web/app/report/actions.ts`
- Modify: `apps/web/app/(tabs)/profile/page.tsx`, `apps/web/app/game/[id]/page.tsx`

**Interfaces:**
- Consumes: `reportSchema`, `REPORT_REASONS` from `@footylocal/core`; server Supabase client; `profile_stats` RPC.
- Produces: Profile with stats + unblock; block/report actions on game detail; `/report` page.

- [ ] **Step 1: Create `apps/web/app/game/[id]/trust-actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Block a user (bidirectional-invisible via games_near/game_detail). */
export async function blockAction(formData: FormData): Promise<void> {
  const blockedId = String(formData.get("userId"));
  const gameId = String(formData.get("gameId"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  if (blockedId && blockedId !== user.id) {
    await supabase
      .from("blocks")
      .upsert({ blocker_id: user.id, blocked_id: blockedId }, { onConflict: "blocker_id,blocked_id" });
  }
  // The blocked host's game is now hidden; go back to Discover.
  redirect(gameId ? `/game/${gameId}` : "/discover");
}
```

- [ ] **Step 2: Create `apps/web/app/report/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { reportSchema } from "@footylocal/core";
import { createClient } from "@/lib/supabase/server";

export async function submitReportAction(formData: FormData): Promise<void> {
  const reportedId = formData.get("reportedId") ? String(formData.get("reportedId")) : null;
  const gameId = formData.get("gameId") ? String(formData.get("gameId")) : null;
  const parsed = reportSchema.safeParse({
    reason: String(formData.get("reason")),
    details: formData.get("details") ? String(formData.get("details")) : undefined,
  });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  if (!parsed.success) redirect(`/report?error=1`);

  await supabase.from("reports").insert({
    reporter_id: user.id,
    reported_id: reportedId,
    game_id: gameId,
    reason: parsed.data.reason,
    details: parsed.data.details ?? null,
  });
  redirect(`/report?sent=1`);
}
```

- [ ] **Step 3: Create `apps/web/app/report/page.tsx`**

```tsx
import Link from "next/link";
import { REPORT_REASONS } from "@footylocal/core";
import { Button } from "@footylocal/ui";
import { submitReportAction } from "./actions";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ reported?: string; game?: string; sent?: string; error?: string }>;
}) {
  const { reported, game, sent, error } = await searchParams;

  if (sent) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-10">
        <h1 className="display text-4xl">Report sent</h1>
        <p className="text-neutral-600">Thanks — our team will review it. FootyLocal is not an emergency service; if you're in danger, contact local authorities.</p>
        <Link href="/discover" className="text-sm uppercase underline">← Discover</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-10">
      <h1 className="display text-4xl">Report</h1>
      {error && <p className="text-[var(--color-error)] text-sm">Please choose a reason.</p>}
      <form className="flex flex-col gap-3">
        <input type="hidden" name="reportedId" value={reported ?? ""} />
        <input type="hidden" name="gameId" value={game ?? ""} />
        <select name="reason" required defaultValue="" className="rounded-2xl bg-gray px-5 py-4">
          <option value="" disabled>Choose a reason</option>
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
          ))}
        </select>
        <textarea name="details" placeholder="Details (optional)" className="rounded-2xl bg-gray px-5 py-4" />
        <Button formAction={submitReportAction}>Submit report</Button>
      </form>
      <Link href="/discover" className="text-xs uppercase text-neutral-500">Cancel</Link>
    </main>
  );
}
```

- [ ] **Step 4: Create `apps/web/app/(tabs)/profile/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function unblockAction(formData: FormData): Promise<void> {
  const blockedId = String(formData.get("userId"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  await supabase.from("blocks").delete().eq("blocker_id", user.id).eq("blocked_id", blockedId);
  redirect("/profile");
}
```

- [ ] **Step 5: Replace `apps/web/app/(tabs)/profile/page.tsx`**

```tsx
import { Badge } from "@footylocal/ui";
import { createClient } from "@/lib/supabase/server";
import { unblockAction } from "./actions";

export default async function Profile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName: string | null = null;
  let phoneVerified = false;
  let stats = { games_played: 0, karma: 0, avg_skill: null as number | null, ratings_count: 0 };
  let blocked: { blocked_id: string; name: string | null }[] = [];

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, phone_verified")
      .eq("id", user.id)
      .single();
    displayName = profile?.display_name ?? null;
    phoneVerified = profile?.phone_verified ?? false;

    const { data: s } = await supabase.rpc("profile_stats", { p_user_id: user.id });
    if (s?.[0]) stats = s[0];

    // Two-step (avoids depending on the exact PostgREST FK-embed name):
    const { data: b } = await supabase
      .from("blocks")
      .select("blocked_id")
      .eq("blocker_id", user.id);
    const ids = (b ?? []).map((r: { blocked_id: string }) => r.blocked_id);
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      const nameById = new Map(
        (profs ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name]),
      );
      blocked = ids.map((id) => ({ blocked_id: id, name: nameById.get(id) ?? null }));
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="display text-6xl">{displayName ?? "Profile"}</h1>
      <div className="flex flex-wrap gap-2">
        {phoneVerified ? <Badge tone="accent">phone verified</Badge> : <Badge>unverified</Badge>}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Karma", value: Number(stats.karma) },
          { label: "Games", value: Number(stats.games_played) },
          { label: "Avg skill", value: stats.avg_skill != null ? Number(stats.avg_skill).toFixed(1) : "—" },
        ].map((s) => (
          <div key={s.label} className="rounded-[var(--radius-card)] bg-gray p-4 text-center">
            <div className="display text-3xl">{s.value}</div>
            <div className="text-xs uppercase text-neutral-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-xs uppercase text-neutral-500">Blocked users</h2>
        {blocked.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">You haven't blocked anyone.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {blocked.map((b) => (
              <li key={b.blocked_id} className="flex items-center justify-between text-sm">
                <span>{b.name ?? "User"}</span>
                <form>
                  <input type="hidden" name="userId" value={b.blocked_id} />
                  <button formAction={unblockAction} className="text-xs uppercase underline">Unblock</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Add Report/Block to `apps/web/app/game/[id]/page.tsx`**

Add the import:
```tsx
import { blockAction } from "./trust-actions";
```

In the host metadata area, add Report + Block for the host (only when the viewer is not the host). After the `host: {game.host_name ?? "—"}` line's containing block, add:

```tsx
      {!isHost && (
        <div className="flex gap-3 text-xs">
          <a className="uppercase underline text-neutral-500"
             href={`/report?reported=${game.host_id}&game=${game.id}`}>Report host</a>
          <form>
            <input type="hidden" name="userId" value={game.host_id} />
            <input type="hidden" name="gameId" value={game.id} />
            <button formAction={blockAction} className="uppercase underline text-neutral-500">Block host</button>
          </form>
        </div>
      )}
```

And in the joined roster list, give each non-self, non-host player a Report/Block affordance — replace the roster `<li>` body with:

```tsx
                <li key={r.player_id} className="flex items-center justify-between text-sm">
                  <span>{r.name ?? "Player"} {r.role === "host" && <span className="text-neutral-400">· host</span>}</span>
                  {user && r.player_id !== user.id && r.role !== "host" && (
                    <span className="flex gap-2 text-xs text-neutral-400">
                      <a className="uppercase underline" href={`/report?reported=${r.player_id}&game=${game.id}`}>Report</a>
                      <form>
                        <input type="hidden" name="userId" value={r.player_id} />
                        <input type="hidden" name="gameId" value={game.id} />
                        <button formAction={blockAction} className="uppercase underline">Block</button>
                      </form>
                    </span>
                  )}
                </li>
```

- [ ] **Step 7: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS. (The blocked-users list uses a two-step fetch — blocks, then profiles by id — so it doesn't depend on a PostgREST FK-embed name.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(web): profile stats + blocked list, report/block on game detail, /report page"
```

---

### Task 4: web — My Games tab (upcoming/past) + rating page

**Files:**
- Create: `apps/web/app/game/[id]/rate/page.tsx`, `apps/web/app/game/[id]/rate/actions.ts`
- Modify: `apps/web/app/(tabs)/my-games/page.tsx`

**Interfaces:**
- Consumes: `ratingInputSchema` from `@footylocal/core`; server Supabase client; `my_games`, `game_detail`, `submit_rating` RPCs.
- Produces: My Games (upcoming/past); the rating flow.

- [ ] **Step 1: Replace `apps/web/app/(tabs)/my-games/page.tsx`**

```tsx
import Link from "next/link";
import { Badge, Card } from "@footylocal/ui";
import { createClient } from "@/lib/supabase/server";

type MyGame = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  venue_name: string;
  role: string;
  is_past: boolean;
};

export default async function MyGames() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_games");
  const games = (data ?? []) as MyGame[];
  const upcoming = games.filter((g) => !g.is_past);
  const past = games.filter((g) => g.is_past);

  const Row = ({ g }: { g: MyGame }) => (
    <Card className="border border-gray p-4">
      <div className="flex items-center justify-between">
        <Link href={`/game/${g.id}`} className="display text-xl">{g.title}</Link>
        {g.role === "host" && <Badge tone="accent">host</Badge>}
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-sm text-neutral-600">
        <span>{g.venue_name}</span>
        <span>{new Date(g.starts_at).toLocaleString()}</span>
        {g.is_past && (
          <Link href={`/game/${g.id}/rate`} className="uppercase underline">Rate players</Link>
        )}
      </div>
    </Card>
  );

  return (
    <section className="flex flex-col gap-6">
      <h1 className="display text-6xl">My Games</h1>

      <div>
        <h2 className="text-xs uppercase text-neutral-500">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No upcoming games. Find one on Discover.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-3">{upcoming.map((g) => <Row key={g.id} g={g} />)}</div>
        )}
      </div>

      <div>
        <h2 className="text-xs uppercase text-neutral-500">Past</h2>
        {past.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No past games yet.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-3">{past.map((g) => <Row key={g.id} g={g} />)}</div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create `apps/web/app/game/[id]/rate/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { ratingInputSchema } from "@footylocal/core";
import { createClient } from "@/lib/supabase/server";

export async function rateAction(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId"));
  const rateeId = String(formData.get("rateeId"));
  const parsed = ratingInputSchema.safeParse({
    skill: Number(formData.get("skill")),
    sportsmanship: Number(formData.get("sportsmanship")),
    showedUp: formData.get("showedUp") === "on",
    isHostRating: formData.get("isHostRating") === "true",
  });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  if (!parsed.success) redirect(`/game/${gameId}/rate?error=1`);

  await supabase.rpc("submit_rating", {
    p_game_id: gameId,
    p_ratee_id: rateeId,
    p_skill_score: { skill: parsed.data.skill, sportsmanship: parsed.data.sportsmanship },
    p_reliability_up: parsed.data.showedUp,
    p_is_host_rating: parsed.data.isHostRating,
  });
  redirect(`/game/${gameId}/rate`);
}
```

- [ ] **Step 3: Create `apps/web/app/game/[id]/rate/page.tsx`**

```tsx
import Link from "next/link";
import { Button } from "@footylocal/ui";
import { createClient } from "@/lib/supabase/server";
import { rateAction } from "./actions";

type RosterEntry = { player_id: string; name: string | null; role: string };

export default async function RatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: rows } = await supabase.rpc("game_detail", { p_game_id: id });
  const game = rows?.[0] as
    | { title: string; ends_at: string; viewer_joined: boolean; roster: RosterEntry[] | null }
    | undefined;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!game || !game.viewer_joined) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-neutral-600">You can only rate a game you played in.</p>
        <Link href="/my-games" className="text-sm uppercase underline">← My Games</Link>
      </main>
    );
  }
  const isPast = new Date(game.ends_at).getTime() < Date.now();
  if (!isPast) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-neutral-600">You can rate players once the game has ended.</p>
        <Link href={`/game/${id}`} className="text-sm uppercase underline">← Game</Link>
      </main>
    );
  }

  // The viewer's existing ratings for this game (RLS: rater sees own ratings).
  const { data: mine } = await supabase.from("ratings").select("ratee_id").eq("game_id", id).eq("rater_id", user!.id);
  const rated = new Set((mine ?? []).map((r: { ratee_id: string }) => r.ratee_id));

  const others = (game.roster ?? []).filter((r) => r.player_id !== user!.id);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <Link href="/my-games" className="text-xs uppercase text-neutral-500">← My Games</Link>
      <h1 className="display text-4xl">Rate — {game.title}</h1>
      {error && <p className="text-[var(--color-error)] text-sm">Please complete the rating.</p>}
      <p className="text-sm text-neutral-500">Ratings are anonymous.</p>

      <div className="flex flex-col gap-4">
        {others.map((p) => (
          <div key={p.player_id} className="rounded-[var(--radius-card)] border border-gray p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{p.name ?? "Player"} {p.role === "host" && <span className="text-neutral-400">· host</span>}</span>
              {rated.has(p.player_id) && <span className="text-xs uppercase text-[var(--color-success)]">rated</span>}
            </div>
            <form className="mt-3 flex flex-wrap items-center gap-3">
              <input type="hidden" name="gameId" value={id} />
              <input type="hidden" name="rateeId" value={p.player_id} />
              <input type="hidden" name="isHostRating" value={p.role === "host" ? "true" : "false"} />
              <label className="text-xs uppercase text-neutral-500">Skill
                <select name="skill" defaultValue="3" className="ml-2 rounded-lg bg-gray px-2 py-1">
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="text-xs uppercase text-neutral-500">Sportsmanship
                <select name="sportsmanship" defaultValue="3" className="ml-2 rounded-lg bg-gray px-2 py-1">
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1 text-xs uppercase text-neutral-500">
                <input type="checkbox" name="showedUp" defaultChecked /> showed up
              </label>
              <Button formAction={rateAction}>{rated.has(p.player_id) ? "Update" : "Rate"}</Button>
            </form>
          </div>
        ))}
        {others.length === 0 && <p className="text-neutral-500">No one else to rate.</p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS; `/my-games` and `/game/[id]/rate` compile.

- [ ] **Step 5: Manual smoke (controller verifies live)**

Sign in; My Games shows upcoming/past; a past game → "Rate players" → rate a co-player (skill/sportsmanship/showed-up) → returns with "rated"; Profile shows updated karma/avg after being rated; blocking a host from a game detail removes their games from Discover; unblock in Profile restores them.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): My Games (upcoming/past) + post-game rating flow"
```

---

## Final Verification (Definition of Done)

- [ ] `pnpm typecheck` clean; `pnpm --filter @footylocal/core test` green (rating + report schemas); `pnpm --filter @footylocal/web build` succeeds.
- [ ] Task 2 smoke passed: rate past OK; self/future rejected; profile_stats karma/ratings/avg correct; block hides host games in games_near + game_detail (both directions); unblock restores; demo games untouched.
- [ ] Profile shows phone badge + karma + games + avg skill + blocked-users list (unblock works).
- [ ] Report inserts a `reports` row; Block hides the host's games and can be undone from Profile.
- [ ] My Games lists upcoming + past; past games link to the rating flow; ratings are anonymous and one-per-(rater,ratee,game).

## Self-Review Notes (author)

- **Spec coverage:** submit_rating §3.1 → T2; profile_stats §3.2 → T2 + T3 (Profile); block exclusion §3.3 → T2 (RPC rebuild) + T3 (block action) + T4 (my_games); report/block RLS writes §3.4 → T3; core schemas §5 → T1; UI §6 → T3–T4; DoD §8 → Final Verification.
- **Anonymity:** profile_stats returns only aggregates; the rate page reads only the viewer's OWN ratings (RLS `ratings_rw_own`), never who rated the viewer. submit_rating never returns rater identity.
- **Security:** submit_rating gates on past-game + roster membership + self-exclusion (smoke-verified); block exclusion is bidirectional in both RPCs (smoke-verified); report/block scoped to `auth.uid()` by RLS.
- **Type consistency:** `my_games` columns ↔ `MyGame` type (T4); `profile_stats` columns ↔ Profile stats usage; rate page reuses `game_detail`'s roster (viewer_joined gate). `submit_rating` param names (`p_*`) ↔ rateAction rpc call.
- **Build ordering:** T2 rebuilds games_near/game_detail (return shapes unchanged → CREATE OR REPLACE valid, no consumer breakage). No placeholders.
- **Known follow-ups:** rich tier aggregation + karma-driven gating, photo/ID verification, Share My Game, check-in/SOS (Phase 3); message block-invisibility (Phase 4); host "mark completed" flow.
```

