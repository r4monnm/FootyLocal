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
