# FootyLocal — Phase 2b: Confirmation, Capture, Refunds & Waitlists (Design Spec)

**Date:** 2026-07-21
**Status:** Approved for planning
**Scope:** Phase 2b. Automatic expiry of unconfirmed games (needs a scheduler), no-show tracking, and notifications are **2c / later** and out of scope.

## 1. Goal

Complete the money/roster lifecycle on top of Phase 2a's holds: a game **confirms** and its holds are **captured** when `min_players_to_confirm` is met; a host can **cancel** (voiding holds / refunding captures); a player can **leave** with a 24h refund deadline; a full game accepts **waitlisted** joins (paid = hold placed) that are **promoted** (and captured, if the game is confirmed) when a spot opens.

At the end of 2b:
- When joined count reaches `min_players_to_confirm`, the game becomes `confirmed`; paid holds are captured (`paid=true`). Free games just confirm.
- A host can cancel a game: holds are voided, captured payments are refunded (application fee reversed). Host-cancel always refunds everyone.
- Leaving voids a hold, or refunds a captured payment only if leaving > 24h before start (else forfeit); leaving a joined spot promotes the earliest waitlisted player.
- Joining a full game waitlists you (paid: hold placed); promotion flips you to joined and captures your hold if the game is already confirmed.
- All Stripe operations remain seam-gated; the app builds/runs with no Stripe keys.

### Non-goals (2c / later)
Automatic expiry/void of unconfirmed games at start time; no-show tracking; notifications (including "spot opened"); re-opening a confirmed game that drops below min (promotion refills instead).

## 2. Constraints

Inherits all prior constraints (TS strict/no-any, RLS, seam-gated payments that build/run with no keys, design tokens). Plus:

- **Money correctness:** every capture/void/refund is idempotent-safe and driven by DB state; Stripe ops run in the app layer (SQL returns the PaymentIntent lists to act on). A player is captured at most once (`paid=false → true`, guarded). Refunds reverse the application fee (`refund_application_fee: true`) so the platform doesn't keep fees on cancelled games.
- **Race safety:** confirmation, cancellation, leave, and waitlist promotion all take a `FOR UPDATE` lock on the game row so concurrent joins/leaves can't double-confirm, double-promote, or oversell.
- A player leaves/cancels only as themselves; only the host cancels a game (`auth.uid()` checks).
- The 24h refund deadline is computed from `starts_at`; the boundary rule lives in `packages/core` (pure + tested).

## 3. Architecture

### 3.1 State machine
- `games.status`: `open → confirmed` (one-way, when min met) or `open → cancelled` (host). A confirmed game stays confirmed.
- `game_players`: `status ∈ joined | waitlisted | cancelled`; `paid=false`+`payment_intent_id` = **hold**; `paid=true` = **captured**. Only `joined` rows count toward capacity + confirmation.

### 3.2 RPCs (migration 0014), and who calls them
- **`join_game(uuid)`** (authenticated, updated): phone-verified + open + not-already-active; if `joined_count < max` → insert `joined` (returns `'joined'`), else → insert `waitlisted` (returns `'waitlisted'`). No longer raises "full".
- **`join_paid(uuid,uuid,text)`** (service_role, updated): same waitlist branch; returns `'joined' | 'waitlisted' | 'closed' | 'dup'` (never `'full'`). The webhook keeps the hold on `'joined'` and `'waitlisted'`, cancels only on `'closed'` (and still not on `'dup'`).
- **`try_confirm_game(uuid)`** (service_role, new): `FOR UPDATE`; if `status='open'` and `joined_count >= min_players_to_confirm`, set `status='confirmed'` and return the `payment_intent_id`s of `joined` rows with `paid=false` (holds to capture). Otherwise returns nothing.
- **`mark_captured(text)`** (service_role, new): set `paid=true` where `payment_intent_id = $1 and paid=false` (idempotent).
- **`cancel_game(uuid)`** (authenticated, new): require `auth.uid() = host_id`; `FOR UPDATE`; set `status='cancelled'`; set all `joined|waitlisted` rows to `cancelled`; return each `(payment_intent_id, paid)` so the app can void/refund.
- **`leave_game(uuid)`** (authenticated, updated): keep the host-can't-leave guard; set the caller's row `cancelled`; return `(payment_intent_id, paid, starts_at, was_joined)` (`was_joined` = the row was `joined`, so a spot opened).
- **`promote_waitlist(uuid)`** (service_role, new): `FOR UPDATE`; if a `joined` spot is available and a `waitlisted` row exists, promote the earliest (by `joined_at`) to `joined`; return its `(payment_intent_id, game_confirmed)` (so the app captures the hold if the game is already `confirmed`). Otherwise returns nothing.

### 3.3 App-layer settle helpers (`apps/web/lib/payments/settle.ts`, server-only)
- `settleConfirmation(gameId)`: `try_confirm_game` → for each returned PI, `capturePaymentIntent` (seam) → `mark_captured`. No-op when nothing to capture (free games return no PIs). Called after a `'joined'` result from `joinAction` (free) and the webhook (paid).
- `settleCancellation(rows)`: for each `(payment_intent_id, paid)`: `paid` → `refundPaymentIntent` (app fee reversed); else `cancelPaymentIntent` (void). Called by the host cancel action.
- `settleLeave(row)`: void hold / refund-if->24h-else-forfeit; then `promote_waitlist` → capture the promoted hold if the game is confirmed. Called by `leaveAction`.
- All guard on `paymentsEnabled()` and only touch Stripe when there's a PI to act on, so free games and no-keys builds never call Stripe.

### 3.4 Seam additions (`apps/web/lib/stripe`)
- `capturePaymentIntent(id)`: `paymentIntents.capture(id)`.
- `refundPaymentIntent(id)`: `refunds.create({ payment_intent: id, refund_application_fee: true })`.
- `cancelPaymentIntent(id)` (void) already exists.

## 4. The Four Flows

1. **Confirm + capture:** join → (`joined`) → `settleConfirmation` → if min met, confirm + capture holds (`paid=true`). Free: confirm only.
2. **Cancel (host):** Cancel game → `cancel_game` (host-gated) → `settleCancellation` voids holds + refunds captures (fee reversed) → status `cancelled`.
3. **Leave (24h):** Leave → `leave_game` → `settleLeave`: void hold, or refund only if > 24h before start, else forfeit; then promote a waitlisted player (capture their hold if confirmed).
4. **Waitlist + promote:** join-when-full → `waitlisted` (paid: hold placed); a freed joined spot promotes the earliest waitlisted → `joined` (+ capture if confirmed).

## 5. Data Model

No new tables. Migration `0014_confirm_refund_waitlist.sql` adds/updates the RPCs in §3.2. `game_players.status` (`waitlisted`) and `paid`/`payment_intent_id` already exist (Phase 0/2a). `games.status` (`confirmed`,`cancelled`) already in the enum.

## 6. Shared Logic (`packages/core`)

`packages/core/src/payments/index.ts` additions (pure, tested):
- `REFUND_DEADLINE_HOURS = 24`.
- `isRefundableLeave(startsAt: Date, now: Date): boolean` = `(startsAt.getTime() - now.getTime()) > REFUND_DEADLINE_HOURS * 3600_000`.

## 7. UI (within design tokens)

- **Game detail (`/game/[id]`)**: show status (`open` needs "N of M to confirm" / `confirmed` badge / `cancelled` notice); when spots are full, the Join button reads **"Join waitlist"** (paid: "Join waitlist · $X"); waitlisted viewers see a "You're on the waitlist" state; a cancelled game hides Join. The **host** sees a **"Cancel game"** button (confirms) → `cancelGameAction`.
- **My Games**: a small `confirmed`/`waitlisted`/`cancelled` tag per game (from `my_games` — add a `status` column).
- Copy is explicit about the 24h refund rule near Leave for paid games.

## 8. Testing

- `packages/core`: `isRefundableLeave` (just over / just under 24h; exact boundary).
- **DB state-machine live smoke (no Stripe needed):** create a small game (`min_players_to_confirm=2`, `max_players=2`); two users join → status `confirmed`; a third joins → `waitlisted`; one joined user leaves → the waitlisted user is promoted to `joined`; host cancels → status `cancelled` + rows cancelled. Verifies the confirm/waitlist/promote/cancel transitions and the returned PI lists' shape. (Free game → no PIs; the smoke asserts transitions + empty PI lists.)
- **Money runbook (deferred until Stripe keys):** with test keys, a paid game's holds capture on confirmation; host-cancel refunds; leave > 24h refunds, < 24h forfeits; a promoted waitlister's hold captures when the game is confirmed.
- Build/typecheck pass with no Stripe env.

## 9. Definition of Done

- [ ] `try_confirm_game` confirms at min + returns held PIs; `settleConfirmation` captures them + `mark_captured` (idempotent); free games confirm with no capture. (DB transition smoke-verified; capture is runbook.)
- [ ] `cancel_game` is host-only, cancels the game + rows, returns the PI list; `settleCancellation` voids holds + refunds captures (app fee reversed).
- [ ] `leave_game` returns leaver PI info; `settleLeave` voids/refunds per the 24h rule; leaving a joined spot promotes the earliest waitlisted player (+ captures if confirmed).
- [ ] Joining a full game waitlists (paid: hold placed, not cancelled by the webhook); `promote_waitlist` promotes on a freed spot.
- [ ] `isRefundableLeave` tested; confirmation/cancel/leave/promote are race-safe (`FOR UPDATE`).
- [ ] Game detail shows status + confirmation progress + waitlist state + host Cancel; My Games shows status.
- [ ] `packages/core` tests pass; typecheck clean; `next build` succeeds with no Stripe env.
