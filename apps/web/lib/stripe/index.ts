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

export async function capturePaymentIntent(id: string): Promise<void> {
  try {
    await getStripe().paymentIntents.capture(id);
  } catch (e) {
    // Concurrent settle triggers (two paid-join webhooks) can both try to
    // capture the same hold. Treat an already-captured PI as success so the
    // capture path is idempotent and doesn't strand other holds via a 500.
    const code = (e as { code?: string; message?: string });
    const msg = (code.message ?? "").toLowerCase();
    if (code.code === "payment_intent_unexpected_state" || msg.includes("already been captured")) {
      return;
    }
    throw e;
  }
}

export async function refundPaymentIntent(id: string): Promise<void> {
  // Destination charge: reverse_transfer claws back the host's transferred funds,
  // and refund_application_fee returns the platform fee — so a full refund/cancel
  // doesn't leave the host paid or the platform out of pocket.
  await getStripe().refunds.create({
    payment_intent: id,
    reverse_transfer: true,
    refund_application_fee: true,
  });
}

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
