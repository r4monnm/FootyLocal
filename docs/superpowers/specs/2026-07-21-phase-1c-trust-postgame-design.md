# FootyLocal — Phase 1c: Trust & Post-Game (Design Spec)

**Date:** 2026-07-21
**Status:** Approved for planning
**Scope:** Phase 1c only. The rich skill system (peer ratings → displayed tiers, karma-driven join-gating), photo/ID verification, Share My Game, and check-in/SOS are **Phase 3** and out of scope. Messages/chat block-invisibility is **Phase 4**.

## 1. Goal

The trust-and-safety layer that completes the "core usable product": post-game **ratings** (capture + immediate effects), **report**, and **block** (with host-level invisibility). This wires up the `ratings`, `reports`, and `blocks` tables created in Phase 0.

At the end of 1c:
- A player can rate co-players and the host of a **past game they were on** (skill + sportsmanship + "showed up on time"), anonymously, once per (rater, ratee, game).
- A profile shows a phone-verified badge, **karma** (thumbs-ups received), games played, and average skill — all **computed** from `ratings` (no drift-prone counter).
- Users can **report** and **block** other users (host or roster players). Blocks are bidirectional: a blocked host's games disappear from your Discover and you can't open their game detail.
- A **My Games** tab lists your upcoming and past games; past games link to the rating flow.

### Non-goals (Phase 3 / later)
Aggregating ratings into a displayed skill tier; karma-driven join-gating; photo/ID verification; Share My Game; check-in/SOS. Roster-overlap block hiding (we chose host-level). Message/chat block invisibility (Phase 4). Host "mark game completed" flow.

## 2. Constraints

Inherits all prior-phase constraints (TS strict/no-any, RLS, no precise/roster leakage to non-roster clients, deterministic write-time fuzzing, design tokens: pills/circles + volt accent + condensed uppercase display, no gradients). Plus:

- Ratings are **anonymous**: a ratee can never see who rated them, and the rating write path never exposes rater identity to the ratee.
- A user rates/reports/blocks only as themselves (`auth.uid()`), never on another's behalf. Rating is allowed only for a **past** game (end time passed) the rater was on the roster of, and only rating a co-participant (not themselves).
- Block invisibility is enforced **in the database** (`games_near` / `game_detail` block exclusion on the host), never trusted from the client.

## 3. Architecture Decisions

### 3.1 `submit_rating` RPC (SECURITY DEFINER, authenticated, self-gated)

`submit_rating(p_game_id uuid, p_ratee_id uuid, p_skill_score jsonb, p_reliability_up boolean, p_is_host_rating boolean)`:
- `rater := auth.uid()`; raise if null.
- Validate: the game exists and `ends_at < now()` (past game); `rater` has a `game_players` row for it with `status='joined'`; `ratee` also has a `status='joined'` row for it; `rater <> ratee`.
- Upsert into `ratings` on the unique `(game_id, rater_id, ratee_id)` — insert or update `skill_score`, `reliability_up`, `is_host_rating`. Re-rating overwrites (no double-counting).
- Granted to `authenticated`.

### 3.2 `profile_stats` RPC (computed, no stored counters)

`profile_stats(p_user_id uuid)` returns one row: `games_played` (count of distinct games with a `status='joined'` roster row for the user whose `ends_at < now()`), `karma` (count of ratings received with `reliability_up = true`), `avg_skill` (average of `skill_score->>'skill'` across ratings received, null if none), `ratings_count`. `SECURITY DEFINER`, granted `authenticated` (and `anon` for public profile viewing). Returns only aggregates — never who rated whom (preserves anonymity). The Phase 0 `profiles.karma` int column is left unused/for Phase 3; 1c displays the computed value.

### 3.3 Block invisibility: rebuild `games_near` + `game_detail` (migration 0010)

Both are rebuilt (`games_near` DROP+CREATE because return shape is unchanged but we edit the body; `game_detail` `CREATE OR REPLACE`) to add a **bidirectional block exclusion on the host**:
```
and not exists (
  select 1 from blocks b
  where (b.blocker_id = auth.uid() and b.blocked_id = g.host_id)
     or (b.blocker_id = g.host_id  and b.blocked_id = auth.uid())
)
```
- `games_near`: adds the clause to its `where` → blocked hosts' games never appear.
- `game_detail`: adds the same as a `where` predicate → a blocked host's game returns **no row** (page shows an "unavailable" state). Everything else in these functions (fuzzing gate, roster gate, filters, columns) is unchanged.

### 3.4 Report and block are direct RLS-scoped writes

No RPC needed — the Phase 0 policies already allow own-row writes:
- **Report:** `insert into reports (reporter_id=auth.uid(), reported_id?, game_id?, reason, details)` via the user client (`reports_rw_own` `with check auth.uid()=reporter_id`).
- **Block:** `insert into blocks (blocker_id=auth.uid(), blocked_id)` / `delete` via the user client (`blocks_rw_own`). Unique `(blocker_id, blocked_id)` prevents duplicates (upsert/ignore on conflict).

## 4. Data Model Changes

No new tables. New DB objects (migration `0010_trust_postgame.sql`): `submit_rating`, `profile_stats` RPCs; rebuilt `games_near` + `game_detail` with the host block exclusion. `ratings`/`reports`/`blocks` tables and their RLS policies are unchanged (Phase 0).

## 5. Shared Logic (`packages/core`)

- `ratingInputSchema` (Zod): `skill` (int 1–5), `sportsmanship` (int 1–5), `showedUp` (bool), `isHostRating` (bool). Serializes `skill_score` jsonb as `{ skill, sportsmanship }`.
- `reportSchema` (Zod): `reason` (enum matching `report_reason`), `details` (string ≤500, optional).
- Small helpers/tests. Report reasons constant `REPORT_REASONS` mirroring the DB enum.

## 6. UI (within design tokens)

- **My Games tab** (`/my-games`): the user's games (joined or hosting), split **Upcoming** (end time in future) and **Past** (ended). Each card links to `/game/[id]`; past cards also link to `/game/[id]/rate`.
- **Rating page** (`/game/[id]/rate`): server-fetches the roster (via a `ratable_players` helper — reuse `game_detail`'s roster for a game the viewer is on, filtered to a past game) + which the viewer has already rated; renders a compact per-player form (skill 1–5, sportsmanship 1–5, "showed up on time" toggle) submitting to `submit_rating`. Already-rated players show a "rated" state.
- **Game detail page** (`/game/[id]`): add **Report** and **Block** actions targeting the host, and (when joined + roster visible) per-roster-player Report/Block. Block confirms; after blocking the host, the page redirects to Discover (game now hidden).
- **Profile tab** (`/profile`): phone-verified badge, karma, games played, average skill (from `profile_stats`); a "Blocked users" management list (unblock).
- Reuse existing primitives; headlines condensed uppercase; pills; single volt accent.

## 7. Testing

- `packages/core`: `ratingInputSchema` + `reportSchema` unit tests (bounds, enum).
- Live/manual: two past-game participants can rate each other (skill/sportsmanship/showed-up), can't rate themselves, can't rate a future game, re-rating overwrites; profile_stats reflects karma/games/avg; blocking a host removes their games from `games_near` and returns no `game_detail` row (both directions); report inserts a row.

## 8. Definition of Done

- [ ] `submit_rating` stores a rating only for a past game both users were on; rejects self-rating, future games, and non-participants; re-rating overwrites (one row per rater/ratee/game). Ratee identity of the rater is never exposed.
- [ ] `profile_stats` returns computed karma (thumbs-ups received), games played, avg skill; Profile displays them + the phone badge.
- [ ] Blocking a user is bidirectional and hides that host's games from `games_near` and returns no `game_detail` row for either party (verified live). Unblock restores visibility.
- [ ] Report inserts a `reports` row (reason + details) from a game/profile.
- [ ] My Games lists upcoming + past; past games link to the rating flow.
- [ ] `packages/core` schema tests pass; typecheck clean; `next build` succeeds.
