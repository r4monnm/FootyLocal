# FootyLocal — Phase 1b: Join + Reveal + Game Detail (Design Spec)

**Date:** 2026-07-21
**Status:** Approved for planning
**Scope:** Phase 1b only. Phase 1c (ratings + report/block) and Phase 2 (payments, waitlists, no-show/refunds) are out of scope and referenced only where they constrain 1b.

## 1. Goal

The join half of the core loop. From the Discover preview, a user opens a game's **detail page** (`/game/[id]`); before joining they see venue/band/time/host/spots and the fuzzed public area — **no exact pitch, no player names**. A phone-verified user taps **Join**; once on the roster the page reveals the **exact pitch on a mini-map + a Google Directions link** and the **full roster names**. A joined non-host player can **Leave**, freeing their spot and hiding the reveal again.

At the end of 1b:
- `/game/[id]` renders game + venue + host + spots for anyone; precise location and roster names are shown **only to callers on the roster**.
- Join is gated on phone-verified, game open, and available capacity (race-safe); a user cannot join twice or join on someone else's behalf.
- Leaving frees the spot; the host cannot leave their own game.
- The Discover preview links to the detail page ("View game").

### Non-goals for 1b (deferred)
Ratings, report, block (1c). Waitlist-when-full, refund deadlines, no-show tracking, payments (Phase 2). Game cancellation/editing by the host. Hard skill-band gating (v2). **Women-only enforcement at join** (see §7).

## 2. Constraints

Inherits all Phase 0/1a constraints (TS strict/no-any, RLS, verified-venues-only, deterministic write-time fuzzing, **precise coordinates + roster identities never exposed to non-roster clients**, design tokens: pills/circles + volt accent + condensed uppercase display, no gradients). Plus:

- The precise-location and roster-name reveal is gated **in the database** (`game_detail` RPC gate on `auth.uid()`), never trusted from the client.
- Join capacity is enforced server-side and race-safe (row lock), not by the client.
- A caller can only join/leave as themselves (`auth.uid()`), never another user.

## 3. Architecture Decisions

### 3.1 Three `SECURITY DEFINER` RPCs granted to `authenticated`

Unlike `create_game` (service-role-only, because it writes fuzzed geography a client must not control), these three act **on behalf of the authenticated caller** and gate every sensitive output/mutation on `auth.uid()`, so granting them to `authenticated` is safe. New SQL migration `0008_join_reveal.sql`.

**`game_detail(p_game_id uuid)`** — returns a single row:
- Always: `id, title, description, skill_band, format, price_cents, starts_at, ends_at, is_women_only, max_players, min_players_to_confirm, status, host_id, host_name, venue_name, venue_address, surface_type, public_lat, public_lng, joined_count, viewer_joined` (bool: is `auth.uid()` on the roster with `status='joined'`).
- Gated (only when `viewer_joined`): `precise_lat, precise_lng` (else null); `roster` jsonb array of `{ player_id, name, role }` for `status='joined'` players (else null).
- SECURITY DEFINER, `set search_path=public`, granted to `authenticated` (and `anon` may call it but `viewer_joined` is false for anon → no precise/roster). The gate is inside the function.

**`join_game(p_game_id uuid)`** — returns text status:
- `player := auth.uid()`; raise if null.
- `select ... from games where id=p_game_id for update` (row lock → serializes concurrent joins for this game).
- Checks: game exists and `status='open'`; caller `phone_verified`; caller not already `status='joined'`; `joined_count < max_players`.
- Insert `game_players(game_id, player_id, role='player', status='joined')`; if a prior row exists for `(game_id, player_id)` (e.g. a `cancelled` one), update it to `joined` (respects the `unique(game_id, player_id)` constraint).
- Raises a clear exception on each failure (not verified / full / already joined / not open) — mapped to friendly copy in the web layer.
- SECURITY DEFINER, granted to `authenticated`.

**`leave_game(p_game_id uuid)`** — returns text status:
- `player := auth.uid()`. Reject if the caller's role on this game is `host` ("the host can't leave their own game").
- Set the caller's `game_players` row `status='cancelled'`.
- SECURITY DEFINER, granted to `authenticated`.

### 3.2 Detail page fetches `game_detail`; join/leave are server actions

- `/game/[id]/page.tsx` (server component) calls `game_detail` via the server (cookie-bound, RLS) Supabase client. The RPC's `auth.uid()` gate decides what the page receives — the page renders whatever it's given (no client-side authorization).
- `joinAction` / `leaveAction` (server actions) call `join_game` / `leave_game`, then redirect back to `/game/[id]` (revalidated). Errors surface via a friendly game-error mapper.

### 3.3 Precise reveal UI

When `precise_lat/lng` are present (joined), render a client `GameLocationMap` (a single Google Map pinned at the exact point, reusing the `lib/maps/loader.ts` loader) plus a Directions deep link built by `googleDirectionsUrl(lat, lng)` → `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`. When absent, show the fuzzed-area note only.

## 4. Data Model Changes

No new tables. New DB objects (SQL migration `0008_join_reveal.sql`): `game_detail`, `join_game`, `leave_game` RPCs (§3.1). `game_players` already models the roster; joins reactivate a `cancelled` row rather than violating `unique(game_id, player_id)`. RLS unchanged (the RPCs are SECURITY DEFINER and self-gate).

## 5. Shared Logic (`packages/core`)

- `googleDirectionsUrl(lat: number, lng: number): string` — pure, tested (correct host, `api=1`, destination formatting).

## 6. UI (within design tokens)

- **`/game/[id]`**: display headline title + band badge; venue name/address, surface, format, time, host name, spots-remaining, women-only flag; a public-area note when not joined. Join (accent pill) when open + not joined; Leave (outline/ghost) when joined and not host; disabled/explanatory state when full or not phone-verified (links to `/verify-phone`). When joined: roster names list + `GameLocationMap` + "Open in Google Maps" directions link.
- **Discover preview** (`GamePreview.tsx`): replace the disabled "Join — coming next" pill with a **"View game"** link to `/game/[id]`.

## 7. Deferred / Flagged Gaps

- **Women-only enforcement at join is NOT implemented** — `profiles` has no gender attribute, so `join_game` cannot gate by gender. `is_women_only` remains a display flag + Discover filter (as in 1a). Enforcing it requires adding a profile gender field in a later phase; tracked as a follow-up. `join_game` does not check `is_women_only`.
- Skill-band gating stays display-only (v1). No hard block on joining above one's band.
- Blocks are not consulted at join (block creation is 1c; no blocks exist yet).

## 8. Testing

- `packages/core`: `googleDirectionsUrl` unit test.
- Live/manual: a second (phone-verified) user opens a seeded game → sees host + count, no precise, no names; joins → precise + directions + roster names appear, spots decrement; a concurrent/over-capacity join is rejected; double-join is rejected; leave frees the spot and hides the reveal; host cannot leave; a non-joined `game_detail` call returns `precise_*` = null and `roster` = null.

## 9. Definition of Done

- [ ] `/game/[id]` renders. Non-joined viewer: host + spots + fuzzed-area note; **no** precise coords, **no** roster names.
- [ ] Phone-verified user can Join an open game with capacity → added to roster (`status='joined'`); precise location (mini-map + Directions link) and roster names revealed; spots decrement. Non-phone-verified user is blocked with a verify prompt/link.
- [ ] Join is race-safe (row lock) and rejects: full, already-joined, not-open, not-verified — each with friendly copy. A caller can only join as themselves.
- [ ] Leave sets the caller's row `cancelled`, frees the spot, hides the reveal. Host cannot leave their own game.
- [ ] `game_detail` returns `precise_*` = null and `roster` = null to a non-roster caller (verified live).
- [ ] Discover preview links to `/game/[id]`.
- [ ] `packages/core` `googleDirectionsUrl` test passes; typecheck clean; `next build` succeeds.
