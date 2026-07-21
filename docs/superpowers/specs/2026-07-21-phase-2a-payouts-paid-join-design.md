# FootyLocal — Phase 2a: Host Payouts + Paid Join (Design Spec)

**Date:** 2026-07-21
**Status:** Approved for planning
**Scope:** Phase 2a only. Capture-on-confirmation, refunds, waitlists (2b), no-show + notifications (2c), and later phases are out of scope and referenced only where they constrain 2a.

## 1. Goal

Enable **paid** games: a host onboards for payouts via Stripe Connect Express, creating a paid game requires that onboarding, and joining a paid game places an **authorization hold** (manual-capture PaymentIntent) via Stripe Checkout — no money moves until the game confirms (that capture is 2b). Everything runs in **Stripe test mode**, and the payment code is **seam-gated** so the app runs normally without Stripe keys.

At the end of 2a:
- A host can start Stripe Connect Express onboarding from Profile; `profiles.stripe_charges_enabled` reflects Stripe's status (via the `account.updated` webhook).
- Creating a game with `price_cents > 0` requires the host to have `stripe_charges_enabled`; `price_cents` must be `0` or `≥ 500` ($5 floor).
- Joining a paid game redirects to Stripe Checkout (destination charge + 10% application fee, **manual capture**); on completion, a webhook adds the player to the roster with the held `payment_intent_id` (`paid=false`), or cancels the hold if the game filled first.
- With no Stripe keys, paid features are hidden and the free-game flow is unchanged.

### Non-goals (2b / later)
Capturing the holds on confirmation; refunds/void on cancellation; waitlists; no-show tracking; notifications; ID verification for paying hosts (Phase 3; Express onboarding already does baseline KYC); inline card Elements (we use hosted Checkout).

## 2. Constraints

Inherits all prior constraints (TS strict/no-any, RLS, no precise/roster leakage, design tokens, anonymity). Plus:

- **Payments are seam-gated:** all Stripe SDK calls live behind a server-only seam that throws a clear "payments not configured" error when `STRIPE_SECRET_KEY` is unset. The UI gates paid features on a `paymentsEnabled()` check. The app must build and run with no Stripe env.
- **Money correctness:** fee math is pure + unit-tested in `packages/core`. Capacity for paid joins is enforced **server-side and race-safe** at webhook time (row lock); an over-capacity paid join has its hold **canceled**, never captured.
- **Never trust the client for amounts:** the Checkout amount, destination, and application fee are computed server-side from the game's `price_cents` + host account; the client only initiates.
- Webhook requests are signature-verified (`STRIPE_WEBHOOK_SECRET`).

## 3. Architecture Decisions

### 3.1 Fee math in `packages/core/payments` (pure, tested)

- `PLATFORM_FEE_BPS = 1000` (10%), `PRICE_FLOOR_CENTS = 500` ($5).
- `platformFeeCents(priceCents): number` = `round(priceCents * PLATFORM_FEE_BPS / 10000)`.
- `isValidPriceCents(priceCents): boolean` = `priceCents === 0 || priceCents >= PRICE_FLOOR_CENTS`.
- `gameCreateSchema` gains a refinement: `priceCents` is `0` or `≥ 500`.

### 3.2 Server-only Stripe seam (`apps/web/lib/stripe`)

A server-only module (`import "server-only"` is safe here — web-only, not imported by the tsx seed):
- `paymentsEnabled(): boolean` = `!!process.env.STRIPE_SECRET_KEY`.
- `getStripe(): Stripe` — lazily constructs the SDK client; throws `"payments not configured"` if the key is missing.
- `createConnectAccount(email): Promise<string>` — `accounts.create({ type: 'express', ... })`, returns account id.
- `createAccountLink(accountId, returnUrl, refreshUrl): Promise<string>` — hosted onboarding URL.
- `retrieveChargesEnabled(accountId): Promise<boolean>` — `accounts.retrieve(...).charges_enabled`.
- `createPaidJoinCheckout({ gameId, playerId, priceCents, hostAccountId, successUrl, cancelUrl }): Promise<string>` — a Checkout Session, `mode: 'payment'`, one line item at `priceCents`, `payment_intent_data: { capture_method: 'manual', transfer_data: { destination: hostAccountId }, application_fee_amount: platformFeeCents(priceCents) }`, `metadata: { game_id, player_id }`; returns the session URL.
- `cancelPaymentIntent(id)`: void the hold (used when a paid join loses the capacity race).

### 3.3 Onboarding flow

- **Profile → "Set up payouts"** (shown only when `paymentsEnabled()`): `startOnboardingAction` → if the profile has no `stripe_account_id`, `createConnectAccount` and store it → `createAccountLink` → redirect to Stripe. Return URL is `/profile?onboarding=done` (which re-checks status); refresh URL restarts the link.
- **Webhook `account.updated`** → set `profiles.stripe_charges_enabled = account.charges_enabled` by `stripe_account_id` (service client). The Profile page can also do an on-demand `retrieveChargesEnabled` fallback on the return visit.

### 3.4 Paid game gating

- `gameCreateSchema` enforces the price floor (§3.1).
- `hostGameAction`: if `priceCents > 0`, require the host's `stripe_charges_enabled`; otherwise redirect to Profile with a "set up payouts first" message. Free games ($0) are unaffected.

### 3.5 Paid join via hosted Checkout + webhook + `join_paid` RPC

- **Game detail Join** on a paid game (when `paymentsEnabled`): `joinPaidAction` → validates (game open, phone-verified, not already joined, spots remaining, host onboarded), then `createPaidJoinCheckout(...)` and redirects to Stripe.
- **Webhook `checkout.session.completed`**: read `metadata.game_id/player_id` + the session's `payment_intent`; call the `join_paid` RPC (service-role) which — with a `FOR UPDATE` lock on the game row — re-checks open + capacity + not-already-joined and inserts the roster row (`status='joined'`, `role='player'`, `payment_intent_id`, `paid=false`). If it returns "full"/"closed"/"dup", the webhook **cancels the PaymentIntent** (releases the hold). This keeps paid capacity race-safe and never leaves a hold on a non-joined player.
- Free joins keep the existing `join_game` RPC unchanged.

## 4. Data Model Changes

- **Drizzle migration**: `profiles.stripe_account_id text` (nullable), `profiles.stripe_charges_enabled boolean not null default false`.
- **SQL migration `0012_join_paid.sql`**: `join_paid(p_game_id uuid, p_player_id uuid, p_payment_intent_id text)` — `SECURITY DEFINER`, granted **service_role only** (called by the webhook), mirrors `join_game`'s row-locked capacity/dup/open checks, inserts the roster row with the PI id + `paid=false`, returns `'joined'` or a reason string (`'full'|'closed'|'dup'`) so the webhook can cancel the hold. `game_players.payment_intent_id`/`paid` columns already exist (Phase 0).
- RLS unchanged. The webhook uses the service client (bypasses RLS).

## 5. Shared Logic (`packages/core`)

`packages/core/src/payments/index.ts`: `PLATFORM_FEE_BPS`, `PRICE_FLOOR_CENTS`, `platformFeeCents`, `isValidPriceCents` (+ tests). `gameCreateSchema` refinement (§3.1).

## 6. UI (within design tokens)

- **Profile**: a "Payouts" section (only when `paymentsEnabled()`): if not onboarded → "Set up payouts" button (`startOnboardingAction`); if `stripe_charges_enabled` → a "Payouts active" badge.
- **Host form**: the price field notes "$5 minimum for paid games; free games are $0"; if the host isn't onboarded and enters a price, they're routed to set up payouts.
- **Game detail Join**: for a paid game, the Join button reads "Join · $X" and routes through Checkout; free games join instantly as today. A returning `?paid=success`/`?paid=cancel` state shows a short confirmation/notice. Paid features are hidden entirely when `!paymentsEnabled()`.

## 7. Environment

`.env.example` gains: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_SITE_URL` (for Checkout success/cancel URLs; defaults to `http://localhost:3000`). README documents: creating a Stripe account, enabling **Connect** (test mode), getting test keys, and running `stripe listen --forward-to localhost:3000/api/stripe/webhook` to get the webhook secret for local dev.

## 8. Testing

- `packages/core`: `platformFeeCents` (10% rounding), `isValidPriceCents` (0 ok, 1–499 invalid, ≥500 ok), and `gameCreateSchema` price-floor rejection.
- Build/typecheck must pass with **no Stripe env** (seam inert; paid UI hidden).
- **Live smoke (deferred until keys):** onboard a test host (Stripe test onboarding), create a $5 game, join as a second user, pay with test card `4242 4242 4242 4242` → webhook adds the roster row with a `requires_capture` PaymentIntent (hold), `paid=false`; the over-capacity case cancels the hold. Documented as a runbook; not run until keys + `stripe listen` are set up.

## 9. Definition of Done

- [ ] `packages/core/payments` fee math + price-floor validation, tested; `gameCreateSchema` rejects paid prices `1–499`.
- [ ] App builds/typechecks and runs with **no Stripe env**; paid features are hidden, free games unchanged.
- [ ] With keys (runbook): host onboarding via Connect Express sets `stripe_charges_enabled` (webhook `account.updated`); creating a paid game requires it.
- [ ] Paid join goes through hosted Checkout with a **manual-capture destination charge + 10% application fee**; the `checkout.session.completed` webhook adds the roster row with the held `payment_intent_id` (`paid=false`), race-safe via `join_paid`; an over-capacity paid join has its hold canceled.
- [ ] Webhook signature is verified; the Stripe seam throws clearly when unconfigured and is never bundled to the client.
- [ ] `.env.example` + README document the Stripe/Connect/`stripe listen` setup.
