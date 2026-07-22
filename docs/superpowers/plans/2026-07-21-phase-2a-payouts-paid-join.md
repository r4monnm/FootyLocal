# FootyLocal Phase 2a: Host Payouts + Paid Join — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paid games via Stripe: host onboards through Connect Express; creating a paid game requires onboarding + a $5 floor; joining a paid game places a manual-capture authorization hold via hosted Checkout (destination charge + 10% fee). All seam-gated so the app runs with no Stripe keys. Capture is 2b.

**Architecture:** Fee math is pure + tested in `packages/core`. Stripe SDK calls sit behind a server-only seam (`apps/web/lib/stripe`) that throws when `STRIPE_SECRET_KEY` is unset. Paid joins go through hosted Checkout; a signature-verified webhook records the roster row via a service-role, race-safe `join_paid` RPC (canceling the hold if the game filled first).

**Tech Stack:** TypeScript strict, Next.js App Router (Route Handler for the webhook), Supabase (Postgres RPC), Stripe Node SDK, Zod, Vitest.

## Global Constraints

- Inherits all prior constraints (TS strict/no-any, RLS, no precise/roster leakage, design tokens, anonymity).
- **Seam-gated payments:** every Stripe SDK call is behind the server-only seam; `paymentsEnabled()` gates UI; the app builds + runs with **no Stripe env**; the seam is never bundled to the client.
- **Money correctness:** fee math pure + tested; paid-join capacity is race-safe at webhook time (`join_paid` row lock); an over-capacity hold is canceled, never captured. Amounts/destination/fee are computed server-side from `price_cents` + host account — never from the client.
- Webhook signature verified (`STRIPE_WEBHOOK_SECRET`).
- Live DB provisioned; source `.env` for live DB commands. `tsx -e` fails here — use temp `.ts` files, delete before commit.
- **No Stripe keys yet** ("build now, wire keys later"): verification is typecheck + `next build`; the live Stripe smoke is a documented runbook, deferred.
- Frequent commits: each task ends committed.

---

## File Structure

```
packages/core/
  src/payments/index.ts         # PLATFORM_FEE_BPS, PRICE_FLOOR_CENTS, platformFeeCents, isValidPriceCents
  src/payments/payments.test.ts
  src/index.ts                  # + export payments
  src/validation/index.ts       # gameCreateSchema price-floor refinement
packages/db/
  src/schema/index.ts           # profiles + stripe_account_id, stripe_charges_enabled
  migrations/0001_*.sql         # drizzle-generated (the two columns)
  migrations/sql/0012_join_paid.sql
apps/web/
  package.json                  # + stripe
  lib/stripe/index.ts           # seam: paymentsEnabled, getStripe, connect/checkout helpers
  app/api/stripe/webhook/route.ts
  app/(tabs)/profile/page.tsx   # + Payouts section (modify)
  app/(tabs)/profile/payout-actions.ts  # startOnboardingAction
  app/(tabs)/host/actions.ts    # paid-game gating (modify)
  app/(tabs)/host/HostGameForm.tsx  # price field (modify)
  app/game/[id]/page.tsx        # paid vs free Join (modify)
  app/game/[id]/pay-actions.ts  # joinPaidAction
  .env.example                  # + Stripe vars (repo root)
  README.md                     # + Stripe/Connect/stripe-listen setup (repo root)
```

---

### Task 1: core — payments fee math + price floor + gameCreateSchema refinement (TDD)

**Files:**
- Create: `packages/core/src/payments/index.ts`, `packages/core/src/payments/payments.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/validation/index.ts`, `packages/core/src/validation/validation.test.ts`

**Interfaces:**
- Produces: `PLATFORM_FEE_BPS`, `PRICE_FLOOR_CENTS`, `platformFeeCents(priceCents)`, `isValidPriceCents(priceCents)`; `gameCreateSchema` enforces the floor.

- [ ] **Step 1: Write `packages/core/src/payments/payments.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { platformFeeCents, isValidPriceCents, PRICE_FLOOR_CENTS } from "./index.js";

describe("platformFeeCents", () => {
  it("is 10% of the price", () => {
    expect(platformFeeCents(500)).toBe(50);
    expect(platformFeeCents(1000)).toBe(100);
    expect(platformFeeCents(0)).toBe(0);
  });
  it("rounds to the nearest cent", () => {
    expect(platformFeeCents(555)).toBe(56); // 55.5 -> 56
  });
});

describe("isValidPriceCents", () => {
  it("allows free ($0)", () => {
    expect(isValidPriceCents(0)).toBe(true);
  });
  it("rejects 1..floor-1", () => {
    expect(isValidPriceCents(1)).toBe(false);
    expect(isValidPriceCents(PRICE_FLOOR_CENTS - 1)).toBe(false);
  });
  it("allows the floor and above", () => {
    expect(isValidPriceCents(PRICE_FLOOR_CENTS)).toBe(true);
    expect(isValidPriceCents(2000)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @footylocal/core test`
Expected: FAIL — `./payments/index.js` not found.

- [ ] **Step 3: Implement `packages/core/src/payments/index.ts`**

```ts
/** Platform economics. Fee math is pure so both web and the future native app
 * (and tests) share one definition. */

/** Platform application fee in basis points (1000 = 10%). */
export const PLATFORM_FEE_BPS = 1000;

/** Minimum price for a PAID game, so Stripe's fixed fee doesn't dominate. Free
 * games ($0) are always allowed. */
export const PRICE_FLOOR_CENTS = 500;

/** Platform fee (in cents) taken from a paid game's price. */
export function platformFeeCents(priceCents: number): number {
  return Math.round((priceCents * PLATFORM_FEE_BPS) / 10000);
}

/** A price is valid iff it is free ($0) or at least the floor. */
export function isValidPriceCents(priceCents: number): boolean {
  return priceCents === 0 || priceCents >= PRICE_FLOOR_CENTS;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @footylocal/core test`
Expected: PASS.

- [ ] **Step 5: Export from barrel `packages/core/src/index.ts`**

Add:
```ts
export * from "./payments/index.js";
```
(after the existing exports).

- [ ] **Step 6: Add the price-floor refinement to `gameCreateSchema` in `packages/core/src/validation/index.ts`**

Add the import near the top:
```ts
import { isValidPriceCents } from "../payments/index.js";
```
Then add a refinement to the existing `gameCreateSchema` chain (append after the existing `.refine(...)` calls, before the `export type GameCreateInput` line):
```ts
  .refine((d) => isValidPriceCents(d.priceCents), {
    message: "Paid games must be at least $5 (or free).",
    path: ["priceCents"],
  })
```

- [ ] **Step 7: Add a gameCreateSchema price test to `packages/core/src/validation/validation.test.ts`**

Append inside the existing `describe("gameCreateSchema", ...)` block (it already has a `base` object):
```ts
  it("rejects a paid price below the $5 floor", () => {
    expect(gameCreateSchema.safeParse({ ...base, priceCents: 300 }).success).toBe(false);
  });
  it("allows free and >=$5", () => {
    expect(gameCreateSchema.safeParse({ ...base, priceCents: 0 }).success).toBe(true);
    expect(gameCreateSchema.safeParse({ ...base, priceCents: 500 }).success).toBe(true);
  });
```

- [ ] **Step 8: Typecheck + full tests**

Run: `pnpm --filter @footylocal/core typecheck && pnpm --filter @footylocal/core test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(core): platform fee math + price floor; gameCreateSchema floor refinement"
```

---

### Task 2: db — profiles Stripe columns (Drizzle) + join_paid RPC; apply live

**Files:**
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0001_*.sql` (drizzle-generated), `packages/db/migrations/sql/0012_join_paid.sql`

**Interfaces:**
- Produces: `profiles.stripe_account_id`, `profiles.stripe_charges_enabled`; `join_paid(uuid,uuid,text)` (service_role only, race-safe, returns 'joined'|'full'|'closed'|'dup').

- [ ] **Step 1: Add columns to the `profiles` table in `packages/db/src/schema/index.ts`**

In the `profiles` `pgTable(...)`, add (near the verification fields):
```ts
  stripeAccountId: text("stripe_account_id"),
  stripeChargesEnabled: boolean("stripe_charges_enabled").default(false).notNull(),
```

- [ ] **Step 2: Generate the Drizzle migration**

Run: `pnpm --filter @footylocal/db generate`
Expected: creates `packages/db/migrations/0001_*.sql` adding the two columns (diff vs the 0000 snapshot). It should NOT touch geo/RLS (those aren't in the Drizzle snapshot). Confirm the generated SQL only alters `profiles`.

- [ ] **Step 3: Apply the Drizzle migration to the live DB**

Run:
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db migrate
```
Expected: applies `0001` (the two columns), no errors. (`0000` is already recorded as applied.)

- [ ] **Step 4: Create `packages/db/migrations/sql/0012_join_paid.sql`**

```sql
-- Paid join, called by the Stripe webhook (service role) after a Checkout hold.
-- Race-safe (row lock); records the held payment_intent_id with paid=false.
-- Returns 'joined' | 'full' | 'closed' | 'dup' so the webhook can cancel the
-- hold when the player couldn't be added.
create or replace function join_paid(
  p_game_id uuid,
  p_player_id uuid,
  p_payment_intent_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status game_status;
  v_max integer;
  v_count integer;
begin
  select status, max_players into v_status, v_max
  from games where id = p_game_id for update;
  if not found then return 'closed'; end if;
  if v_status <> 'open' then return 'closed'; end if;

  if exists (
    select 1 from game_players
    where game_id = p_game_id and player_id = p_player_id and status = 'joined'
  ) then return 'dup'; end if;

  select count(*) into v_count
  from game_players where game_id = p_game_id and status = 'joined';
  if v_count >= v_max then return 'full'; end if;

  insert into game_players (game_id, player_id, role, status, paid, payment_intent_id)
  values (p_game_id, p_player_id, 'player', 'joined', false, p_payment_intent_id)
  on conflict (game_id, player_id) do update
    set status = 'joined', role = 'player', paid = false,
        payment_intent_id = excluded.payment_intent_id;

  return 'joined';
end;
$$;

revoke execute on function join_paid(uuid, uuid, text) from public, anon, authenticated;
grant execute on function join_paid(uuid, uuid, text) to service_role;
```

- [ ] **Step 5: Apply the SQL migration live**

Run:
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db sql
```
Expected: applies through `0012 ok`, no errors.

- [ ] **Step 6: Verify live (columns + grant)**

Create `packages/db/scripts/_v2a.ts` (delete after):
```ts
import postgres from "postgres";
const s = postgres(process.env.DATABASE_URL!, { max: 1 });
const cols = await s`select column_name from information_schema.columns where table_name='profiles' and column_name in ('stripe_account_id','stripe_charges_enabled') order by column_name`;
console.log("profiles stripe columns:", cols.map((c) => c.column_name).join(", "));
const g = await s`select grantee from information_schema.role_routine_grants where routine_name='join_paid' order by grantee`;
console.log("join_paid grantees:", [...new Set(g.map((x) => x.grantee))].join(", "));
await s.end();
```
Run (source `.env`), then `rm -f packages/db/scripts/_v2a.ts`.
Expected: `profiles stripe columns: stripe_account_id, stripe_charges_enabled`; `join_paid grantees: postgres, service_role` (NOT anon/authenticated).

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @footylocal/db typecheck`
Expected: PASS.
```bash
git add -A
git commit -m "feat(db): profiles Stripe Connect columns + service-role join_paid RPC"
```

---

### Task 3: web — Stripe seam + webhook route + env/README

**Files:**
- Modify: `apps/web/package.json`, `.env.example`, `README.md`
- Create: `apps/web/lib/stripe/index.ts`, `apps/web/app/api/stripe/webhook/route.ts`

**Interfaces:**
- Consumes: `stripe`, `platformFeeCents` from `@footylocal/core`, `createServiceClient` from `@footylocal/db`.
- Produces: the seam (`paymentsEnabled`, `getStripe`, `createConnectAccount`, `createAccountLink`, `retrieveChargesEnabled`, `createPaidJoinCheckout`, `cancelPaymentIntent`); the webhook route.

- [ ] **Step 1: Add `stripe` to `apps/web/package.json` dependencies + install**

Add `"stripe": "^17.0.0"` to `dependencies`, then `pnpm install`.

- [ ] **Step 2: Create `apps/web/lib/stripe/index.ts`**

```ts
import "server-only";
import Stripe from "stripe";
import { platformFeeCents } from "@footylocal/core";

/** Whether Stripe is configured. UI gates paid features on this. */
export function paymentsEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

let client: Stripe | null = null;
/** Lazily constructs the Stripe client. Throws if not configured. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("payments not configured");
  client ??= new Stripe(key);
  return client;
}

export async function createConnectAccount(email: string): Promise<string> {
  const account = await getStripe().accounts.create({ type: "express", email });
  return account.id;
}

export async function createAccountLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<string> {
  const link = await getStripe().accountLinks.create({
    account: accountId,
    return_url: returnUrl,
    refresh_url: refreshUrl,
    type: "account_onboarding",
  });
  return link.url;
}

export async function retrieveChargesEnabled(accountId: string): Promise<boolean> {
  const account = await getStripe().accounts.retrieve(accountId);
  return account.charges_enabled ?? false;
}

export async function createPaidJoinCheckout(opts: {
  gameId: string;
  playerId: string;
  title: string;
  priceCents: number;
  hostAccountId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: opts.priceCents,
          product_data: { name: `FootyLocal — ${opts.title}` },
        },
      },
    ],
    payment_intent_data: {
      capture_method: "manual",
      transfer_data: { destination: opts.hostAccountId },
      application_fee_amount: platformFeeCents(opts.priceCents),
    },
    metadata: { game_id: opts.gameId, player_id: opts.playerId },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });
  if (!session.url) throw new Error("checkout session has no url");
  return session.url;
}

export async function cancelPaymentIntent(id: string): Promise<void> {
  await getStripe().paymentIntents.cancel(id);
}
```

- [ ] **Step 3: Create `apps/web/app/api/stripe/webhook/route.ts`**

```ts
import { type NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createServiceClient } from "@footylocal/db";
import { getStripe, cancelPaymentIntent } from "@/lib/stripe";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const body = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  const supabase = createServiceClient();

  if (event.type === "account.updated") {
    const account = event.data.object;
    await supabase
      .from("profiles")
      .update({ stripe_charges_enabled: account.charges_enabled ?? false })
      .eq("stripe_account_id", account.id);
  } else if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const gameId = session.metadata?.game_id;
    const playerId = session.metadata?.player_id;
    const paymentIntent =
      typeof session.payment_intent === "string" ? session.payment_intent : null;
    if (gameId && playerId && paymentIntent) {
      const { data } = await supabase.rpc("join_paid", {
        p_game_id: gameId,
        p_player_id: playerId,
        p_payment_intent_id: paymentIntent,
      });
      // Couldn't add them (full/closed/dup) → release the authorization hold.
      if (data !== "joined") {
        await cancelPaymentIntent(paymentIntent);
      }
    }
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 4: Add Stripe vars to `.env.example`**

Append:
```bash
# Stripe (test mode). Payments are seam-gated: with these unset, the app runs
# and paid features are hidden. See README for Connect + stripe listen setup.
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
# Base URL for Stripe Checkout success/cancel + onboarding return links.
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

- [ ] **Step 5: Add a Stripe setup section to `README.md`**

Append:
```markdown
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
```

- [ ] **Step 6: Typecheck + build**

Run: `pnpm install && pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS with **no Stripe env** (the seam compiles; the webhook returns 503 when unconfigured). If `stripe` types need a pinned apiVersion, `new Stripe(key)` without options is fine for the installed v17.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): server-only Stripe seam + signature-verified webhook (account.updated, checkout.session.completed)"
```

---

### Task 4: web — host onboarding (Profile) + paid-game gating + price field

**Files:**
- Create: `apps/web/app/(tabs)/profile/payout-actions.ts`
- Modify: `apps/web/app/(tabs)/profile/page.tsx`, `apps/web/app/(tabs)/host/actions.ts`, `apps/web/app/(tabs)/host/HostGameForm.tsx`

**Interfaces:**
- Consumes: the Stripe seam; server Supabase client + `createServiceClient`.
- Produces: `startOnboardingAction`; Profile Payouts section; host paid-game gating + price input.

- [ ] **Step 1: Create `apps/web/app/(tabs)/profile/payout-actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@footylocal/db";
import { createClient } from "@/lib/supabase/server";
import {
  paymentsEnabled,
  createConnectAccount,
  createAccountLink,
} from "@/lib/stripe";

export async function startOnboardingAction(): Promise<void> {
  if (!paymentsEnabled()) redirect("/profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const svc = createServiceClient();
  const { data: profile } = await svc
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", user.id)
    .single();

  let accountId = profile?.stripe_account_id ?? null;
  if (!accountId) {
    accountId = await createConnectAccount(user.email ?? "");
    await svc.from("profiles").update({ stripe_account_id: accountId }).eq("id", user.id);
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const url = await createAccountLink(
    accountId,
    `${base}/profile?onboarding=done`,
    `${base}/profile`,
  );
  redirect(url);
}
```

- [ ] **Step 2: Add the Payouts section to `apps/web/app/(tabs)/profile/page.tsx`**

Add imports:
```tsx
import { paymentsEnabled, retrieveChargesEnabled } from "@/lib/stripe";
import { createServiceClient } from "@footylocal/db";
import { startOnboardingAction } from "./payout-actions";
```

Change the signature to accept searchParams:
```tsx
export default async function Profile({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const { onboarding } = await searchParams;
```

After the existing profile fetch (where `phoneVerified` is set), add payout status resolution (only when payments are enabled):
```tsx
  let chargesEnabled = false;
  if (user && paymentsEnabled()) {
    const svc = createServiceClient();
    const { data: pay } = await svc
      .from("profiles")
      .select("stripe_account_id, stripe_charges_enabled")
      .eq("id", user.id)
      .single();
    chargesEnabled = pay?.stripe_charges_enabled ?? false;
    // On return from onboarding, refresh status on demand.
    if (onboarding === "done" && pay?.stripe_account_id && !chargesEnabled) {
      chargesEnabled = await retrieveChargesEnabled(pay.stripe_account_id);
      if (chargesEnabled) {
        await svc.from("profiles").update({ stripe_charges_enabled: true }).eq("id", user.id);
      }
    }
  }
```

Then render a Payouts block (place it after the stats grid, before Blocked users), only when `paymentsEnabled()`:
```tsx
      {paymentsEnabled() && (
        <div>
          <h2 className="text-xs uppercase text-neutral-500">Payouts</h2>
          {chargesEnabled ? (
            <div className="mt-2"><Badge tone="accent">payouts active</Badge></div>
          ) : (
            <form className="mt-2">
              <button formAction={startOnboardingAction}
                className="rounded-[var(--radius-pill)] bg-ink px-6 py-3 text-sm font-semibold uppercase text-accent">
                Set up payouts
              </button>
            </form>
          )}
        </div>
      )}
```

- [ ] **Step 3: Add paid-game gating to `apps/web/app/(tabs)/host/actions.ts`**

After the `gameCreateSchema.safeParse(...)` success check (before `createGame`), add a paid-game host-onboarding gate:
```ts
  if (parsed.data.priceCents > 0) {
    const { data: pay } = await supabase
      .from("profiles")
      .select("stripe_charges_enabled")
      .eq("id", user.id)
      .single();
    if (!pay?.stripe_charges_enabled) {
      redirect(`/profile?payouts=required`);
    }
  }
```
(Note: the `supabase` user client can read the caller's own `stripe_charges_enabled` via `profiles_read`.)

- [ ] **Step 4: Add a price field to `apps/web/app/(tabs)/host/HostGameForm.tsx`**

Currently `priceCents` is hard-coded to 0 in the action. Add a dollars input to the form (before the submit button):
```tsx
      <label className="text-xs uppercase text-neutral-500">Price (USD, 0 for free; $5 min if paid)</label>
      <input name="priceUsd" type="number" min={0} step="1" defaultValue={0} className={FIELD} />
```
And in `apps/web/app/(tabs)/host/actions.ts`, replace `priceCents: 0,` in the `safeParse` object with:
```ts
    priceCents: Math.round(Number(formData.get("priceUsd") ?? 0) * 100),
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS with no Stripe env (Payouts section hidden when `!paymentsEnabled()`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): host Stripe onboarding (Profile) + paid-game gating + price field"
```

---

### Task 5: web — paid join via Checkout

**Files:**
- Create: `apps/web/app/game/[id]/pay-actions.ts`
- Modify: `apps/web/app/game/[id]/page.tsx`

**Interfaces:**
- Consumes: the Stripe seam; `game_detail`; server Supabase client + `createServiceClient`.
- Produces: `joinPaidAction`; paid vs free Join on the game detail page.

- [ ] **Step 1: Create `apps/web/app/game/[id]/pay-actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@footylocal/db";
import { createClient } from "@/lib/supabase/server";
import { createPaidJoinCheckout } from "@/lib/stripe";

export async function joinPaidAction(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId"));
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

  const { data: rows } = await supabase.rpc("game_detail", { p_game_id: gameId });
  const game = rows?.[0] as
    | { title: string; status: string; price_cents: number; max_players: number; joined_count: number; viewer_joined: boolean; host_id: string }
    | undefined;
  if (!game) redirect("/discover");
  if (game.viewer_joined) redirect(`/game/${gameId}`);
  if (game.status !== "open" || game.max_players - Number(game.joined_count) <= 0) {
    redirect(`/game/${gameId}?error=${encodeURIComponent("This game can't be joined right now.")}`);
  }

  // Host account (service read — not exposed to the client).
  const svc = createServiceClient();
  const { data: host } = await svc
    .from("profiles")
    .select("stripe_account_id, stripe_charges_enabled")
    .eq("id", game.host_id)
    .single();
  if (!host?.stripe_charges_enabled || !host.stripe_account_id) {
    redirect(`/game/${gameId}?error=${encodeURIComponent("This host can't accept payments yet.")}`);
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const url = await createPaidJoinCheckout({
    gameId,
    playerId: user.id,
    title: game.title,
    priceCents: game.price_cents,
    hostAccountId: host.stripe_account_id,
    successUrl: `${base}/game/${gameId}?paid=success`,
    cancelUrl: `${base}/game/${gameId}?paid=cancel`,
  });
  redirect(url);
}
```

- [ ] **Step 2: Wire paid vs free Join in `apps/web/app/game/[id]/page.tsx`**

Add imports:
```tsx
import { paymentsEnabled } from "@/lib/stripe";
import { joinPaidAction } from "./pay-actions";
```

Extend the `Detail` type with `price_cents: number;` (if not already present — game_detail returns it).

Add near the top of the component (after `const spots = ...`):
```tsx
  const isPaid = game.price_cents > 0;
  const priceLabel = isPaid ? ` · $${(game.price_cents / 100).toFixed(0)}` : "";
```

Also surface `?paid=` and `?error=` notices — extend the searchParams type to `{ error?: string; paid?: string }` and add near the top of the render:
```tsx
      {paid === "cancel" && <p className="text-sm text-neutral-500">Payment canceled — you're not on the roster.</p>}
      {paid === "success" && <p className="text-sm text-[var(--color-success)]">Payment received — confirming your spot…</p>}
```
(destructure `paid` from `searchParams` alongside `error`.)

In the not-joined Join branch, replace the single Join form with a paid/free split:
```tsx
            <form>
              <input type="hidden" name="gameId" value={game.id} />
              {isPaid && paymentsEnabled() ? (
                <Button variant="accent" formAction={joinPaidAction}>Join{priceLabel}</Button>
              ) : isPaid ? (
                <Button variant="accent" disabled>Paid join unavailable</Button>
              ) : (
                <Button variant="accent" formAction={joinAction}>Join game</Button>
              )}
            </form>
```
(`joinAction` is already imported for free joins.)

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS with no Stripe env.

- [ ] **Step 4: Manual/runbook note**

The live paid-join smoke (test onboarding + `4242` card + webhook adds the held roster row; over-capacity cancels the hold) requires Stripe keys + `stripe listen` and is deferred per the spec. Add nothing to run now beyond build.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): paid join via Stripe Checkout (manual-capture hold)"
```

---

## Final Verification (Definition of Done)

- [ ] `pnpm typecheck` clean; `pnpm --filter @footylocal/core test` green (fee math + price floor); `pnpm --filter @footylocal/web build` succeeds **with no Stripe env**.
- [ ] `join_paid` grantees = service_role only (Task 2 Step 6); `profiles` has the two Stripe columns.
- [ ] Seam throws when unconfigured; `paymentsEnabled()` hides paid UI; webhook verifies signatures and returns 503 when unconfigured.
- [ ] gameCreateSchema rejects paid prices 1–499; free + ≥$5 accepted.
- [ ] `.env.example` + README document Stripe/Connect/`stripe listen`.
- [ ] (Runbook, deferred) With keys: onboarding sets `stripe_charges_enabled`; paid game requires it; paid join → hosted Checkout hold → webhook `join_paid` adds roster row (`paid=false`) or cancels the hold if full.

## Self-Review Notes (author)

- **Spec coverage:** fee math §3.1 → T1; profiles columns + join_paid §4 → T2; seam §3.2 + webhook §3.3/§3.5 → T3; onboarding §3.3 + gating §3.4 → T4; paid join §3.5 → T5; env/README §7 → T3; DoD §9 → Final Verification.
- **Security:** join_paid service_role only (revoked from public/anon/authenticated); amounts/fee/destination computed server-side in the seam from price_cents + host account; webhook signature-verified; seam server-only (`import "server-only"`, never client-bundled). Host stripe_account_id read via service client, not exposed to the client.
- **Seam correctness:** every Stripe call behind `getStripe()` which throws when unconfigured; `paymentsEnabled()` gates all paid UI; build must pass with no env (verified in T3/T4/T5).
- **Race safety:** paid capacity enforced in join_paid with `for update` at webhook time; over-capacity hold canceled (T3 webhook).
- **Type consistency:** joinPaidAction reads game_detail fields (price_cents, host_id, status, max_players, joined_count, viewer_joined, title) that game_detail returns; createPaidJoinCheckout opts ↔ seam signature.
- **Known follow-ups (2b/2c):** capture on confirmation; refund/void on cancel; waitlists; no-show; notifications; the `server-only` note — unlike packages/db/games.ts, apps/web/lib/stripe is web-only and safe to guard with `import "server-only"`.
```

