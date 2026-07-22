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
