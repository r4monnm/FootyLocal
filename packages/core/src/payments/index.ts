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

/** Hours before start after which leaving a captured paid game forfeits (no refund). */
export const REFUND_DEADLINE_HOURS = 24;

/** Whether a leaver gets a refund: only if leaving strictly more than the
 * deadline before the game starts. */
export function isRefundableLeave(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() - now.getTime() > REFUND_DEADLINE_HOURS * 3600_000;
}
