# FootyLocal Phase 3b: Identity Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stripe Identity verification (government ID + selfie in one session), verification badges (phone → photo → id), and a server-enforced requirement that any host collecting payment be ID-verified — all seam-gated so the app builds/runs with no Stripe keys.

**Architecture:** Reuse the existing Stripe seam and key (`identityEnabled()` = `paymentsEnabled()`) and the existing signature-verified `/api/stripe/webhook`. A pure `verificationSummary` in `packages/core` (shared with the forthcoming native app). One Identity session sets `photo_verified` + `id_verified` + `verification_level='id'`. Migration 0016 adds a protected `stripe_identity_session_id` column, a service-role-only `mark_identity_verified` RPC, and a paid-host ID gate inside `create_game`.

**Tech Stack:** TypeScript strict, Next.js App Router, Supabase (Postgres, hand-written SQL RPCs, RLS + column grants), Stripe Identity (same `STRIPE_SECRET_KEY`), Vitest.

## Global Constraints

- **TS strict, no `any`** without justification. **RLS on every table; never trust the client for authorization** — the paid-host ID gate lives in the DB (`create_game`), not only in the web action.
- **Seam-gated Stripe:** all Stripe calls behind `getStripe()`; all Stripe UI/actions gated on `identityEnabled()`/`paymentsEnabled()`. `next build` + `pnpm typecheck` MUST pass with **no** Stripe env vars. **No new env var; no second webhook endpoint.**
- **One Identity session → sets `photo_verified` AND `id_verified` AND `verification_level='id'`.** No separate photo-only flow.
- **`stripe_identity_session_id` is never client-readable** (mirror `stripe_account_id`'s 0013 column protection). Read it server-side via the service-role client only.
- **Nike design tokens only** (`Badge` primitive, `bg-ink`/`text-accent`/`bg-gray`, `--radius-pill`, uppercase). No new colors.
- **Mobile portability:** new logic goes in `packages/core`; gates go in the DB; the seam returns a hosted URL. No web-only assumption.
- **Migration convention:** this repo replays ALL `packages/db/migrations/sql/*.sql` in order every run (no migration tracking). Redefine changed functions in the new file (0016) rather than editing older files, matching 0007–0015. `create_game` keeps its `returns uuid` signature (body-only change) so **no `drop function` is needed**.
- Frequent commits: each task ends committed.

---

## File Structure

```
packages/core/
  src/verification/index.ts        # NEW: verificationSummary + types (pure)
  src/verification/verification.test.ts  # NEW
  src/index.ts                     # + export verification
packages/db/
  migrations/sql/0016_identity.sql # NEW: protected column, mark_identity_verified, create_game paid-host gate
  src/schema/index.ts              # + stripeIdentitySessionId column (parity)
apps/web/
  lib/stripe/index.ts              # + identityEnabled, createIdentityVerificationSession
  app/api/stripe/webhook/route.ts  # + identity.verification_session.* branches
  app/(tabs)/profile/identity-actions.ts  # NEW: startIdentityVerificationAction
  app/(tabs)/profile/page.tsx      # verification badges + verify/pending button + notices
  app/game/[id]/page.tsx           # host verification badge
  app/(tabs)/host/actions.ts       # paid-create ID pre-check redirect
```

---

### Task 1: core — `verificationSummary` (TDD)

**Files:**
- Create: `packages/core/src/verification/index.ts`, `packages/core/src/verification/verification.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `type VerificationFlags = { phone_verified: boolean; photo_verified: boolean; id_verified: boolean }`
  - `type VerificationLevel = "none" | "phone" | "photo" | "id"`
  - `type VerificationBadge = "phone" | "photo" | "id"`
  - `verificationSummary(flags: VerificationFlags): { level: VerificationLevel; badges: VerificationBadge[] }`

- [ ] **Step 1: Write the failing test** — `packages/core/src/verification/verification.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { verificationSummary } from "./index.js";

describe("verificationSummary", () => {
  it("returns none with no badges when nothing is verified", () => {
    expect(verificationSummary({ phone_verified: false, photo_verified: false, id_verified: false }))
      .toEqual({ level: "none", badges: [] });
  });
  it("phone only", () => {
    expect(verificationSummary({ phone_verified: true, photo_verified: false, id_verified: false }))
      .toEqual({ level: "phone", badges: ["phone"] });
  });
  it("phone + photo", () => {
    expect(verificationSummary({ phone_verified: true, photo_verified: true, id_verified: false }))
      .toEqual({ level: "photo", badges: ["phone", "photo"] });
  });
  it("all three, ordered phone→photo→id", () => {
    expect(verificationSummary({ phone_verified: true, photo_verified: true, id_verified: true }))
      .toEqual({ level: "id", badges: ["phone", "photo", "id"] });
  });
  it("id without photo still reports level id", () => {
    expect(verificationSummary({ phone_verified: false, photo_verified: false, id_verified: true }))
      .toEqual({ level: "id", badges: ["id"] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @footylocal/core test`
Expected: FAIL — cannot resolve `verificationSummary`.

- [ ] **Step 3: Implement** — `packages/core/src/verification/index.ts`

```ts
export type VerificationFlags = {
  phone_verified: boolean;
  photo_verified: boolean;
  id_verified: boolean;
};

export type VerificationBadge = "phone" | "photo" | "id";
export type VerificationLevel = "none" | VerificationBadge;

/** Ordered badges a profile has earned + the highest level reached.
 * Order is phone → photo → id; level is the highest true flag (id > photo > phone). */
export function verificationSummary(
  flags: VerificationFlags,
): { level: VerificationLevel; badges: VerificationBadge[] } {
  const badges: VerificationBadge[] = [];
  if (flags.phone_verified) badges.push("phone");
  if (flags.photo_verified) badges.push("photo");
  if (flags.id_verified) badges.push("id");

  const level: VerificationLevel = flags.id_verified
    ? "id"
    : flags.photo_verified
      ? "photo"
      : flags.phone_verified
        ? "phone"
        : "none";

  return { level, badges };
}
```

- [ ] **Step 4: Export from the package index** — add to `packages/core/src/index.ts`:

```ts
export * from "./verification/index.js";
```

- [ ] **Step 5: Typecheck + tests**

Run: `pnpm --filter @footylocal/core typecheck && pnpm --filter @footylocal/core test`
Expected: PASS (all prior tests + the 5 new cases).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): verificationSummary (phone/photo/id badges + level) with tests"
```

---

### Task 2: DB — migration 0016 (protected column, RPC, paid-host gate)

**Files:**
- Create: `packages/db/migrations/sql/0016_identity.sql`
- Modify: `packages/db/src/schema/index.ts`

**Interfaces:**
- Produces (DB): column `profiles.stripe_identity_session_id text` (protected); RPC `mark_identity_verified(p_user_id uuid) returns void` (service-role only); `create_game` raises when `p_price_cents > 0` and the host is not `id_verified`.
- Consumes: existing `profiles` (`id_verified`, `photo_verified`, `verification_level`), `create_game` from 0006, the 0013 column-grant list.

**Context for the implementer:** `apply-sql` replays every SQL file in order. `create_game` is first defined in `0006_create_game.sql`; redefining it here (same `returns uuid`) supersedes it — do NOT drop it first (return type is unchanged) and do NOT edit 0006. The venue-fuzzing logic in the body is unchanged from 0006; only the paid-host guard is added.

- [ ] **Step 1: Write `packages/db/migrations/sql/0016_identity.sql`**

```sql
-- Phase 3b: identity verification (Stripe Identity).

-- 1) Protected column for the pending Identity session id. Like stripe_account_id,
-- it is server-only (service client). profiles' table SELECT was revoked in 0013
-- and re-granted per-column WITHOUT this column, so it is already excluded from
-- anon/authenticated; this explicit revoke documents and hard-guarantees that.
alter table profiles add column if not exists stripe_identity_session_id text;
revoke select (stripe_identity_session_id) on profiles from anon, authenticated;

-- 2) Flip verification flags on a completed Stripe Identity session. Called only
-- by the webhook (service role). SECURITY DEFINER + service_role-only, like create_game.
create or replace function mark_identity_verified(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
     set photo_verified = true,
         id_verified = true,
         verification_level = 'id',
         updated_at = now()
   where id = p_user_id;
end;
$$;

revoke execute on function mark_identity_verified(uuid) from public, anon, authenticated;
grant execute on function mark_identity_verified(uuid) to service_role;

-- 3) Paid-host ID gate. Redefines create_game from 0006 (same signature / returns uuid,
-- so no drop needed): a host may only create a PAID game if they are ID-verified. This is
-- the authoritative server-side guard behind the app-layer pre-check (never trust client).
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

  if p_price_cents > 0 then
    if not exists (select 1 from profiles where id = p_host_id and id_verified = true) then
      raise exception 'host must be ID-verified to collect payment';
    end if;
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
) from public, anon, authenticated;
grant execute on function create_game(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, skill_band,
  game_format, integer, integer, boolean, integer, double precision, double precision
) to service_role;
```

- [ ] **Step 2: Add the Drizzle parity column** — in `packages/db/src/schema/index.ts`, inside `profiles`, add after `stripeChargesEnabled`:

```ts
  stripeIdentitySessionId: text("stripe_identity_session_id"),
```

- [ ] **Step 3: Apply the migrations live**

Run (from repo root, env sourced):
```bash
set -a; . ./.env; set +a
pnpm --filter @footylocal/db sql
```
Expected: applies 0000–0016 with no error (the replay is idempotent).

- [ ] **Step 4: Smoke-verify the gate + protection** — write a temp `.ts` file (not `tsx -e`) that uses the service client, e.g. `packages/db/scripts/_smoke_3b.ts`:

```ts
import { createServiceClient } from "../src/client.js";
const s = createServiceClient();
// 3a) mark_identity_verified is service-role callable and idempotent:
const anyUser = (await s.from("profiles").select("id").limit(1).single()).data as { id: string };
console.log("mark:", (await s.rpc("mark_identity_verified", { p_user_id: anyUser.id })).error ?? "ok");
// 3b) paid create_game blocked for a NON-id-verified host:
await s.from("profiles").update({ id_verified: false }).eq("id", anyUser.id);
const venue = (await s.from("venues").select("id").eq("is_verified", true).limit(1).single()).data as { id: string };
const blocked = await s.rpc("create_game", {
  p_game_id: crypto.randomUUID(), p_host_id: anyUser.id, p_venue_id: venue.id,
  p_title: "smoke", p_description: null,
  p_starts_at: new Date(Date.now() + 86400000).toISOString(),
  p_ends_at: new Date(Date.now() + 90000000).toISOString(),
  p_skill_band: "open", p_format: "five_a_side", p_max_players: 10,
  p_min_players_to_confirm: 4, p_is_women_only: false, p_price_cents: 500,
  p_public_lat: 33.9, p_public_lng: -84.5,
});
console.log("paid-create blocked?:", blocked.error ? "YES: " + blocked.error.message : "NO (BUG)");
```
Run: `set -a; . ./.env; set +a; pnpm --filter @footylocal/db exec tsx scripts/_smoke_3b.ts`
Expected: `mark: ok`; `paid-create blocked?: YES: ... host must be ID-verified ...`. Then delete the temp file: `rm packages/db/scripts/_smoke_3b.ts`.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @footylocal/db typecheck`
Expected: PASS.
```bash
git add -A
git commit -m "feat(db): 0016 identity — protected session col, mark_identity_verified, create_game paid-host ID gate"
```

---

### Task 3: web — Stripe Identity seam + webhook

**Files:**
- Modify: `apps/web/lib/stripe/index.ts`
- Modify: `apps/web/app/api/stripe/webhook/route.ts`

**Interfaces:**
- Produces: `identityEnabled(): boolean`; `createIdentityVerificationSession(opts: { userId: string; returnUrl: string }): Promise<{ url: string; sessionId: string }>`.
- Consumes: `getStripe()`, `paymentsEnabled()` (same file); `mark_identity_verified` RPC (Task 2); `createServiceClient` (already imported in the webhook).

- [ ] **Step 1: Add the seam functions** — append to `apps/web/lib/stripe/index.ts`:

```ts
/** Stripe Identity uses the same secret key as payments, so the same gate applies. */
export function identityEnabled(): boolean {
  return paymentsEnabled();
}

/** Creates a hosted Stripe Identity session (government document + matching selfie).
 * Returns the redirect URL and the session id (persisted so the UI can show "pending"). */
export async function createIdentityVerificationSession(opts: {
  userId: string;
  returnUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  const session = await getStripe().identity.verificationSessions.create({
    type: "document",
    options: { document: { require_matching_selfie: true } },
    metadata: { user_id: opts.userId },
    return_url: opts.returnUrl,
  });
  if (!session.url) throw new Error("verification session has no url");
  return { url: session.url, sessionId: session.id };
}
```

- [ ] **Step 2: Add the webhook branches** — in `apps/web/app/api/stripe/webhook/route.ts`, add after the `checkout.session.completed` branch (before the closing of the `if/else if` chain, i.e. after the block ending at line ~54):

```ts
  } else if (event.type === "identity.verification_session.verified") {
    const session = event.data.object;
    const userId = session.metadata?.user_id;
    if (userId) {
      const { error } = await supabase.rpc("mark_identity_verified", { p_user_id: userId });
      // Transient failure → 500 so Stripe retries (the flags flip is idempotent).
      if (error) {
        return NextResponse.json({ error: "verify failed" }, { status: 500 });
      }
    }
  } else if (
    event.type === "identity.verification_session.requires_input" ||
    event.type === "identity.verification_session.canceled"
  ) {
    const session = event.data.object;
    const userId = session.metadata?.user_id;
    if (userId) {
      // Drop the pending session so Profile shows the retry button again.
      await supabase
        .from("profiles")
        .update({ stripe_identity_session_id: null })
        .eq("id", userId);
    }
```

(The existing chain is `if (account.updated) {...} else if (checkout.session.completed) {...}`; these two `else if` blocks extend it. Keep the final `return NextResponse.json({ received: true });`.)

- [ ] **Step 3: Typecheck + build (keyless)**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS with no Stripe env vars set (seam compiles; nothing calls it at build time).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): Stripe Identity seam + webhook verification branches"
```

---

### Task 4: web — Profile verification badges + verify/pending action

**Files:**
- Create: `apps/web/app/(tabs)/profile/identity-actions.ts`
- Modify: `apps/web/app/(tabs)/profile/page.tsx`

**Interfaces:**
- Consumes: `identityEnabled`, `createIdentityVerificationSession` (Task 3); `verificationSummary` (Task 1); `createServiceClient`; existing `paymentsEnabled`.
- Produces: `startIdentityVerificationAction(): Promise<void>`.

- [ ] **Step 1: Create the start action** — `apps/web/app/(tabs)/profile/identity-actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@footylocal/db";
import { createClient } from "@/lib/supabase/server";
import { identityEnabled, createIdentityVerificationSession } from "@/lib/stripe";

export async function startIdentityVerificationAction(): Promise<void> {
  if (!identityEnabled()) redirect("/profile");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { url, sessionId } = await createIdentityVerificationSession({
    userId: user.id,
    returnUrl: `${base}/profile?identity=done`,
  });

  const svc = createServiceClient();
  await svc
    .from("profiles")
    .update({ stripe_identity_session_id: sessionId })
    .eq("id", user.id);

  redirect(url);
}
```

- [ ] **Step 2: Read verification flags + pending state in `profile/page.tsx`**

Update the `searchParams` type and destructure:
```tsx
}: {
  searchParams: Promise<{ onboarding?: string; identity?: string; verify?: string; payouts?: string }>;
}) {
  const { onboarding, identity, verify, payouts } = await searchParams;
```

Add imports:
```tsx
import { computeTier, verificationSummary, type SkillBand } from "@footylocal/core";
import { startIdentityVerificationAction } from "./identity-actions";
```

Add `let` declarations near the others:
```tsx
  let photoVerified = false;
  let idVerified = false;
  let identityPending = false;
```

Extend the first profile select (currently `display_name, phone_verified, self_reported_skill`) to include the two anon-readable flags:
```tsx
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, phone_verified, self_reported_skill, photo_verified, id_verified")
      .eq("id", user.id)
      .single();
    displayName = profile?.display_name ?? null;
    phoneVerified = profile?.phone_verified ?? false;
    selfReported = (profile?.self_reported_skill ?? null) as SkillBand | null;
    photoVerified = profile?.photo_verified ?? false;
    idVerified = profile?.id_verified ?? false;
```

In the existing `if (user && paymentsEnabled())` service-role block, also select the protected session id and derive pending:
```tsx
    const { data: pay } = await svc
      .from("profiles")
      .select("stripe_account_id, stripe_charges_enabled, stripe_identity_session_id")
      .eq("id", user.id)
      .single();
    chargesEnabled = pay?.stripe_charges_enabled ?? false;
    identityPending = !idVerified && !!pay?.stripe_identity_session_id;
```

Compute the badge summary before the return:
```tsx
  const verif = verificationSummary({
    phone_verified: phoneVerified,
    photo_verified: photoVerified,
    id_verified: idVerified,
  });
  const VERIF_LABEL: Record<"phone" | "photo" | "id", string> = {
    phone: "Phone ✓",
    photo: "Photo ✓",
    id: "ID ✓",
  };
```

- [ ] **Step 3: Render badges, notices, and the verify/pending control**

Replace the current badge row:
```tsx
      <div className="flex flex-wrap items-center gap-2">
        {phoneVerified ? <Badge tone="accent">phone verified</Badge> : <Badge>unverified</Badge>}
        <Badge tone="accent">{tier.band}</Badge>
        <span className="text-xs uppercase text-neutral-400">{tier.source === "peer" ? "peer-rated" : "self-rated"}</span>
      </div>
```
with:
```tsx
      <div className="flex flex-wrap items-center gap-2">
        {verif.badges.length > 0 ? (
          verif.badges.map((b) => <Badge key={b} tone="accent">{VERIF_LABEL[b]}</Badge>)
        ) : (
          <Badge>unverified</Badge>
        )}
        <Badge tone="accent">{tier.band}</Badge>
        <span className="text-xs uppercase text-neutral-400">{tier.source === "peer" ? "peer-rated" : "self-rated"}</span>
      </div>
      {verify === "id" && (
        <p className="text-sm text-[var(--color-error)]">Verify your ID before hosting a paid game.</p>
      )}
      {payouts === "required" && (
        <p className="text-sm text-[var(--color-error)]">Set up payouts before hosting a paid game.</p>
      )}
      {identity === "done" && !idVerified && (
        <p className="text-sm text-neutral-500">Thanks — your verification is being reviewed. Your badge appears once Stripe confirms it.</p>
      )}
```

Add an "Identity" section (place it right after the closing `</div>` of the stats grid, before the Payouts block), gated on `identityEnabled()` — reuse `paymentsEnabled()` which is already imported and identical:
```tsx
      {paymentsEnabled() && !idVerified && (
        <div>
          <h2 className="text-xs uppercase text-neutral-500">Identity</h2>
          {identityPending ? (
            <p className="mt-2 text-sm text-neutral-500">Verification pending — we'll update your badge when it's confirmed.</p>
          ) : (
            <form className="mt-2">
              <button formAction={startIdentityVerificationAction}
                className="rounded-[var(--radius-pill)] bg-ink px-6 py-3 text-sm font-semibold uppercase text-accent">
                Verify your identity
              </button>
            </form>
          )}
        </div>
      )}
```

- [ ] **Step 4: Typecheck + build (keyless)**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS. With no Stripe key, the Identity + Payouts blocks don't render.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): Profile verification badges + verify/pending identity action"
```

---

### Task 5: web — game-detail host badge + host paid-create ID pre-check

**Files:**
- Modify: `apps/web/app/game/[id]/page.tsx`
- Modify: `apps/web/app/(tabs)/host/actions.ts`

**Interfaces:**
- Consumes: `verificationSummary` (Task 1); existing `game_detail` (`host_id`); `profiles.photo_verified/id_verified/phone_verified` (anon-readable); `create_game` gate (Task 2).

- [ ] **Step 1: Fetch + render the host verification badge in `game/[id]/page.tsx`**

Add to the import from core (it already imports `computeTier, meetsBand, ...`):
```tsx
import { computeTier, meetsBand, verificationSummary, googleDirectionsUrl, type SkillBand, type GameBand } from "@footylocal/core";
```

After `const hostTier = await tierFor(game.host_id);`, add:
```tsx
  const { data: hostVerif } = await supabase
    .from("profiles")
    .select("phone_verified, photo_verified, id_verified")
    .eq("id", game.host_id)
    .single();
  const hostBadges = verificationSummary({
    phone_verified: hostVerif?.phone_verified ?? false,
    photo_verified: hostVerif?.photo_verified ?? false,
    id_verified: hostVerif?.id_verified ?? false,
  }).badges;
  const HOST_VERIF_LABEL: Record<"phone" | "photo" | "id", string> = {
    phone: "Phone ✓", photo: "Photo ✓", id: "ID ✓",
  };
```

Update the host metadata line to append badges after the host tier:
```tsx
        <span className="flex flex-wrap items-center gap-2">
          host: {game.host_name ?? "—"} · <span className="uppercase">{hostTier.band}</span>
          {hostBadges.map((b) => <Badge key={b} tone="accent">{HOST_VERIF_LABEL[b]}</Badge>)}
        </span>
```
(Replaces the existing `<span>host: {game.host_name ?? "—"} · <span className="uppercase">{hostTier.band}</span></span>` line.)

- [ ] **Step 2: Add the paid-create ID pre-check in `host/actions.ts`**

Replace the existing paid block:
```tsx
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
with:
```tsx
  if (parsed.data.priceCents > 0) {
    const { data: pay } = await supabase
      .from("profiles")
      .select("stripe_charges_enabled, id_verified")
      .eq("id", user.id)
      .single();
    if (!pay?.id_verified) {
      redirect(`/profile?verify=id`);
    }
    if (!pay?.stripe_charges_enabled) {
      redirect(`/profile?payouts=required`);
    }
  }
```
(The DB `create_game` gate remains the authoritative guard; this is the friendly redirect.)

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): host verification badge on game detail + paid-create ID pre-check"
```

---

## Final Verification (Definition of Done)

- [ ] `pnpm typecheck` clean; `pnpm --filter @footylocal/core test` green (verificationSummary cases); `pnpm --filter @footylocal/web build` succeeds with **no** Stripe env vars.
- [ ] Migration 0016 applied: `stripe_identity_session_id` protected (client `select` returns no data); `mark_identity_verified` service-role-only + idempotent; `create_game` blocks paid creation by a non-ID-verified host (smoke-verified).
- [ ] Profile shows verification badges (phone/photo/id), a "Verify your identity" button (or "pending"), and the `verify=id`/`payouts=required`/`identity=done` notices — all hidden when Stripe is unconfigured.
- [ ] Game detail shows the host's verification badge next to their tier.
- [ ] Host paid-create redirects a non-ID-verified host to `/profile?verify=id`; the DB gate still blocks even if the redirect is bypassed.
- [ ] Webhook flips verification on `identity.verification_session.verified` (500-on-error) and clears the pending session on `requires_input`/`canceled`. No change to money capture/refund/settle; `join_game`/`join_paid` untouched.
- [ ] Mobile portability preserved: `verificationSummary` in `packages/core`, gate in DB, seam returns a hosted URL.

## Self-Review Notes (author)

- **Spec coverage:** seam §3.1 → T3; start action §3.2 → T4; webhook §3.3 → T3; DB §3.4 → T2; core §3.5 → T1; Profile/game-detail/host UI §3.6 → T4/T5. Mobile portability §2 → T1 (core) + T2 (DB) + T3 (hosted URL).
- **Never-trust-client:** the paid-host gate is in `create_game` (T2), smoke-tested by a direct RPC call; the app pre-check (T5) is only the friendly path.
- **Seam-gating:** every Stripe touchpoint is behind `getStripe()`/`paymentsEnabled()`; keyless build asserted in T3/T4/T5 and the final check.
- **Column protection:** `stripe_identity_session_id` is added but excluded from the 0013 column grants and explicitly revoked (T2); Profile reads it only via the service client (T4).
- **Migration idempotency:** `create_game` redefined (same signature, `returns uuid`) — no drop-first; `add column if not exists`; `mark_identity_verified` via `create or replace`. Replays cleanly.
- **Type consistency:** `VerificationFlags`/`VerificationBadge`/`VerificationLevel` from T1 used verbatim in T4/T5; badge label maps are `Record<"phone"|"photo"|"id", string>`.
- **Known follow-ups:** roster-member verification badges; native Stripe Identity SDK swap (Phase 4/mobile); re-verification/expiry; a live paid+identity runbook (needs Stripe keys + Identity enabled) alongside the existing payments runbook.
```
