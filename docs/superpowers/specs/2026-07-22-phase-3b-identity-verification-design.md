# FootyLocal — Phase 3b: Identity Verification (Design Spec)

**Date:** 2026-07-22
**Status:** Approved for planning
**Scope:** Phase 3b only. Share My Game + check-in/SOS (3c), the native Expo app (now pulled forward to run **right after 3b**), tournaments and Glicko-2 (Phase 4) are out of scope.

## 1. Goal

Let a player verify their identity (government ID + selfie) via **Stripe Identity**, surface **verification badges** (phone → photo → id) as a trust signal, and **require ID verification of any host who collects payment**. Seam-gated exactly like payments: the app builds and runs with **no Stripe keys** (verification UI hidden); it goes live when Stripe keys exist and Stripe Identity is enabled in the dashboard.

At the end of 3b:
- A player can start identity verification from **Profile**; on success their `photo_verified` + `id_verified` flip and their `verification_level` becomes `id`.
- **Profile** shows verification badges + a "Verify your identity" action (with a "pending" state while a session is in review).
- **Game detail** shows the host's verification badge next to their tier.
- Creating a **paid** game requires the host to be `id_verified` — enforced server-side in the DB, in addition to the existing Stripe Connect (`stripe_charges_enabled`) + $5 floor.

### Non-goals (later)
- Separate photo-only flow (the single Identity session's selfie satisfies "photo").
- Roster-member verification badges; a "require verified players to join" gate.
- Re-verification / expiry, manual review UI, document storage (Stripe holds the documents).
- Native Stripe Identity SDK (the hosted-URL redirect is used now; the native SDK is a Phase-4/mobile swap behind the same seam).

## 2. Constraints

Inherits all prior constraints (TS strict / no-any, RLS on every table, never-trust-client authorization, seam-gated Stripe, Nike design tokens). Plus:

- **Reuse the existing Stripe seam and key.** Stripe Identity uses the same `STRIPE_SECRET_KEY`; `identityEnabled()` is `paymentsEnabled()`. No new env var. No second webhook endpoint — extend `/api/stripe/webhook`.
- **Verification logic is pure and unit-tested in `packages/core`** (`verificationSummary`) so web and the forthcoming native app render identical badges from one definition.
- **The paid-host ID gate is enforced in the DB** (`create_game`), not only in the web action — it must protect any client (web or native) identically.
- **`stripe_identity_session_id` is a protected column** (REVOKE from anon/authenticated, GRANT to nothing client-side), mirroring `stripe_account_id`'s protection (0013). It is a Stripe-internal id and never reaches a client.
- **Mobile portability** (the native app is next): every new capability is either shared core logic, a DB gate, or a seam that returns a hosted URL — no web-only assumption. See §3.6.

## 3. Architecture

### 3.1 Seam (`apps/web/lib/stripe/index.ts`)
- `identityEnabled()` → returns `paymentsEnabled()` (same key gates both). UI uses it to show/hide verification.
- `createIdentityVerificationSession({ userId, returnUrl }): Promise<{ url: string; sessionId: string }>` — behind `getStripe()`:
  - `getStripe().identity.verificationSessions.create({ type: "document", options: { document: { require_matching_selfie: true } }, metadata: { user_id: userId }, return_url: returnUrl })`.
  - Returns the hosted `url` (redirect target) and the session `id` (persisted so the UI can show "pending" and the webhook path is auditable).
- Throws via `getStripe()` if Stripe is unconfigured — callers are already gated on `identityEnabled()`.

### 3.2 Start action (`apps/web/app/(tabs)/profile/identity-actions.ts`)
- `startIdentityVerificationAction()` — mirrors `startOnboardingAction`:
  - Gate on `identityEnabled()`; require an authenticated user.
  - Call the seam; persist `stripe_identity_session_id` on the profile via the **service-role** client (the column is client-protected).
  - `redirect(url)` to Stripe's hosted flow. `return_url` = `${SITE_URL}/profile?identity=done`.

### 3.3 Webhook (extend `apps/web/app/api/stripe/webhook/route.ts`)
- Add an `else if (event.type === "identity.verification_session.verified")` branch:
  - `const userId = session.metadata?.user_id` → call `supabase.rpc("mark_identity_verified", { p_user_id: userId })` (service-role client, as already constructed).
  - On RPC error return **500** so Stripe retries (same discipline as the paid-join branch); success falls through to `{ received: true }`.
- Add an `else if (event.type === "identity.verification_session.requires_input" || ... === "canceled")` branch that clears `stripe_identity_session_id` for the session's `metadata.user_id` (so the UI drops "pending" and the user can retry). Non-fatal: log-and-continue is acceptable, but a failed clear should not 500 the verified path.
- No change to the money-path branches (`account.updated`, `checkout.session.completed`).

### 3.4 DB (migration `0016_identity.sql`)
- `alter table profiles add column if not exists stripe_identity_session_id text;`
- **Column protection** (mirror 0013): `revoke ... (stripe_identity_session_id) ... from anon, authenticated;` so it's never client-readable.
- `mark_identity_verified(p_user_id uuid) returns void` — `security definer`, `set search_path = public`, **granted to `service_role` only** (revoke from public/anon/authenticated), like `create_game`. Body:
  ```sql
  update profiles
     set photo_verified = true,
         id_verified = true,
         verification_level = 'id',
         updated_at = now()
   where id = p_user_id;
  ```
- **Paid-host ID gate in `create_game`** (body-only change; return type stays `uuid`, so `create or replace` with no drop-first): after the venue check, when `p_price_cents > 0`, require the host to be ID-verified:
  ```sql
  if p_price_cents > 0 then
    if not exists (select 1 from profiles where id = p_host_id and id_verified = true) then
      raise exception 'host must be ID-verified to collect payment';
    end if;
  end if;
  ```
  This is the authoritative guard (defense-in-depth behind the app-layer pre-check). The existing `stripe_charges_enabled` + $5-floor checks (app layer) are unchanged.
- Drizzle schema parity: add `stripeIdentitySessionId: text("stripe_identity_session_id")` to `profiles` in `packages/db/src/schema/index.ts` (no functional effect; SQL owns the column + protection).

### 3.5 Core (`packages/core/src/verification/index.ts`, pure + tested)
- `type VerificationFlags = { phone_verified: boolean; photo_verified: boolean; id_verified: boolean };`
- `type VerificationLevel = "none" | "phone" | "photo" | "id";`
- `verificationSummary(flags: VerificationFlags): { level: VerificationLevel; badges: Array<"phone" | "photo" | "id"> }`:
  - `badges` = the subset of `["phone","photo","id"]` whose flag is true, in that order.
  - `level` = the highest true flag by the order `id > photo > phone`, else `"none"`.
- Tested: none → `{ level: "none", badges: [] }`; phone-only; phone+photo+id → `{ level: "id", badges: ["phone","photo","id"] }`; id-without-photo edge (id true, photo false) → level `id`, badges `["id"]`.

### 3.6 UI (within design tokens)
- **Profile (`/profile`)**:
  - Fetch `photo_verified, id_verified` alongside the existing `phone_verified` select; compute `verificationSummary`. Render the badge row (reuse the `Badge` primitive; e.g. `Phone ✓`, `Photo ✓`, `ID ✓`).
  - When `identityEnabled()` and **not** `id_verified`: a **"Verify your identity"** button (`startIdentityVerificationAction`). When a `stripe_identity_session_id` is set but not yet verified (read via service-role, like payouts): show **"Verification pending"** instead of the button. On `?identity=done` return, the page simply re-reads status (the webhook is the source of truth; verification may still be pending — copy says so). Hidden entirely when Stripe is unconfigured.
- **Game detail (`/game/[id]`)**: fetch the host's `photo_verified, id_verified` (phone too if cheap) and render the host's verification badge next to the existing host tier. Reputation signal only; no gating here.
- **Host / create-game**: extend the paid pre-check in `host/actions.ts` — when `priceCents > 0` and the host is not `id_verified`, `redirect("/profile?verify=id")` with a clear notice (parallel to the existing `payouts=required` redirect). The DB `create_game` gate is the real guard; this is the friendly path.

## 4. Data Model

- `profiles.stripe_identity_session_id text` (new, protected). Reuses existing `photo_verified`, `id_verified`, `verification_level` (Phase 0). No other tables.

## 5. Shared Logic (`packages/core`)

`packages/core/src/verification/index.ts`: `verificationSummary`, `VerificationFlags`, `VerificationLevel`. Exported from the package index. Pure — no Stripe, no DB — so the native app reuses it verbatim.

## 6. Seam / Money Safety

- Identity is **read-only w.r.t. money**: it sets verification flags; it never moves funds. The paid-host gate only *adds* a precondition to creating a paid game; it does not alter capture/refund/settle.
- Webhook stays signature-verified and idempotent-friendly: `mark_identity_verified` is a straight idempotent UPDATE (re-delivery just re-sets the same flags).

## 7. Testing

- **`packages/core`**: `verificationSummary` cases (§3.5).
- **Live/manual (runbook, keys required)**: enable Stripe Identity in test mode; start verification from Profile → complete Stripe's test flow → webhook flips `photo_verified`/`id_verified`/`verification_level=id`; badges appear. Attempt to create a paid game as a non-ID-verified host → blocked by `create_game` (verified by direct RPC call) and redirected by the app pre-check; after verifying, paid create succeeds. Keyless: verification UI absent, `next build` + typecheck pass.
- **Column protection**: a client `select stripe_identity_session_id` returns no data (mirror the `stripe_account_id` check).

## 8. Definition of Done

- [ ] `verificationSummary` computes level + ordered badges; tested (all cases in §3.5).
- [ ] Migration 0016: protected `stripe_identity_session_id`; `mark_identity_verified` (service-role-only, definer); `create_game` blocks paid creation by a non-ID-verified host; Drizzle parity column added.
- [ ] Seam `createIdentityVerificationSession` + `identityEnabled`; `startIdentityVerificationAction` persists the session id (service-role) and redirects to Stripe's hosted flow.
- [ ] Webhook flips verification on `identity.verification_session.verified` (500-on-error retry) and clears the pending session on `requires_input`/`canceled`.
- [ ] Profile: badges + "Verify your identity" / "pending" (Stripe-gated). Game detail: host verification badge. Host: paid create pre-check redirect for non-ID-verified hosts.
- [ ] Keyless: `next build` + `pnpm typecheck` pass, verification UI hidden. `packages/core` tests green.
- [ ] No change to money capture/refund/settle; `join_game`/`join_paid` untouched.
- [ ] Mobile portability preserved: new logic in `packages/core`, gate in DB, seam returns a hosted URL (§3.6).
