# FootyLocal — Phase 3a: Skill Tiers + Gating (Design Spec)

**Date:** 2026-07-22
**Status:** Approved for planning
**Scope:** Phase 3a only. The hidden Glicko-2 rating / placement games / decay (Phase 4), identity verification (3b), and Share My Game + check-in/SOS (3c) are out of scope.

## 1. Goal

Turn the anonymous peer ratings captured in 1c into a **displayed skill tier**, show **host reputation**, and **warn (but not block)** a player about joining a game above their level. Self-contained: pure tier math in `packages/core` + UI reads of existing data — **no DB migration, no RPC gating**.

At the end of 3a:
- A player's skill tier is computed from their average peer skill score (blended with their self-reported band until they have enough ratings) and shown on their Profile.
- The game detail page shows the **host's** tier (reputation) and, for a not-yet-joined viewer whose tier is below the game's band, a friendly **"above your level" warning** — joining is unchanged (warn but allow).

### Non-goals (later)
Hidden Glicko-2 numeric rating, placement games, rating decay, volatility guards (Phase 4). Hard join-gating / per-game enforce toggle. Reliability/karma-based gating (reliability is displayed from 2c; not a gate). Showing every roster member's tier (host + own only in 3a).

## 2. Constraints

Inherits all prior constraints (TS strict/no-any, RLS, seam-gated payments, design tokens). Plus:

- Tier math is **pure and unit-tested** in `packages/core` so web (and future native) share one definition.
- Ratings stay **anonymous**: the tier uses only aggregates already exposed by `profile_stats` (avg skill, count) — never who rated whom.
- Warn-but-allow: **no change to `join_game`/`join_paid`** — the warning is display-only.

## 3. Architecture

### 3.1 `computeTier` (packages/core/skill)
- `MIN_RATINGS_FOR_TIER = 3`.
- `computeTier(avgSkill: number | null, ratingsCount: number, selfReported: SkillBand | null): { band: SkillBand; source: "peer" | "self" }`:
  - If `ratingsCount >= MIN_RATINGS_FOR_TIER` and `avgSkill != null` → map `avgSkill` (1–5) to a band and `source: "peer"`.
  - Else → `band: selfReported ?? "beginner"`, `source: "self"`.
- **Band cutoffs** (`avgSkill`): `< 2 → beginner`, `[2, 3) → intermediate`, `[3, 4) → advanced`, `>= 4 → pro`.
- Reuses the existing `SkillBand`, `SKILL_BANDS`, `skillRank`, and `meetsBand` (Phase 0). The below-level check is `!meetsBand(viewerBand, gameBand)` with `gameBand !== "open"`.

### 3.2 Data sources (no new DB)
- The viewer's tier: `profile_stats(auth.uid())` gives `avg_skill` + `ratings_count`; `profiles.self_reported_skill` gives the self band. Compute in TS.
- The host's tier (game detail): `profile_stats(host_id)` + the host's `self_reported_skill` (both readable — `profile_stats` is granted `anon`; `profiles` columns except `stripe_account_id` are readable). Compute in TS.

### 3.3 UI

- **Profile (`/profile`)**: a tier badge near the stats — e.g. `Advanced` with a small `peer-rated` / `self-rated` sub-label (from `source`). Uses the viewer's own `profile_stats` (already fetched) + `self_reported_skill`.
- **Game detail (`/game/[id]`)**:
  - **Host reputation**: next to the host name, a tier badge computed from a `profile_stats(host_id)` fetch + the host's self-reported band.
  - **Below-level warning**: for a viewer who is **not joined**, when `game.skill_band !== "open"` and `!meetsBand(viewerTier.band, game.skill_band)`, show a non-blocking notice: "This game is rated **{game band}** — above your **{viewer band}** level. You can still join." Rendered near the Join control; the Join button/flow is unchanged.

## 4. Data Model

None. Reuses `profile_stats` (avg_skill, ratings_count) and `profiles.self_reported_skill`.

## 5. Shared Logic (`packages/core`)

`packages/core/src/skill/index.ts` additions: `MIN_RATINGS_FOR_TIER`, `computeTier`, and a small `TIER_CUTOFFS` if helpful. Tests: below-threshold → self band + source self; at/above → peer band by cutoff (each boundary: 1.9→beginner, 2→intermediate, 3→advanced, 4→pro); null avg / null self fallbacks; the below-level warning predicate via `meetsBand`.

## 6. UI Detail (within design tokens)

- Tier badge uses the existing `Badge` primitive; the source sub-label is small neutral text. Bands display capitalized. No new colors.
- The warning uses the existing error/neutral notice styling (a neutral/amber-free note — reuse the "approximate area" note styling), not a blocking element.

## 7. Testing

- `packages/core`: `computeTier` boundaries + source selection; the below-level predicate.
- Manual/live: a profile with ≥3 ratings shows a peer-rated tier; below that, self-rated; the game detail shows the host's tier and, for a below-level viewer on a banded game, the warning — and joining still works.
- Build/typecheck pass.

## 8. Definition of Done

- [ ] `computeTier` computes peer band at/above `MIN_RATINGS_FOR_TIER` (correct cutoffs) and self band below; source label correct; null fallbacks; tested.
- [ ] Profile shows the viewer's tier badge with peer/self source.
- [ ] Game detail shows the host's tier badge and a non-blocking "above your level" warning for a below-level, not-joined viewer on a non-open game; Join is unchanged (warn but allow).
- [ ] No DB migration; `join_game`/`join_paid` unchanged; ratings anonymity preserved.
- [ ] `packages/core` tests pass; typecheck clean; `next build` succeeds.
