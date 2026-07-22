# FootyLocal Phase 2b: Confirmation, Capture, Refunds & Waitlists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The money/roster lifecycle: confirm at `min_players_to_confirm` + capture holds; host cancel → void/refund (app fee reversed); leave with a 24h refund deadline; join-when-full → waitlist (paid hold placed) → promote on a freed spot (+ capture if confirmed). Seam-gated (builds/runs with no Stripe keys).

**Architecture:** A DB state machine (migration 0014 updates/creates 9 RPCs, all `FOR UPDATE`-locked and returning PaymentIntent lists). App-layer server-only settle helpers call the Stripe seam (capture/void/refund), guarded on `paymentsEnabled()`. Confirmation is triggered after joins (free via `joinAction`, paid via the webhook); cancel/leave are host/player actions.

**Tech Stack:** TypeScript strict, Next.js App Router, Supabase (Postgres RPC), Stripe seam, Zod, Vitest.

## Global Constraints

- Inherits all prior constraints (TS strict/no-any, RLS, no precise/roster leakage, seam-gated payments that build/run with no keys, design tokens).
- **Money correctness:** capture/void/refund driven by DB state, idempotent-safe (`mark_captured` only flips `paid=false→true`); refunds reverse the application fee. Stripe ops only in app-layer settle helpers, only when a PI exists + `paymentsEnabled()`.
- **Race safety:** confirm/cancel/leave/promote all `FOR UPDATE` the game row.
- Player leaves only as themselves; only the host cancels (`auth.uid()` checks). Games are joinable while `open` OR `confirmed`; cancelled/completed are not.
- 24h deadline rule lives in `packages/core` (pure + tested).
- Live DB provisioned; source `.env` for live commands. `tsx -e` fails — temp `.ts` files, deleted before commit.
- No Stripe keys yet: verification is the DB state-machine live smoke (free game, no Stripe) + typecheck/build; capture/refund/void money movement is a runbook.
- Frequent commits: each task ends committed.

---

## File Structure

```
packages/core/
  src/payments/index.ts         # + REFUND_DEADLINE_HOURS, isRefundableLeave
  src/payments/payments.test.ts
packages/db/
  migrations/sql/0014_confirm_refund_waitlist.sql
apps/web/
  lib/stripe/index.ts           # + capturePaymentIntent, refundPaymentIntent
  lib/payments/settle.ts        # settleConfirmation, settleCancellation, settleLeave
  app/api/stripe/webhook/route.ts   # settleConfirmation on 'joined' (modify)
  app/game/[id]/actions.ts      # joinAction confirmation + leaveAction settle (modify)
  app/game/[id]/cancel-actions.ts   # cancelGameAction
  app/game/[id]/page.tsx        # status/confirmation/waitlist/cancel UI (modify)
  app/(tabs)/my-games/page.tsx  # status tags (modify)
```

---

### Task 1: core — REFUND_DEADLINE_HOURS + isRefundableLeave (TDD)

**Files:**
- Modify: `packages/core/src/payments/index.ts`, `packages/core/src/payments/payments.test.ts`

**Interfaces:**
- Produces: `REFUND_DEADLINE_HOURS = 24`, `isRefundableLeave(startsAt: Date, now: Date): boolean`.

- [ ] **Step 1: Add tests to `packages/core/src/payments/payments.test.ts`**

Add the import and append:

```ts
import { isRefundableLeave, REFUND_DEADLINE_HOURS } from "./index.js";

describe("isRefundableLeave", () => {
  const start = new Date("2030-01-10T18:00:00.000Z");
  it("refunds when leaving more than 24h before start", () => {
    const now = new Date(start.getTime() - 25 * 3600_000);
    expect(isRefundableLeave(start, now)).toBe(true);
  });
  it("does not refund within 24h of start", () => {
    const now = new Date(start.getTime() - 23 * 3600_000);
    expect(isRefundableLeave(start, now)).toBe(false);
  });
  it("does not refund exactly at the 24h boundary", () => {
    const now = new Date(start.getTime() - REFUND_DEADLINE_HOURS * 3600_000);
    expect(isRefundableLeave(start, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @footylocal/core test`
Expected: FAIL — `isRefundableLeave` not exported.

- [ ] **Step 3: Implement in `packages/core/src/payments/index.ts`**

Append:

```ts
/** Hours before start after which leaving a captured paid game forfeits (no refund). */
export const REFUND_DEADLINE_HOURS = 24;

/** Whether a leaver gets a refund: only if leaving strictly more than the
 * deadline before the game starts. */
export function isRefundableLeave(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() - now.getTime() > REFUND_DEADLINE_HOURS * 3600_000;
}
```

- [ ] **Step 4: Typecheck + tests**

Run: `pnpm --filter @footylocal/core typecheck && pnpm --filter @footylocal/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): 24h refund-deadline helper (isRefundableLeave)"
```

---

### Task 2: db — migration 0014 (state-machine RPCs); apply live + DB smoke

**Files:**
- Create: `packages/db/migrations/sql/0014_confirm_refund_waitlist.sql`

**Interfaces:**
- Produces/updates: `join_game`, `join_paid`, `leave_game`, `game_detail`, `my_games` (updated) and `try_confirm_game`, `mark_captured`, `cancel_game`, `promote_waitlist` (new).

- [ ] **Step 1: Create `packages/db/migrations/sql/0014_confirm_refund_waitlist.sql`**

```sql
-- Phase 2b: confirmation/capture, cancel/refund, leave-with-deadline, waitlists.
-- RPCs FOR UPDATE the game row and return PaymentIntent lists for the app layer
-- to capture/void/refund via Stripe.

-- join_game: waitlist when full instead of rejecting. Joinable while open/confirmed.
create or replace function join_game(p_game_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_player uuid := auth.uid();
  v_status game_status;
  v_max integer;
  v_count integer;
  v_verified boolean;
  v_new player_status;
begin
  if v_player is null then raise exception 'not authenticated'; end if;
  select status, max_players into v_status, v_max from games where id = p_game_id for update;
  if not found then raise exception 'game not found'; end if;
  if v_status not in ('open', 'confirmed') then raise exception 'this game is not open for joining'; end if;
  select phone_verified into v_verified from profiles where id = v_player;
  if not coalesce(v_verified, false) then raise exception 'you must verify your phone to join'; end if;
  if exists (select 1 from game_players where game_id = p_game_id and player_id = v_player and status in ('joined','waitlisted')) then
    raise exception 'you are already on this roster';
  end if;
  select count(*) into v_count from game_players where game_id = p_game_id and status = 'joined';
  v_new := case when v_count < v_max then 'joined' else 'waitlisted' end;
  insert into game_players (game_id, player_id, role, status)
  values (p_game_id, v_player, 'player', v_new)
  on conflict (game_id, player_id) do update set status = v_new, role = 'player';
  return v_new::text;
end;
$$;
grant execute on function join_game(uuid) to authenticated;

-- join_paid: waitlist when full; keep the hold. Returns joined|waitlisted|closed|dup.
create or replace function join_paid(p_game_id uuid, p_player_id uuid, p_payment_intent_id text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_status game_status;
  v_max integer;
  v_count integer;
  v_new player_status;
begin
  select status, max_players into v_status, v_max from games where id = p_game_id for update;
  if not found then return 'closed'; end if;
  if v_status not in ('open', 'confirmed') then return 'closed'; end if;
  if exists (select 1 from game_players where game_id = p_game_id and player_id = p_player_id and status in ('joined','waitlisted')) then
    return 'dup';
  end if;
  select count(*) into v_count from game_players where game_id = p_game_id and status = 'joined';
  v_new := case when v_count < v_max then 'joined' else 'waitlisted' end;
  insert into game_players (game_id, player_id, role, status, paid, payment_intent_id)
  values (p_game_id, p_player_id, 'player', v_new, false, p_payment_intent_id)
  on conflict (game_id, player_id) do update
    set status = v_new, role = 'player', paid = false, payment_intent_id = excluded.payment_intent_id;
  return v_new::text;
end;
$$;
revoke execute on function join_paid(uuid, uuid, text) from public, anon, authenticated;
grant execute on function join_paid(uuid, uuid, text) to service_role;

-- try_confirm_game: confirm at min; return uncaptured joined holds (whether it just
-- confirmed or was already confirmed — so joins after confirmation also capture).
create or replace function try_confirm_game(p_game_id uuid)
returns table (payment_intent_id text)
language plpgsql security definer set search_path = public as $$
declare
  v_status game_status;
  v_min integer;
  v_count integer;
begin
  select status, min_players_to_confirm into v_status, v_min from games where id = p_game_id for update;
  if not found then return; end if;
  select count(*) into v_count from game_players where game_id = p_game_id and status = 'joined';
  if v_status = 'open' and v_count >= v_min then
    update games set status = 'confirmed' where id = p_game_id;
    v_status := 'confirmed';
  end if;
  if v_status = 'confirmed' then
    return query
      select gp.payment_intent_id from game_players gp
      where gp.game_id = p_game_id and gp.status = 'joined'
        and gp.paid = false and gp.payment_intent_id is not null;
  end if;
  return;
end;
$$;
revoke execute on function try_confirm_game(uuid) from public, anon, authenticated;
grant execute on function try_confirm_game(uuid) to service_role;

-- mark_captured: idempotent flip to paid=true.
create or replace function mark_captured(p_payment_intent_id text)
returns void language sql security definer set search_path = public as $$
  update game_players set paid = true where payment_intent_id = p_payment_intent_id and paid = false;
$$;
revoke execute on function mark_captured(text) from public, anon, authenticated;
grant execute on function mark_captured(text) to service_role;

-- cancel_game: host-only; cancel game + rows; return PIs to void/refund.
create or replace function cancel_game(p_game_id uuid)
returns table (payment_intent_id text, paid boolean)
language plpgsql security definer set search_path = public as $$
declare v_host uuid;
begin
  select host_id into v_host from games where id = p_game_id for update;
  if not found then raise exception 'game not found'; end if;
  if v_host <> auth.uid() then raise exception 'only the host can cancel this game'; end if;
  update games set status = 'cancelled' where id = p_game_id;
  return query
    with c as (
      update game_players set status = 'cancelled'
      where game_id = p_game_id and status in ('joined','waitlisted')
      returning game_players.payment_intent_id as pi, game_players.paid as pd
    )
    select c.pi, c.pd from c where c.pi is not null;
end;
$$;
grant execute on function cancel_game(uuid) to authenticated;

-- leave_game: cancel the caller's row; return their PI info + was_joined.
create or replace function leave_game(p_game_id uuid)
returns table (payment_intent_id text, paid boolean, starts_at timestamptz, was_joined boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_player uuid := auth.uid();
  v_role player_role;
  v_status player_status;
  v_pi text;
  v_paid boolean;
  v_starts timestamptz;
begin
  if v_player is null then raise exception 'not authenticated'; end if;
  select gp.role, gp.status, gp.payment_intent_id, gp.paid, g.starts_at
    into v_role, v_status, v_pi, v_paid, v_starts
  from game_players gp join games g on g.id = gp.game_id
  where gp.game_id = p_game_id and gp.player_id = v_player and gp.status in ('joined','waitlisted');
  if not found then raise exception 'you are not on this roster'; end if;
  if v_role = 'host' then raise exception 'the host cannot leave their own game'; end if;
  update game_players set status = 'cancelled' where game_id = p_game_id and player_id = v_player;
  return query select v_pi, v_paid, v_starts, (v_status = 'joined');
end;
$$;
grant execute on function leave_game(uuid) to authenticated;

-- promote_waitlist: on a freed spot, promote the earliest waitlisted to joined.
create or replace function promote_waitlist(p_game_id uuid)
returns table (payment_intent_id text, game_confirmed boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_status game_status;
  v_max integer;
  v_count integer;
  v_promote uuid;
  v_pi text;
begin
  select status, max_players into v_status, v_max from games where id = p_game_id for update;
  if not found then return; end if;
  select count(*) into v_count from game_players where game_id = p_game_id and status = 'joined';
  if v_count >= v_max then return; end if;
  select player_id, game_players.payment_intent_id into v_promote, v_pi
  from game_players where game_id = p_game_id and status = 'waitlisted'
  order by joined_at asc limit 1;
  if v_promote is null then return; end if;
  update game_players set status = 'joined' where game_id = p_game_id and player_id = v_promote;
  return query select v_pi, (v_status = 'confirmed');
end;
$$;
revoke execute on function promote_waitlist(uuid) from public, anon, authenticated;
grant execute on function promote_waitlist(uuid) to service_role;

-- game_detail: add viewer_status (joined|waitlisted|null). precise/roster still
-- gated on viewer_joined (= joined). Keep the block exclusion + all columns.
create or replace function game_detail(p_game_id uuid)
returns table (
  id uuid, title text, description text, skill_band skill_band, format game_format,
  price_cents integer, starts_at timestamptz, ends_at timestamptz, is_women_only boolean,
  max_players integer, min_players_to_confirm integer, status game_status,
  host_id uuid, host_name text, venue_name text, venue_address text, surface_type surface_type,
  public_lat double precision, public_lng double precision, joined_count bigint,
  viewer_joined boolean, viewer_status text,
  precise_lat double precision, precise_lng double precision, roster jsonb
)
language sql security definer set search_path = public as $$
  with v as (
    select (select status from game_players gp
            where gp.game_id = p_game_id and gp.player_id = auth.uid()
              and gp.status in ('joined','waitlisted') limit 1)::text as vstatus
  )
  select
    g.id, g.title, g.description, g.skill_band, g.format,
    g.price_cents, g.starts_at, g.ends_at, g.is_women_only,
    g.max_players, g.min_players_to_confirm, g.status,
    g.host_id, hp.display_name, ve.name, ve.address, ve.surface_type,
    st_y(g.public_location::geometry), st_x(g.public_location::geometry),
    (select count(*) from game_players gp2 where gp2.game_id = g.id and gp2.status = 'joined'),
    coalesce(v.vstatus = 'joined', false), v.vstatus,
    case when v.vstatus = 'joined' then st_y(g.precise_location::geometry) end,
    case when v.vstatus = 'joined' then st_x(g.precise_location::geometry) end,
    case when v.vstatus = 'joined' then (
      select jsonb_agg(jsonb_build_object('player_id', p.id, 'name', p.display_name, 'role', gp3.role) order by gp3.role)
      from game_players gp3 join profiles p on p.id = gp3.player_id
      where gp3.game_id = g.id and gp3.status = 'joined'
    ) end
  from games g
  join profiles hp on hp.id = g.host_id
  join venues ve on ve.id = g.venue_id
  cross join v
  where g.id = p_game_id
    and not exists (select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = g.host_id)
         or (b.blocker_id = g.host_id and b.blocked_id = auth.uid()));
$$;
grant execute on function game_detail(uuid) to anon, authenticated;

-- my_games: include waitlisted games; return game status + player status.
create or replace function my_games()
returns table (
  id uuid, title text, starts_at timestamptz, ends_at timestamptz,
  venue_name text, role player_role, is_past boolean,
  status game_status, player_status player_status
)
language sql security definer set search_path = public as $$
  select g.id, g.title, g.starts_at, g.ends_at, ve.name, gp.role, (g.ends_at < now()),
    g.status, gp.status
  from game_players gp
  join games g on g.id = gp.game_id
  join venues ve on ve.id = g.venue_id
  where gp.player_id = auth.uid() and gp.status in ('joined','waitlisted')
  order by g.starts_at;
$$;
grant execute on function my_games() to authenticated;
```

- [ ] **Step 2: Apply to the live DB**

Run:
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db sql
```
Expected: applies through `0014 ok`, no errors.

- [ ] **Step 3: DB state-machine smoke (free game, no Stripe)**

Create `packages/db/scripts/_smoke2b.ts` (delete after). Self-contained: a temp host + temp users, a small free game (min=2, max=2), exercising confirm/waitlist/promote/cancel, then cleanup:

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
  const email = `2b-${tag}-${Date.now()}@mailinator.com`;
  const { data } = await admin.auth.admin.createUser({ email, password: "Smoke2b2026!", email_confirm: true, user_metadata: { is_18_plus: true } });
  const id = data.user!.id;
  await admin.from("profiles").update({ phone_verified: true, verification_level: "phone", display_name: `2b ${tag}` }).eq("id", id);
  const client = createClient(url, anon);
  await client.auth.signInWithPassword({ email, password: "Smoke2b2026!" });
  return { id, client };
}

const venueId = (await admin.from("venues").select("id").eq("is_verified", true).limit(1).single()).data!.id;
const H = await mkUser("host");
const B = await mkUser("b");
const C = await mkUser("c");

// Free game hosted by H (auto-joins H), min 2 max 2.
const gid = randomUUID();
const start = new Date(Date.now() + 5 * 86400_000);
await admin.rpc("create_game", {
  p_game_id: gid, p_host_id: H.id, p_venue_id: venueId, p_title: "2b Smoke", p_description: null,
  p_starts_at: start.toISOString(), p_ends_at: new Date(start.getTime() + 3600_000).toISOString(),
  p_skill_band: "open", p_format: "five_a_side", p_max_players: 2, p_min_players_to_confirm: 2,
  p_is_women_only: false, p_price_cents: 0, p_public_lat: 33.75, p_public_lng: -84.39,
});

console.log("B join:", (await B.client.rpc("join_game", { p_game_id: gid })).data, "(expect joined; now 2 joined = H+B)");
const conf = (await admin.rpc("try_confirm_game", { p_game_id: gid })).data;
console.log("try_confirm returned PIs:", (conf ?? []).length, "(expect 0, free)");
console.log("game status:", (await sql`select status from games where id=${gid}`)[0].status, "(expect confirmed)");
console.log("C join (full):", (await C.client.rpc("join_game", { p_game_id: gid })).data, "(expect waitlisted)");
const leave = (await B.client.rpc("leave_game", { p_game_id: gid })).data![0];
console.log("B leave was_joined:", leave.was_joined, "(expect true)");
const promo = (await admin.rpc("promote_waitlist", { p_game_id: gid })).data![0];
console.log("promote game_confirmed:", promo?.game_confirmed, "(expect true)");
console.log("C status after promote:", (await sql`select status from game_players where game_id=${gid} and player_id=${C.id}`)[0].status, "(expect joined)");
const cancelRows = (await H.client.rpc("cancel_game", { p_game_id: gid })).data;
console.log("cancel_game PI rows:", (cancelRows ?? []).length, "(expect 0, free)");
console.log("game status after cancel:", (await sql`select status from games where id=${gid}`)[0].status, "(expect cancelled)");

// Cleanup.
await sql`delete from game_players where game_id=${gid}`;
await sql`delete from games where id=${gid}`;
for (const u of [H, B, C]) await admin.auth.admin.deleteUser(u.id);
console.log("games remaining:", (await sql`select count(*)::int c from games`)[0].c, "(expect 3 demo)");
await sql.end();
```

Run:
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db exec tsx scripts/_smoke2b.ts
rm -f packages/db/scripts/_smoke2b.ts
```
Expected: B join `joined`; try_confirm 0 PIs; status `confirmed`; C `waitlisted`; B leave was_joined `true`; promote game_confirmed `true`; C `joined`; cancel 0 PIs; status `cancelled`; games remaining `3`.
If any transition deviates, STOP and report BLOCKED. Delete the temp script regardless.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter @footylocal/db typecheck`
Expected: PASS.
```bash
git add -A
git commit -m "feat(db): 2b state machine — confirm/capture/cancel/leave/waitlist RPCs (0014)"
```

---

### Task 3: web — seam capture/refund + settle helpers + webhook confirmation

**Files:**
- Modify: `apps/web/lib/stripe/index.ts`, `apps/web/app/api/stripe/webhook/route.ts`
- Create: `apps/web/lib/payments/settle.ts`

**Interfaces:**
- Produces: `capturePaymentIntent`, `refundPaymentIntent` (seam); `settleConfirmation`, `settleCancellation`, `settleLeave` (server-only helpers). Webhook calls `settleConfirmation` on a `'joined'` paid join.

- [ ] **Step 1: Add capture + refund to `apps/web/lib/stripe/index.ts`**

Append (after `cancelPaymentIntent`):

```ts
export async function capturePaymentIntent(id: string): Promise<void> {
  await getStripe().paymentIntents.capture(id);
}

export async function refundPaymentIntent(id: string): Promise<void> {
  await getStripe().refunds.create({ payment_intent: id, refund_application_fee: true });
}
```

- [ ] **Step 2: Create `apps/web/lib/payments/settle.ts`**

```ts
import "server-only";
import { isRefundableLeave } from "@footylocal/core";
import { createServiceClient } from "@footylocal/db";
import {
  paymentsEnabled,
  capturePaymentIntent,
  refundPaymentIntent,
  cancelPaymentIntent,
} from "@/lib/stripe";

/** Confirm the game (if min met) and capture any uncaptured joined holds. */
export async function settleConfirmation(gameId: string): Promise<void> {
  const svc = createServiceClient();
  const { data } = await svc.rpc("try_confirm_game", { p_game_id: gameId });
  const pis = (data ?? []) as { payment_intent_id: string }[];
  if (!pis.length || !paymentsEnabled()) return;
  for (const { payment_intent_id } of pis) {
    await capturePaymentIntent(payment_intent_id);
    await svc.rpc("mark_captured", { p_payment_intent_id: payment_intent_id });
  }
}

/** Void holds + refund captures for a cancelled game. */
export async function settleCancellation(
  rows: { payment_intent_id: string | null; paid: boolean }[],
): Promise<void> {
  if (!paymentsEnabled()) return;
  for (const r of rows) {
    if (!r.payment_intent_id) continue;
    if (r.paid) await refundPaymentIntent(r.payment_intent_id);
    else await cancelPaymentIntent(r.payment_intent_id);
  }
}

/** Void/refund a leaver per the 24h rule, then promote a waitlisted player. */
export async function settleLeave(
  row: { payment_intent_id: string | null; paid: boolean; starts_at: string; was_joined: boolean },
  gameId: string,
): Promise<void> {
  const svc = createServiceClient();
  if (paymentsEnabled() && row.payment_intent_id) {
    if (!row.paid) {
      await cancelPaymentIntent(row.payment_intent_id);
    } else if (isRefundableLeave(new Date(row.starts_at), new Date())) {
      await refundPaymentIntent(row.payment_intent_id);
    }
    // else: within 24h of start — forfeit, no refund.
  }
  if (row.was_joined) {
    const { data } = await svc.rpc("promote_waitlist", { p_game_id: gameId });
    const promoted = (data ?? [])[0] as { payment_intent_id: string | null; game_confirmed: boolean } | undefined;
    if (promoted?.payment_intent_id && promoted.game_confirmed && paymentsEnabled()) {
      await capturePaymentIntent(promoted.payment_intent_id);
      await svc.rpc("mark_captured", { p_payment_intent_id: promoted.payment_intent_id });
    }
  }
}
```

- [ ] **Step 3: Call `settleConfirmation` in the webhook on a joined paid join**

In `apps/web/app/api/stripe/webhook/route.ts`, import at top:
```ts
import { settleConfirmation } from "@/lib/payments/settle";
```
In the `checkout.session.completed` branch, replace the current post-`join_paid` logic so it: returns 500 on `error`; cancels the hold only when `data === "closed"`; and calls `settleConfirmation(gameId)` when `data === "joined"`:
```ts
    if (error) {
      return NextResponse.json({ error: "join failed" }, { status: 500 });
    }
    if (data === "closed") {
      await cancelPaymentIntent(paymentIntent);
    } else if (data === "joined") {
      await settleConfirmation(gameId);
    }
    // 'waitlisted' / 'dup' → keep the hold, nothing to settle.
```

- [ ] **Step 4: Typecheck + build (no Stripe env)**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS with no Stripe env.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): capture/refund seam + settle helpers; webhook confirms on paid join"
```

---

### Task 4: web — join confirmation + host cancel + leave settle (server actions)

**Files:**
- Modify: `apps/web/app/game/[id]/actions.ts`
- Create: `apps/web/app/game/[id]/cancel-actions.ts`

**Interfaces:**
- Consumes: `settleConfirmation`, `settleCancellation`, `settleLeave`; `game_detail`/`join_game`/`leave_game`/`cancel_game` RPCs.
- Produces: updated `joinAction`/`leaveAction`; `cancelGameAction`.

- [ ] **Step 1: Update `joinAction` and `leaveAction` in `apps/web/app/game/[id]/actions.ts`**

Add imports:
```ts
import { settleConfirmation, settleLeave } from "@/lib/payments/settle";
```

Change `joinAction` so it inspects the result and settles confirmation on a real join. Replace the current `join_game` call + error handling with:
```ts
  const { data, error } = await supabase.rpc("join_game", { p_game_id: gameId });
  if (error) {
    if (error.message.toLowerCase().includes("verify")) redirect("/verify-phone");
    redirect(`/game/${gameId}?error=${encodeURIComponent(friendlyGameError(error.message))}`);
  }
  if (data === "joined") {
    await settleConfirmation(gameId);
  }
  redirect(`/game/${gameId}`);
```

Change `leaveAction` so it settles the leave. Replace its current `leave_game` call + redirect with:
```ts
  const { data, error } = await supabase.rpc("leave_game", { p_game_id: gameId });
  if (error) {
    redirect(`/game/${gameId}?error=${encodeURIComponent(friendlyGameError(error.message))}`);
  }
  const row = (data ?? [])[0] as
    | { payment_intent_id: string | null; paid: boolean; starts_at: string; was_joined: boolean }
    | undefined;
  if (row) {
    await settleLeave(row, gameId);
  }
  redirect(`/game/${gameId}`);
```

- [ ] **Step 2: Create `apps/web/app/game/[id]/cancel-actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { friendlyGameError } from "@footylocal/core";
import { createClient } from "@/lib/supabase/server";
import { settleCancellation } from "@/lib/payments/settle";

export async function cancelGameAction(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data, error } = await supabase.rpc("cancel_game", { p_game_id: gameId });
  if (error) {
    redirect(`/game/${gameId}?error=${encodeURIComponent(friendlyGameError(error.message))}`);
  }
  const rows = (data ?? []) as { payment_intent_id: string | null; paid: boolean }[];
  await settleCancellation(rows);
  redirect(`/game/${gameId}`);
}
```

- [ ] **Step 3: Add "host" to `friendlyGameError` coverage (verify)**

`friendlyGameError` already maps "host" (leave) and generic. `cancel_game` raises "only the host can cancel this game" (contains "host") → maps to the host message; acceptable. No change required.

- [ ] **Step 4: Typecheck + build (no Stripe env)**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): join confirmation + leave settle + host cancel-game action"
```

---

### Task 5: web — game detail status/waitlist/cancel UI + My Games status

**Files:**
- Modify: `apps/web/app/game/[id]/page.tsx`, `apps/web/app/(tabs)/my-games/page.tsx`

**Interfaces:**
- Consumes: updated `game_detail` (`status`, `viewer_status`, `min_players_to_confirm`, `joined_count`), `my_games` (`status`, `player_status`); `cancelGameAction`.

- [ ] **Step 1: Update `apps/web/app/game/[id]/page.tsx`**

Add the import:
```tsx
import { cancelGameAction } from "./cancel-actions";
```

Extend the `Detail` type with `viewer_status: string | null;` and `min_players_to_confirm: number;` (add if missing).

After `const spots = ...` add:
```tsx
  const isWaitlisted = game.viewer_status === "waitlisted";
  const isCancelled = game.status === "cancelled";
  const isConfirmed = game.status === "confirmed";
```

Below the metadata block, add status + host-cancel:
```tsx
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {isConfirmed && <Badge tone="accent">confirmed</Badge>}
        {isCancelled && <span className="text-[var(--color-error)]">This game was cancelled.</span>}
        {game.status === "open" && (
          <span className="text-neutral-600">{Number(game.joined_count)} of {game.min_players_to_confirm} to confirm</span>
        )}
      </div>
      {isHost && !isCancelled && (
        <form>
          <input type="hidden" name="gameId" value={game.id} />
          <button formAction={cancelGameAction} className="text-xs uppercase text-[var(--color-error)] underline">
            Cancel game
          </button>
        </form>
      )}
```

In the not-joined section: if `isWaitlisted`, show a waitlist state + a Leave (waitlist) button instead of Join; if `isCancelled`, show nothing joinable; otherwise the Join branch with a "Join waitlist" label when full. Replace the not-joined `<section>` content's Join area with:
```tsx
          {isCancelled ? (
            <p className="text-sm text-neutral-600">This game was cancelled.</p>
          ) : isWaitlisted ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-neutral-600">You're on the waitlist. You'll take a spot if one opens.</p>
              <form>
                <input type="hidden" name="gameId" value={game.id} />
                <button formAction={leaveAction} className="rounded-[var(--radius-pill)] border border-ink px-6 py-3 text-sm font-semibold uppercase">
                  Leave waitlist
                </button>
              </form>
            </div>
          ) : (
            <form>
              <input type="hidden" name="gameId" value={game.id} />
              {isPaid && paymentsEnabled() ? (
                <Button variant="accent" formAction={joinPaidAction}>
                  {spots > 0 ? `Join${priceLabel}` : `Join waitlist${priceLabel}`}
                </Button>
              ) : isPaid ? (
                <Button variant="accent" disabled>Paid join unavailable</Button>
              ) : (
                <Button variant="accent" formAction={joinAction}>
                  {spots > 0 ? "Join game" : "Join waitlist"}
                </Button>
              )}
            </form>
          )}
```
(Keep the existing phone-verify link branch: if not phone-verified, still show the verify link ahead of the Join options.)

- [ ] **Step 2: Update `apps/web/app/(tabs)/my-games/page.tsx`**

Extend the `MyGame` type with `status: string;` and `player_status: string;`. In the `Row` component, show a small status tag next to the title:
```tsx
        {g.player_status === "waitlisted" && <Badge>waitlist</Badge>}
        {g.status === "confirmed" && <Badge tone="accent">confirmed</Badge>}
        {g.status === "cancelled" && <span className="text-xs uppercase text-[var(--color-error)]">cancelled</span>}
        {g.role === "host" && <Badge tone="accent">host</Badge>}
```
(Replace the existing single host-badge line with this group.)

- [ ] **Step 3: Typecheck + build (no Stripe env)**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS; `/game/[id]` and `/my-games` compile.

- [ ] **Step 4: Manual/runbook note**

The paid money flows (capture on confirm, refund on cancel/leave, promoted-hold capture) require Stripe keys + `stripe listen` and are a runbook per the spec. Free-game confirmation/waitlist/promote/cancel is live now.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): game detail status/waitlist/cancel UI + My Games status tags"
```

---

## Final Verification (Definition of Done)

- [ ] `pnpm typecheck` clean; `pnpm --filter @footylocal/core test` green (isRefundableLeave); `pnpm --filter @footylocal/web build` succeeds with no Stripe env.
- [ ] Task 2 smoke passed: join → confirm at min (free: 0 PIs); full → waitlist; leave → promote (game_confirmed reported); host cancel → cancelled; demo games untouched (3 remaining).
- [ ] Confirmation captures uncaptured joined holds (runbook); cancel voids/refunds (fee reversed, runbook); leave voids/refunds per 24h (runbook); promoted hold captures if confirmed (runbook).
- [ ] Webhook: 'joined' → settleConfirmation; 'closed' → cancel hold; 'waitlisted'/'dup' → keep hold; error → 500.
- [ ] Game detail shows status/confirmation/waitlist + host Cancel; My Games shows status tags. join_game/join_paid waitlist when full; cancel_game host-only; try_confirm_game/promote_waitlist/mark_captured service-role only; leave_game/cancel_game race-safe.

## Self-Review Notes (author)

- **Spec coverage:** confirm+capture §Flow1 → try_confirm_game/mark_captured (T2) + settleConfirmation (T3) + join wiring (T3/T4); cancel §Flow2 → cancel_game (T2) + settleCancellation (T3) + cancelGameAction (T4); leave 24h §Flow3 → leave_game (T2) + settleLeave (T3) + leaveAction (T4) + isRefundableLeave (T1); waitlist §Flow4 → join_game/join_paid/promote_waitlist (T2) + settleLeave promote (T3) + UI (T5); UI §7 → T5; DoD §9 → Final Verification.
- **Security:** service-role-only try_confirm_game/mark_captured/promote_waitlist/join_paid (revoked from public/anon/authenticated); cancel_game host-gated (auth.uid()); settle helpers server-only + paymentsEnabled-guarded; capture idempotent (mark_captured guards paid=false). Webhook cancels a paid hold only on 'closed'.
- **Race safety:** every state-changing RPC FOR UPDATEs the game row.
- **Type consistency:** settle helper row shapes ↔ RPC return columns (payment_intent_id/paid/starts_at/was_joined; payment_intent_id/game_confirmed); game_detail adds viewer_status ↔ page Detail type; my_games adds status/player_status ↔ MyGame type.
- **Known follow-ups (2c/later):** auto-expiry of unconfirmed games (scheduler); "spot opened" + confirm/cancel notifications; no-show tracking; a lingering hold from a genuine double-pay 'dup' (Stripe auto-cancels after ~7 days).
```

