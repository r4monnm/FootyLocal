# FootyLocal Phase 3a: Skill Tiers + Gating — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute a displayed skill tier from peer ratings (blended with self-reported below a threshold), show it on Profile + host reputation on game detail, and a non-blocking "above your level" warning — all pure math + UI reads, no DB change, no RPC gating.

**Architecture:** `computeTier` in `packages/core/skill` (pure, tested). The Profile and game detail pages compute tiers from the existing `profile_stats` RPC (avg_skill, ratings_count) + `profiles.self_reported_skill`. Warn-but-allow: the join flow is untouched.

**Tech Stack:** TypeScript strict, Next.js App Router, Supabase (existing RPCs), Vitest.

## Global Constraints

- Inherits all prior constraints (TS strict/no-any, RLS, design tokens).
- Tier math is pure + unit-tested in `packages/core`. Ratings stay anonymous (aggregates only). **No change to `join_game`/`join_paid`** (warn-but-allow). No DB migration.
- Frequent commits: each task ends committed.

---

## File Structure

```
packages/core/
  src/skill/index.ts            # + MIN_RATINGS_FOR_TIER, computeTier
  src/skill/skill.test.ts
apps/web/
  app/(tabs)/profile/page.tsx   # viewer tier badge (modify)
  app/game/[id]/page.tsx        # host tier badge + below-level warning (modify)
```

---

### Task 1: core — computeTier (TDD)

**Files:**
- Modify: `packages/core/src/skill/index.ts`, `packages/core/src/skill/skill.test.ts`

**Interfaces:**
- Produces: `MIN_RATINGS_FOR_TIER = 3`; `computeTier(avgSkill: number | null, ratingsCount: number, selfReported: SkillBand | null): { band: SkillBand; source: "peer" | "self" }`.

- [ ] **Step 1: Add tests to `packages/core/src/skill/skill.test.ts`**

Add the import and append:

```ts
import { computeTier, MIN_RATINGS_FOR_TIER } from "./index.js";

describe("computeTier", () => {
  it("uses self-reported below the ratings threshold", () => {
    expect(computeTier(4.5, MIN_RATINGS_FOR_TIER - 1, "beginner")).toEqual({ band: "beginner", source: "self" });
  });
  it("falls back to beginner when there is no self band and too few ratings", () => {
    expect(computeTier(null, 0, null)).toEqual({ band: "beginner", source: "self" });
  });
  it("uses peer band at/above the threshold, by cutoff", () => {
    expect(computeTier(1.9, 3, "pro")).toEqual({ band: "beginner", source: "peer" });
    expect(computeTier(2, 3, null)).toEqual({ band: "intermediate", source: "peer" });
    expect(computeTier(3, 5, null)).toEqual({ band: "advanced", source: "peer" });
    expect(computeTier(4, 10, null)).toEqual({ band: "pro", source: "peer" });
    expect(computeTier(4.9, 4, null)).toEqual({ band: "pro", source: "peer" });
  });
  it("uses self-reported when avg is null even with enough ratings", () => {
    expect(computeTier(null, 5, "advanced")).toEqual({ band: "advanced", source: "self" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @footylocal/core test`
Expected: FAIL — `computeTier` not exported.

- [ ] **Step 3: Implement in `packages/core/src/skill/index.ts`**

Append:

```ts
/** Minimum peer ratings before a player's tier is peer-derived (vs self-reported). */
export const MIN_RATINGS_FOR_TIER = 3;

function bandFromAvgSkill(avg: number): SkillBand {
  if (avg < 2) return "beginner";
  if (avg < 3) return "intermediate";
  if (avg < 4) return "advanced";
  return "pro";
}

/** A player's displayed skill tier: peer-derived once they have enough ratings,
 * otherwise their self-reported band (default beginner). */
export function computeTier(
  avgSkill: number | null,
  ratingsCount: number,
  selfReported: SkillBand | null,
): { band: SkillBand; source: "peer" | "self" } {
  if (ratingsCount >= MIN_RATINGS_FOR_TIER && avgSkill != null) {
    return { band: bandFromAvgSkill(avgSkill), source: "peer" };
  }
  return { band: selfReported ?? "beginner", source: "self" };
}
```

- [ ] **Step 4: Typecheck + tests**

Run: `pnpm --filter @footylocal/core typecheck && pnpm --filter @footylocal/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): computeTier (peer/self skill tier) with tests"
```

---

### Task 2: web — Profile tier badge

**Files:**
- Modify: `apps/web/app/(tabs)/profile/page.tsx`

**Interfaces:**
- Consumes: `computeTier` from `@footylocal/core`; existing `profile_stats` + `profiles.self_reported_skill`.

- [ ] **Step 1: Add self_reported_skill to the profile fetch**

In `profile/page.tsx`, the profile query currently selects `display_name, phone_verified`. Change it to also select `self_reported_skill`:
```tsx
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, phone_verified, self_reported_skill")
      .eq("id", user.id)
      .single();
```
Capture it:
```tsx
    selfReported = (profile?.self_reported_skill ?? null) as SkillBand | null;
```
Add a `let selfReported: SkillBand | null = null;` near the other `let` declarations, and import the type + helper:
```tsx
import { computeTier, type SkillBand } from "@footylocal/core";
```

- [ ] **Step 2: Compute + render the tier badge**

After the stats are resolved, compute:
```tsx
  const tier = computeTier(
    stats.avg_skill != null ? Number(stats.avg_skill) : null,
    Number(stats.ratings_count),
    selfReported,
  );
```
Render a tier badge near the phone-verified badge (in the badge row):
```tsx
        <Badge tone="accent">{tier.band}</Badge>
        <span className="text-xs uppercase text-neutral-400">{tier.source === "peer" ? "peer-rated" : "self-rated"}</span>
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): skill-tier badge on Profile"
```

---

### Task 3: web — game detail host reputation + below-level warning

**Files:**
- Modify: `apps/web/app/game/[id]/page.tsx`

**Interfaces:**
- Consumes: `computeTier`, `meetsBand`, `SkillBand`, `GameBand` from `@footylocal/core`; `game_detail` (host_id, skill_band, viewer_joined); `profile_stats`; `profiles.self_reported_skill`.

- [ ] **Step 1: Add imports + a tier helper in `apps/web/app/game/[id]/page.tsx`**

```tsx
import { computeTier, meetsBand, type SkillBand, type GameBand } from "@footylocal/core";
```

After `game` is fetched (and non-null), add a small helper that computes a user's tier from their id:
```tsx
  async function tierFor(userId: string) {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.rpc("profile_stats", { p_user_id: userId }),
      supabase.from("profiles").select("self_reported_skill").eq("id", userId).single(),
    ]);
    const stat = s?.[0];
    return computeTier(
      stat?.avg_skill != null ? Number(stat.avg_skill) : null,
      stat ? Number(stat.ratings_count) : 0,
      (p?.self_reported_skill ?? null) as SkillBand | null,
    );
  }
```

- [ ] **Step 2: Compute host + viewer tiers**

```tsx
  const hostTier = await tierFor(game.host_id);
  const viewerTier = user ? await tierFor(user.id) : null;
  const belowLevel =
    !!viewerTier &&
    !game.viewer_joined &&
    (game.skill_band as GameBand) !== "open" &&
    !meetsBand(viewerTier.band, game.skill_band as GameBand);
```

- [ ] **Step 3: Render the host tier badge**

Where the host name is shown (`host: {game.host_name ?? "—"}`), append a tier badge:
```tsx
        <span>host: {game.host_name ?? "—"} · <span className="uppercase">{hostTier.band}</span></span>
```
(Or place a `<Badge>` inline; keep it lightweight and within the existing metadata block.)

- [ ] **Step 4: Render the below-level warning in the not-joined section**

Near the Join control (inside the not-joined branch, before the Join form), add:
```tsx
          {belowLevel && (
            <p className="text-sm text-neutral-500">
              This game is rated <span className="uppercase">{game.skill_band}</span> — above your{" "}
              <span className="uppercase">{viewerTier!.band}</span> level. You can still join.
            </p>
          )}
```
The Join button/flow is unchanged (warn but allow).

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): host reputation tier + below-level warn-but-allow on game detail"
```

---

## Final Verification (Definition of Done)

- [ ] `pnpm typecheck` clean; `pnpm --filter @footylocal/core test` green (computeTier boundaries + source); `pnpm --filter @footylocal/web build` succeeds.
- [ ] Profile shows the viewer's tier badge (peer/self source).
- [ ] Game detail shows the host's tier and a non-blocking "above your level" warning for a below-level, not-joined viewer on a non-open game; Join is unchanged.
- [ ] `join_game`/`join_paid` untouched; no DB migration; ratings anonymity preserved (aggregates only).

## Self-Review Notes (author)

- **Spec coverage:** computeTier §3.1 → T1; Profile tier §3.3 → T2; host reputation + warning §3.3 → T3; no-DB §4 → confirmed (all reads via existing profile_stats + self_reported_skill).
- **Anonymity:** tiers use only `profile_stats` aggregates (avg_skill, ratings_count) — never rater identities.
- **Warn-but-allow:** the warning is a `<p>` note; the Join form is unchanged; no RPC edits.
- **Type consistency:** `computeTier` returns `SkillBand`; `meetsBand(SkillBand, GameBand)` — game.skill_band cast to GameBand; `stats.avg_skill` numeric|null → Number()|null.
- **Perf note:** game detail adds up to two `profile_stats` calls (host + viewer) via `Promise.all` inside `tierFor`; acceptable for a detail page. If it matters later, fold host/viewer tier inputs into `game_detail`.
- **Known follow-ups:** roster-member tiers (needs game_detail roster tier fields); Glicko-2 hidden rating (Phase 4); hard gating toggle.
```

