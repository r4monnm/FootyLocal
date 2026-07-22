# Phase 0 — Deferred Follow-ups

Non-blocking items surfaced during Phase 0 reviews, to address in later phases.

## Security / privacy (do before the relevant feature ships)
- **Column-protect `profiles.hidden_mmr`/`mmr_rd`/`mmr_volatility`/`karma`/`no_shows`.**
  The `profiles` SELECT RLS policy is currently world-readable (matches Phase 0
  intent; no data yet). Restrict these columns (column grants or a public view)
  before the Glicko-2 rating system lands. (spec § skill v3)
- **Wire `blocks` into `games_near` and roster reads.** Spec §4 requires blocked
  users never see each other's games/chats. The `blocks` table exists but is not
  consulted yet. Add to the RPC + read policies in Phase 1.
- ~~**Harden auth error messaging.**~~ DONE (2026-07-21): `friendlyAuthError()`
  in `packages/core` maps raw Supabase auth errors to safe copy; the auth
  actions no longer echo raw `error.message`. The 18+ gate now shows a clear
  message instead of "Invalid literal value, expected true".
- **Verified-venue check on `tournaments.venue_id`.** `games` enforces it via RLS
  `with check`; tournaments (Phase-4 stub) do not yet.

## Robustness
- **PostGIS search_path.** `games_near`/`set_venue_location`/`handle_new_user` set
  `search_path = public`. If a deploy ever installs PostGIS into an `extensions`
  schema, use `search_path = public, extensions` so `ST_*` resolves.
- **Turbopack.** `apps/web/next.config.ts` uses a webpack `extensionAlias` to
  resolve the `.js`→`.ts` specifiers in `@footylocal/core`/`ui`. It no-ops under
  `--turbopack`; add equivalent config (or a package build step) if Turbopack
  build is adopted.
- **Geo property tests.** `packages/core/src/geo/geo.test.ts` uses a single
  coordinate fixture. Safety bounds hold by construction today; add property-based
  tests (varied lat/lng/gameId) so a future constant change can't silently break
  the fuzz-band or circle-offset guarantees.

## Design polish
- Active-tab styling colors only the dot with the accent; label stays ink. Revisit
  against "active tab highlighted in the accent color."
- `apps/web` uses Tailwind default grays (`neutral-300/400/600`) in a few places
  instead of the `ui` token gray. Consolidate onto tokens.

---

# Phase 1a — Deferred Follow-ups

Non-blocking items from Phase 1a reviews (final review verdict: ready to merge, no
Critical/Important). Prioritize the service-key guard.

## Security / robustness
- **`server-only` guard on `packages/db/src/games.ts` (do soon).** It imports the
  service-role client; today it's reached only via the `"use server"` host action
  (build-verified no client leak), but only a comment protects it. CAVEAT: a plain
  `import "server-only"` breaks `seed:games` (same module runs under `tsx`/Node,
  where `server-only` throws). Options: split the create logic so the seed path
  doesn't import the guarded module, or gate the guard behind a bundler-only entry.
- **Generate Supabase `Database` types.** The client has no `Database` generic, so
  `.rpc()/.from()` results are implicitly `any` and the `data as NearbyGame[]` casts
  are unchecked. Do before Phase 1b so RPC/column drift is type-caught.
- **Migration idempotency guards** match constraints on `conname` alone (not
  `conname + conrelid`) — theoretical collision only.

## Correctness / polish
- **`games_near` rebuilt in both 0003 and 0007** on every replay (0007 is the source
  of truth). Wasteful, converges correctly. Add a dev-docs note.
- **Host error mapping:** `createGame` DB errors (e.g. "venue not verified") are run
  through `friendlyAuthError` (auth-oriented) → collapse to generic. Add a
  game-specific error mapper for actionable host feedback.
- **DiscoverMap:** map doesn't recenter to the geolocated position when there are 0
  nearby games (list is correct); uses the deprecated `google.maps.Marker` (consider
  `AdvancedMarkerElement`); marker re-plot effect returns no cleanup (harmless).
- **Host form field coercion:** `String(formData.get())` yields `"null"` for missing
  fields (mitigated by `required` + Zod + the DB verified-venue re-check).
- **`NearbyGame.joined_count`** typed `number` but the RPC column is `bigint`
  (consumers wrap in `Number()`; type is really `number | string`).

## Deferred to Phase 2 / 3 (by design)
- Waitlist-when-full, refund deadlines, no-show tracking, payments (Phase 2).
- Rich skill tiers from peer ratings + karma-driven join-gating; photo/ID verify;
  Share My Game; check-in/SOS (Phase 3). Message/chat block-invisibility (Phase 4).

---

# Phase 1c — Deferred Follow-ups

Final review verdict: ready to merge after the anonymity + skill-validation fixes
(done, migration 0011, commit 85b8223). Remaining items are non-blocking.

## Polish
- **`blockAction` redirect:** after blocking the HOST it redirects to `/game/[id]`,
  which is now hidden → "Game not found". Spec §6 wanted `/discover`. Redirect to
  Discover when the block target is the host (or unconditionally).
- **`submit_rating` `is_host_rating`** is caller-supplied, not derived from
  `games.host_id`. Unused in 1c; when tiering consumes it (Phase 3), derive it
  server-side (`p_ratee_id = games.host_id`).
- **`my_games` past list** orders oldest-first; most-recent-first reads better.
- **Block-a-roster-player button** on game detail has no visible effect (block
  invisibility is host-level per the 1c non-goal); add a tooltip or reconsider.

---

# Phase 1b — Deferred Follow-ups

Final review verdict: ready to merge with the roster-read fix (done, commit 7d5f443).
Remaining items are non-blocking.

## Security / robustness
- **`game_detail` has no status filter** — being SECURITY DEFINER it bypasses
  `games_read_open` and returns any game's public metadata (title/venue/host/public
  area) by id regardless of status. Low impact (no draft-creation path;
  public_location is fuzzed; page shows "not open"). Add a
  `status in ('open','confirmed','completed')` guard for defense-in-depth.
- **`join_game` already-joined guard checks only `status='joined'`** — a
  `waitlisted/no_show/attended` row could fall through the `on conflict` to
  `joined`. No such write paths exist until Phase 2 waitlist/attendance; revisit then.
- **`game_detail` inner-joins `profiles`/`venues`** — a game silently vanishes if
  the host profile or venue row were missing (both FK-backed + always present today).
  A `left join` is more robust.

## Polish
- **`Detail.joined_count` typed `number`** but Postgres `bigint` arrives as a JSON
  string (consumers coerce with `Number()`; annotation should be `number | string`).
- **Reflected `?error=` param** rendered verbatim on `/game/[id]` (React-escaped, not
  XSS); optionally validate against the known friendly-copy set.
- Deprecated `google.maps.Marker` used in the reveal mini-map (matches DiscoverMap;
  modernize to `AdvancedMarkerElement` together).

---

# Phase 2a — Deferred Follow-ups

Final review: ready to merge after the webhook-idempotency + stripe-column fixes
(done, commit 6b9ce79). Remaining items non-blocking.

## Robustness (before keys go live / in 2b)
- **Webhook idempotency table.** The join case is handled (dup → don't cancel), but a
  `stripe_events(id primary key)` insert-or-skip would make `account.updated` and the
  2b capture events safely idempotent under Stripe's at-least-once delivery.
- **Stripe `idempotencyKey`** on `checkout.sessions.create` (e.g. `join:{gameId}:{playerId}`)
  so repeated Join clicks don't create multiple authorizations.
- **Generate Supabase `Database` types** — the webhook's swallowed-error path (now fixed)
  would have been caught at compile time; `.rpc()/.from()` are currently `any`.
- **Webhook mislabels a 400** ("bad signature") if `STRIPE_WEBHOOK_SECRET` is set but
  `STRIPE_SECRET_KEY` isn't; check `paymentsEnabled()`/construct the client first → 503.

## Polish
- **`?payouts=required`** redirect (un-onboarded host tries a paid game) shows no banner
  on Profile — read the param and render "Set up payouts to host paid games."
- **Price accepts cents but displays whole dollars** — `priceUsd=5.50` → charges $5.50 but
  the Join label shows "$5". Clamp to whole dollars server-side or display `.toFixed(2)`.

## Deferred to 2b / 2c (by design)
- Capture-on-confirmation (capture the held PIs when `min_players_to_confirm` met);
  refund/void on cancellation; waitlists; price floor already done (2a). (2b)
- No-show tracking; notifications (game confirmed / spot opened / game tomorrow). (2c)

---

# Phase 2b — Deferred Follow-ups

Final review: ready to merge (keyless build safe). The Critical (refund reverse_transfer)
+ capture idempotency are fixed (commit 907222e). Remaining items must be addressed
before/at the point Stripe keys go live.

## Money durability (before live keys)
- **Action-driven refunds are best-effort.** `cancelGameAction`/`leaveAction` commit the
  DB transition then call Stripe outside any transaction with no retry (unlike the
  webhook, which Stripe retries). If the request dies mid-settle, some players are never
  refunded with no record. Add a reconciliation sweep (find `cancelled` rows with
  `paid=true` and no recorded refund) or move settle onto a durable queue.
- **capture-ok-but-mark_captured-fails.** If `capturePaymentIntent` succeeds but the
  `mark_captured` DB flip fails, `paid` stays false; a later `cancel_game` returns
  `paid=false` → `settleCancellation` tries to VOID an already-captured PI → errors,
  player not refunded. The reconciliation sweep should also detect captured-but-unflagged.
- **Spec wording:** §2/§3.4 named only `refund_application_fee`; `reverse_transfer:true`
  is required for destination-charge refunds (fixed in code, update the spec text).

## UX / audit
- **Host "Cancel game" has no confirmation.** One-way + immediately refunds/voids everyone.
  Add a client `confirm()` / two-step confirm.
- **Rejoin after a forfeited leave** overwrites `payment_intent_id`, losing the reference
  to the earlier captured (forfeited) charge — audit linkage gap.

## Deferred to 2c (by design)
- Automatic expiry/void of unconfirmed games at start time (needs a scheduler).
- No-show tracking; notifications (confirmed / spot opened / game tomorrow).
