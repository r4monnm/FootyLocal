import { type NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createServiceClient } from "@footylocal/db";
import { getStripe, cancelPaymentIntent } from "@/lib/stripe";
import { settleConfirmation } from "@/lib/payments/settle";

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
    const { error } = await supabase
      .from("profiles")
      .update({ stripe_charges_enabled: account.charges_enabled ?? false })
      .eq("stripe_account_id", account.id);
    if (error) {
      return NextResponse.json({ error: "update failed" }, { status: 500 });
    }
  } else if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const gameId = session.metadata?.game_id;
    const playerId = session.metadata?.player_id;
    const paymentIntent =
      typeof session.payment_intent === "string" ? session.payment_intent : null;
    if (gameId && playerId && paymentIntent) {
      const { data, error } = await supabase.rpc("join_paid", {
        p_game_id: gameId,
        p_player_id: playerId,
        p_payment_intent_id: paymentIntent,
      });
      // A transient failure must not cancel the hold — return 500 so Stripe retries.
      if (error) {
        return NextResponse.json({ error: "join failed" }, { status: 500 });
      }
      if (data === "closed") {
        await cancelPaymentIntent(paymentIntent);
      } else if (data === "joined") {
        await settleConfirmation(gameId);
      }
      // 'waitlisted' / 'dup' → keep the hold, nothing to settle.
    }
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
  }

  return NextResponse.json({ received: true });
}
