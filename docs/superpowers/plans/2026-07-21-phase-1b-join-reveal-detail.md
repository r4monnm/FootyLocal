# FootyLocal Phase 1b: Join + Reveal + Game Detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A game detail page at `/game/[id]` where a phone-verified user joins an open game (race-safe), which reveals the exact pitch (mini-map + Google Directions) and the roster names — all gated in the database so precise location and identities never reach a non-roster client. Joined non-host players can leave.

**Architecture:** Three `SECURITY DEFINER` RPCs granted to `authenticated`, each self-gating on `auth.uid()`: `game_detail` (returns precise + roster only to on-roster callers), `join_game` (row-locks the game for race-safe capacity, reactivates a cancelled row), `leave_game` (cancels the caller's row; host blocked). The detail page (server component) renders whatever `game_detail` returns; join/leave are server actions. The reveal mini-map reuses the Phase 1a Maps loader.

**Tech Stack:** TypeScript strict, Next.js App Router, Supabase (Postgres RPC), `@googlemaps/js-api-loader`, Zod, Vitest.

## Global Constraints

- Inherits all Phase 0/1a constraints (TS strict/no-any, RLS, verified-venues-only, no precise-coordinate or roster-identity leakage to non-roster clients, design tokens: pills/circles + volt `#CCFF00` accent + condensed uppercase display, no gradients).
- The precise-location + roster-name reveal is gated **in the DB** (`game_detail` on `auth.uid()`), never the client. Join capacity is enforced server-side and race-safe (row lock). A caller joins/leaves only as themselves.
- **Women-only is NOT enforced at join** (no gender field on `profiles`); it stays a display flag/filter. `join_game` does not check `is_women_only`.
- The live DB (Supabase `komtjbzslcfpctincdpa`) is provisioned. Live commands need `.env` sourced: `set -a; . ./.env; set +a`. `tsx -e` one-liners fail here (top-level-await + cjs) — write a temp `.ts` file and delete it before committing.
- Frequent commits: each task ends committed.

---

## File Structure

```
packages/core/
  src/game/index.ts             # + googleDirectionsUrl
  src/game/game.test.ts         # + googleDirectionsUrl test
  src/validation/index.ts       # + friendlyGameError
  src/validation/validation.test.ts  # + friendlyGameError test
packages/db/
  migrations/sql/0008_join_reveal.sql   # game_detail, join_game, leave_game
apps/web/
  app/game/[id]/page.tsx        # detail page (server)
  app/game/[id]/actions.ts      # joinAction, leaveAction
  app/game/[id]/GameLocationMap.tsx  # precise mini-map (client)
  app/(tabs)/discover/GamePreview.tsx # "View game" link (modify)
```

---

### Task 1: core — googleDirectionsUrl + friendlyGameError (TDD)

**Files:**
- Modify: `packages/core/src/game/index.ts`, `packages/core/src/game/game.test.ts`, `packages/core/src/validation/index.ts`, `packages/core/src/validation/validation.test.ts`

**Interfaces:**
- Produces: `googleDirectionsUrl(lat: number, lng: number): string`; `friendlyGameError(raw: string): string`.

- [ ] **Step 1: Add tests to `packages/core/src/game/game.test.ts`**

Add the import for `googleDirectionsUrl` (extend the existing `./index.js` import) and append:

```ts
import { googleDirectionsUrl } from "./index.js";

describe("googleDirectionsUrl", () => {
  it("builds a Google Maps directions deep link to the destination", () => {
    expect(googleDirectionsUrl(33.749, -84.388)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=33.749,-84.388",
    );
  });
});
```

- [ ] **Step 2: Add tests to `packages/core/src/validation/validation.test.ts`**

Add the import for `friendlyGameError` and append:

```ts
import { friendlyGameError } from "./index.js";

describe("friendlyGameError", () => {
  it("maps phone-verify errors", () => {
    expect(friendlyGameError("you must verify your phone to join")).toMatch(/verify your phone/i);
  });
  it("maps full games", () => {
    expect(friendlyGameError("this game is full")).toMatch(/full/i);
  });
  it("maps already-joined", () => {
    expect(friendlyGameError("you are already on this roster")).toMatch(/already/i);
  });
  it("maps host-cannot-leave", () => {
    expect(friendlyGameError("the host cannot leave their own game")).toMatch(/host/i);
  });
  it("falls back generically for unknown errors", () => {
    expect(friendlyGameError("pq: deadlock detected")).toBe("Couldn't complete that. Please try again.");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @footylocal/core test`
Expected: FAIL — `googleDirectionsUrl` / `friendlyGameError` not exported.

- [ ] **Step 4: Implement `googleDirectionsUrl` in `packages/core/src/game/index.ts`**

Append:

```ts
/** Google Maps directions deep link to a destination (turn-by-turn from the
 * viewer's current location). */
export function googleDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
```

- [ ] **Step 5: Implement `friendlyGameError` in `packages/core/src/validation/index.ts`**

Append:

```ts
/** Map a raw join/leave RPC error to safe, user-facing copy. */
export function friendlyGameError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("verify")) return "Verify your phone before joining a game.";
  if (m.includes("full")) return "This game is full — no spots left.";
  if (m.includes("already")) return "You're already on this game's roster.";
  if (m.includes("not open")) return "This game isn't open to join right now.";
  if (m.includes("host")) return "The host can't leave their own game.";
  if (m.includes("not on this roster")) return "You're not on this game's roster.";
  return "Couldn't complete that. Please try again.";
}
```

- [ ] **Step 6: Run typecheck + tests**

Run: `pnpm --filter @footylocal/core typecheck && pnpm --filter @footylocal/core test`
Expected: PASS (all core tests green).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): googleDirectionsUrl + friendlyGameError with tests"
```

---

### Task 2: db SQL — game_detail + join_game + leave_game RPCs, apply live, authenticated smoke

**Files:**
- Create: `packages/db/migrations/sql/0008_join_reveal.sql`

**Interfaces:**
- Produces DB functions `game_detail(uuid)` (anon+authenticated, self-gated), `join_game(uuid)` (authenticated), `leave_game(uuid)` (authenticated).

- [ ] **Step 1: Create `packages/db/migrations/sql/0008_join_reveal.sql`**

```sql
-- Phase 1b: game detail (precise + roster gated to on-roster callers),
-- race-safe join, leave. All SECURITY DEFINER, self-gated on auth.uid().

-- Single-game detail. precise_* and roster are null unless the caller is on
-- the roster (status='joined').
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
      where gp.game_id = p_game_id
        and gp.player_id = auth.uid()
        and gp.status = 'joined'
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
  where g.id = p_game_id;
$$;

grant execute on function game_detail(uuid) to anon, authenticated;

-- Race-safe join. Only inserts auth.uid()'s own roster row.
create or replace function join_game(p_game_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player uuid := auth.uid();
  v_status game_status;
  v_max integer;
  v_count integer;
  v_verified boolean;
begin
  if v_player is null then raise exception 'not authenticated'; end if;

  -- Lock the game row so concurrent joins can't oversell the last spot.
  select status, max_players into v_status, v_max
  from games where id = p_game_id for update;
  if not found then raise exception 'game not found'; end if;
  if v_status <> 'open' then raise exception 'this game is not open for joining'; end if;

  select phone_verified into v_verified from profiles where id = v_player;
  if not coalesce(v_verified, false) then
    raise exception 'you must verify your phone to join';
  end if;

  if exists (
    select 1 from game_players
    where game_id = p_game_id and player_id = v_player and status = 'joined'
  ) then
    raise exception 'you are already on this roster';
  end if;

  select count(*) into v_count
  from game_players where game_id = p_game_id and status = 'joined';
  if v_count >= v_max then raise exception 'this game is full'; end if;

  insert into game_players (game_id, player_id, role, status)
  values (p_game_id, v_player, 'player', 'joined')
  on conflict (game_id, player_id) do update set status = 'joined', role = 'player';

  return 'joined';
end;
$$;

grant execute on function join_game(uuid) to authenticated;

-- Leave (cancel the caller's roster row). Host cannot leave their own game.
create or replace function leave_game(p_game_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player uuid := auth.uid();
  v_role player_role;
begin
  if v_player is null then raise exception 'not authenticated'; end if;

  select role into v_role
  from game_players
  where game_id = p_game_id and player_id = v_player and status = 'joined';
  if not found then raise exception 'you are not on this roster'; end if;
  if v_role = 'host' then raise exception 'the host cannot leave their own game'; end if;

  update game_players set status = 'cancelled'
  where game_id = p_game_id and player_id = v_player;

  return 'left';
end;
$$;

grant execute on function leave_game(uuid) to authenticated;
```

- [ ] **Step 2: Apply to the live DB**

Run:
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db sql
```
Expected: applies through `0008 ok`, no errors.

- [ ] **Step 3: Authenticated join → reveal → leave smoke (the core 1b safety check)**

Create `packages/db/scripts/_smoke1b.ts` (temporary — delete before committing):

```ts
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

// A phone-verified temp user (not the host of any game).
const email = `join-smoke-${Date.now()}@mailinator.com`;
const password = "JoinSmoke2026!";
const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email, password, email_confirm: true, user_metadata: { is_18_plus: true },
});
if (cErr) throw cErr;
const uid = created.user!.id;
await admin.from("profiles").update({ phone_verified: true, verification_level: "phone", display_name: "Join Smoke" }).eq("id", uid);

// Pick a demo game.
const { data: games } = await admin.from("games").select("id, max_players").eq("status", "open").limit(1);
const gameId = games![0]!.id;

// Sign in as the temp user.
const user = createClient(url, anon);
const { error: sErr } = await user.auth.signInWithPassword({ email, password });
if (sErr) throw sErr;

// Before join: precise + roster must be null.
const before = (await user.rpc("game_detail", { p_game_id: gameId })).data![0];
console.log("before join: viewer_joined", before.viewer_joined, "| precise_lat", before.precise_lat, "| roster", before.roster);

// Join.
const joinRes = await user.rpc("join_game", { p_game_id: gameId });
console.log("join:", joinRes.error ? "ERROR " + joinRes.error.message : joinRes.data);

// After join: precise + roster revealed.
const after = (await user.rpc("game_detail", { p_game_id: gameId })).data![0];
console.log("after join: viewer_joined", after.viewer_joined, "| precise_lat", after.precise_lat != null, "| roster_len", after.roster?.length);

// Double-join rejected.
const dbl = await user.rpc("join_game", { p_game_id: gameId });
console.log("double-join rejected:", !!dbl.error, dbl.error?.message);

// Leave.
const leaveRes = await user.rpc("leave_game", { p_game_id: gameId });
console.log("leave:", leaveRes.error ? "ERROR " + leaveRes.error.message : leaveRes.data);

// After leave: precise null again.
const post = (await user.rpc("game_detail", { p_game_id: gameId })).data![0];
console.log("after leave: viewer_joined", post.viewer_joined, "| precise_lat", post.precise_lat);

// Cleanup.
await admin.auth.admin.deleteUser(uid);
console.log("cleanup: deleted temp user");
```

Run:
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db exec tsx scripts/_smoke1b.ts
rm -f packages/db/scripts/_smoke1b.ts
```
Expected:
- before join: `viewer_joined false | precise_lat null | roster null`
- join: `joined`
- after join: `viewer_joined true | precise_lat true | roster_len 2` (host + joiner)
- double-join rejected: `true you are already on this roster`
- leave: `left`
- after leave: `viewer_joined false | precise_lat null`
- cleanup: deleted temp user

**This proves the load-bearing 1b property: precise + roster are revealed only while on the roster.** If any line deviates (e.g. precise leaks before join), STOP and report BLOCKED. Delete the temp script whether it passes or fails.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(db): game_detail + race-safe join_game + leave_game RPCs (precise/roster gated to roster)"
```

---

### Task 3: web — game detail page + join/leave actions + Discover "View game" link

**Files:**
- Create: `apps/web/app/game/[id]/page.tsx`, `apps/web/app/game/[id]/actions.ts`, `apps/web/app/game/[id]/GameLocationMap.tsx` (placeholder)
- Modify: `apps/web/app/(tabs)/discover/GamePreview.tsx`

**Interfaces:**
- Consumes: `friendlyGameError`, `roundPublicDistance` from `@footylocal/core`; server Supabase client; `game_detail`/`join_game`/`leave_game` RPCs.
- Produces: `/game/[id]` route; `joinAction`/`leaveAction`.

- [ ] **Step 1: Create `apps/web/app/game/[id]/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { friendlyGameError } from "@footylocal/core";
import { createClient } from "@/lib/supabase/server";

export async function joinAction(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { error } = await supabase.rpc("join_game", { p_game_id: gameId });
  if (error) {
    if (error.message.toLowerCase().includes("verify")) redirect("/verify-phone");
    redirect(`/game/${gameId}?error=${encodeURIComponent(friendlyGameError(error.message))}`);
  }
  redirect(`/game/${gameId}`);
}

export async function leaveAction(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { error } = await supabase.rpc("leave_game", { p_game_id: gameId });
  if (error) {
    redirect(`/game/${gameId}?error=${encodeURIComponent(friendlyGameError(error.message))}`);
  }
  redirect(`/game/${gameId}`);
}
```

- [ ] **Step 2: Create the placeholder `apps/web/app/game/[id]/GameLocationMap.tsx`**

```tsx
"use client";

// Placeholder — replaced with the real precise mini-map in Task 4.
export function GameLocationMap({ lat, lng }: { lat: number; lng: number }) {
  return (
    <div className="grid h-56 place-items-center rounded-[var(--radius-card)] bg-gray">
      <span className="text-sm text-neutral-400">Pitch map — {lat.toFixed(4)}, {lng.toFixed(4)} (Task 4)</span>
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/web/app/game/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { googleDirectionsUrl } from "@footylocal/core";
import { Badge, Button } from "@footylocal/ui";
import { createClient } from "@/lib/supabase/server";
import { GameLocationMap } from "./GameLocationMap";
import { joinAction, leaveAction } from "./actions";

type RosterEntry = { player_id: string; name: string | null; role: string };
type Detail = {
  id: string;
  title: string;
  description: string | null;
  skill_band: string;
  format: string;
  starts_at: string;
  ends_at: string;
  is_women_only: boolean;
  max_players: number;
  status: string;
  host_id: string;
  host_name: string | null;
  venue_name: string;
  venue_address: string;
  surface_type: string;
  joined_count: number;
  viewer_joined: boolean;
  precise_lat: number | null;
  precise_lng: number | null;
  roster: RosterEntry[] | null;
};

export default async function GamePage({
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
  const game = (rows?.[0] ?? null) as Detail | null;
  if (!game) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-neutral-600">Game not found.</p>
        <Link href="/discover" className="text-sm uppercase underline">← Discover</Link>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  let phoneVerified = false;
  if (user) {
    const { data } = await supabase.from("profiles").select("phone_verified").eq("id", user.id).single();
    phoneVerified = data?.phone_verified ?? false;
  }

  const spots = game.max_players - Number(game.joined_count);
  const isHost = user?.id === game.host_id;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <Link href="/discover" className="text-xs uppercase text-neutral-500">← Discover</Link>

      <div className="flex items-center justify-between">
        <h1 className="display text-5xl">{game.title}</h1>
        <Badge tone="accent">{game.skill_band}</Badge>
      </div>

      {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}

      <div className="flex flex-col gap-1 text-sm text-neutral-600">
        <span className="text-ink">{game.venue_name}</span>
        <span>{game.venue_address}</span>
        <span>{game.surface_type} · {game.format.replace(/_/g, " ")}</span>
        <span>{new Date(game.starts_at).toLocaleString()} – {new Date(game.ends_at).toLocaleTimeString()}</span>
        <span>host: {game.host_name ?? "—"}</span>
        <span>{spots} of {game.max_players} spots left</span>
        {game.is_women_only && <span>women-only</span>}
      </div>

      {game.description && <p className="text-neutral-700">{game.description}</p>}

      {game.viewer_joined ? (
        <section className="flex flex-col gap-4">
          <h2 className="display text-2xl">You're in</h2>
          {game.precise_lat != null && game.precise_lng != null && (
            <>
              <GameLocationMap lat={game.precise_lat} lng={game.precise_lng} />
              <a
                className="text-sm font-semibold uppercase underline"
                href={googleDirectionsUrl(game.precise_lat, game.precise_lng)}
                target="_blank"
                rel="noreferrer"
              >
                Open in Google Maps →
              </a>
            </>
          )}
          <div>
            <h3 className="text-xs uppercase text-neutral-500">Roster</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {(game.roster ?? []).map((r) => (
                <li key={r.player_id} className="text-sm">
                  {r.name ?? "Player"} {r.role === "host" && <span className="text-neutral-400">· host</span>}
                </li>
              ))}
            </ul>
          </div>
          {!isHost && (
            <form>
              <input type="hidden" name="gameId" value={game.id} />
              <button formAction={leaveAction} className="rounded-[var(--radius-pill)] border border-ink px-6 py-3 text-sm font-semibold uppercase">
                Leave game
              </button>
            </form>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <p className="text-xs text-neutral-500">
            Approximate area only. The exact pitch and directions appear once you join.
          </p>
          {game.status !== "open" ? (
            <p className="text-sm text-neutral-600">This game isn't open for joining.</p>
          ) : spots <= 0 ? (
            <p className="text-sm text-neutral-600">This game is full.</p>
          ) : !phoneVerified ? (
            <Link href="/verify-phone" className="text-sm font-semibold uppercase text-ink underline">
              Verify your phone to join →
            </Link>
          ) : (
            <form>
              <input type="hidden" name="gameId" value={game.id} />
              <Button variant="accent" formAction={joinAction}>Join game</Button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Update `apps/web/app/(tabs)/discover/GamePreview.tsx` — replace the disabled Join with a "View game" link**

Change the import line to add `Link` and drop `Button` if now unused (keep `Badge`):

```tsx
import Link from "next/link";
```

Replace the disabled join button:

```tsx
        <Button variant="accent" disabled>Join — coming next</Button>
```

with:

```tsx
        <Link
          href={`/game/${game.id}`}
          className="inline-flex items-center justify-center rounded-[var(--radius-pill)] bg-ink px-8 py-4 text-sm font-semibold uppercase tracking-wide text-accent"
        >
          View game
        </Link>
```

If `Button` is no longer referenced in the file after this change, remove it from the `@footylocal/ui` import to keep the lint clean; keep `Badge` and `roundPublicDistance`.

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS; `/game/[id]` route compiles.

- [ ] **Step 6: Manual smoke (live, optional here — controller verifies)**

With `pnpm dev` running and signed in as a phone-verified user (not a host): Discover → tap a game → "View game" → `/game/[id]` shows host + spots, no precise/roster → Join → precise map placeholder + directions link + roster appear → Leave → hidden again.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): game detail page + join/leave actions + Discover View game link"
```

---

### Task 4: web — precise mini-map (GameLocationMap) + final verification

**Files:**
- Modify: `apps/web/app/game/[id]/GameLocationMap.tsx`

**Interfaces:**
- Consumes: `loadGoogleMaps` from `@/lib/maps/loader`.
- Produces: a real single-pin Google Map at the exact pitch, with a graceful fallback.

- [ ] **Step 1: Replace `apps/web/app/game/[id]/GameLocationMap.tsx` with the real map**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/maps/loader";

export function GameLocationMap({ lat, lng }: { lat: number; lng: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "no-key">("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const maps = await loadGoogleMaps();
      if (cancelled) return;
      if (!maps || !ref.current) {
        setStatus("no-key");
        return;
      }
      const map = new maps.Map(ref.current, {
        center: { lat, lng },
        zoom: 15,
        disableDefaultUI: true,
        zoomControl: true,
      });
      new maps.Marker({ position: { lat, lng }, map, title: "Exact pitch" });
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  if (status === "no-key") {
    return (
      <div className="grid h-56 place-items-center rounded-[var(--radius-card)] bg-gray text-center">
        <span className="px-6 text-sm text-neutral-500">
          Map unavailable — use the directions link below.
        </span>
      </div>
    );
  }
  return <div ref={ref} className="h-56 w-full rounded-[var(--radius-card)] bg-gray" />;
}
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS.

- [ ] **Step 3: Re-verify the reveal gate (live, non-roster precise stays null)**

Run (sourcing `.env`) — confirm an anon `game_detail` call returns null precise + null roster for a seeded game:

Create `packages/db/scripts/_gate.ts` (delete after):

```ts
import { createClient } from "@supabase/supabase-js";
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: g } = await admin.from("games").select("id").eq("status", "open").limit(1);
const { data } = await c.rpc("game_detail", { p_game_id: g![0]!.id });
const row = data![0];
console.log("anon game_detail: viewer_joined", row.viewer_joined, "| precise_lat", row.precise_lat, "| roster", row.roster);
```

Run:
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db exec tsx scripts/_gate.ts
rm -f packages/db/scripts/_gate.ts
```
Expected: `viewer_joined false | precise_lat null | roster null`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): precise pitch mini-map on the game detail reveal"
```

---

## Final Verification (Definition of Done)

- [ ] `pnpm typecheck` clean; `pnpm --filter @footylocal/core test` green (incl. googleDirectionsUrl + friendlyGameError); `pnpm --filter @footylocal/web build` succeeds.
- [ ] Task 2 smoke passed: before join precise/roster null; after join precise + roster (host + joiner) revealed; double-join rejected; leave → precise null again.
- [ ] `/game/[id]` renders; non-joined sees host + spots + fuzzed-area note, no precise/roster; joined sees mini-map + directions + roster; Leave hides it; host has no Leave button.
- [ ] Join blocks non-phone-verified (verify link) and full/closed games with friendly copy; capacity is race-safe (row lock).
- [ ] anon `game_detail` returns precise null + roster null (Task 4 Step 3).
- [ ] Discover preview links to `/game/[id]`.

## Self-Review Notes (author)

- **Spec coverage:** RPCs §3.1 → Task 2; detail page + actions §3.2 → Task 3; reveal UI §3.3 → Task 4; core helpers §5 → Task 1; UI §6 → Tasks 3–4; women-only-not-enforced §7 → join_game has no is_women_only check (Task 2); DoD §9 → Final Verification.
- **Security:** precise + roster gated on `auth.uid()` inside `game_detail` (verified anon-null in Task 2 smoke + Task 4 Step 3); join/leave mutate only the caller's row; capacity race-safe via `for update`. The authenticated smoke (Task 2 Step 3) is the load-bearing test.
- **Type consistency:** `Detail`/`RosterEntry` (Task 3) match the `game_detail` return columns (Task 2). `joinAction`/`leaveAction` read `gameId` from the hidden input present in both forms. `googleDirectionsUrl` used in Task 3, defined in Task 1.
- **Build ordering:** Task 3 uses a `GameLocationMap` placeholder; Task 4 replaces it with the real map (same import path/props).
- **Known follow-ups:** women-only gender field + enforcement; ratings/report/block (1c); waitlist/no-show/refunds (Phase 2); the deprecated `google.maps.Marker` (matches Phase 1a — modernize together).
