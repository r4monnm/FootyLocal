# FootyLocal — Mobile v1: Joiner Loop (Design Spec)

**Date:** 2026-07-22
**Status:** Approved for planning
**Scope:** The first native (Expo) app cut — the player/joiner loop. Hosting from mobile, paid join, ratings, identity verification, and messages are OUT (later mobile cuts). The web app remains the reference + desktop/admin surface and is unchanged except one additive backend RPC.

## 1. Goal

Ship a runnable native app (`apps/mobile`) that lets a player **sign up, verify their phone, discover nearby games, join one, and see the exact pitch** — reusing the same Supabase backend, the same safety-enforcing RPCs, and `packages/core` verbatim. It runs in **Expo Go** (no native build) so the core UX can be validated on a real iPhone/Android immediately.

At the end of Mobile v1:
- A user can create an account (with the 18+ attestation), sign in, and verify their phone (dev OTP).
- Discover lists nearby games (distance + filters) from `games_near`; no embedded map.
- A game detail screen shows meta, the host's skill tier + verification badges, and a Join/Leave control.
- On join, the exact pitch address + an "Open in Maps" deep link are revealed (precise location comes only from `game_detail` after joining — the server gate is unchanged).
- My Games (upcoming/past) and a read-only Profile (badges/tier/stats) work.

### Non-goals (later mobile cuts)
Embedded native map (`react-native-maps` + dev build), hosting a game, paid join (Stripe Checkout), ratings/report/block flows, identity verification flow, messages/notifications, push notifications, offline caching, profile editing, EAS builds / app-store submission.

## 2. Constraints

Inherits the project-wide constraints (TS strict / no-any; **never trust the client for authorization** — all gates stay in the DB RPCs; **precise location never reaches a non-roster client** — enforced by `game_detail`/`games_near`, not the app; Nike design tokens). Plus:

- **Runs in Expo Go** — no custom native modules in v1. Anything needing a dev build (embedded maps) is deferred.
- **Anon key only.** The mobile bundle uses the Supabase URL + **publishable/anon** key via `EXPO_PUBLIC_*` env. The **service-role key must never appear in `apps/mobile`**, and `packages/db` (service client) must never be imported by the app.
- **Reuse `packages/core` verbatim** — tiers, verification, distance/format helpers, `googleDirectionsUrl`, validation schemas. No mobile-specific fork of domain logic.
- **Same backend, same RPCs.** The app calls the existing `games_near`, `game_detail`, `join_game`, `leave_game`, `my_games`, `profile_stats`. The only new backend object is `mark_phone_verified()` (§4).
- **Design fidelity:** Nike tokens ported to RN (ink `#111111`, surface `#FFFFFF`, gray `#F5F5F5`, volt accent `#CCFF00`, pill/circle radii, uppercase condensed headlines). Anton (display) + Inter (body) via `expo-google-fonts`.

## 3. Architecture

### 3.1 App shell & tooling
- `apps/mobile`: Expo (managed workflow, current SDK), **Expo Router** (file-based routing), TypeScript strict, in the existing pnpm/Turborepo workspace.
- **Metro monorepo config** (`metro.config.js` extending `expo/metro-config`): `watchFolders` includes the repo root; `resolver.nodeModulesPaths` includes the app's and the root `node_modules`; resolve the `@footylocal/core` workspace package **from TS source**, including its ESM-style `.js` internal imports (the web app solves the analogous case with a webpack `extensionAlias`; Metro needs the equivalent — a `resolver.resolveRequest`/`sourceExts` mapping so `./x.js` resolves to `./x.ts`). This is the primary toolchain risk and is validated first (Task 1) by importing and calling a real `core` function (e.g. `formatDistance`/`computeTier`) in the initial screen.
- `app.json`/`app.config`: app name, scheme (`footylocal`), and `EXPO_PUBLIC_*` passthrough.

### 3.2 Supabase client (`apps/mobile/lib/supabase.ts`)
- `import "react-native-url-polyfill/auto"`.
- `createClient(EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } })`.
- AppState listener: `supabase.auth.startAutoRefresh()` on `active`, `stopAutoRefresh()` otherwise (the documented RN pattern).
- Anon client only. No service-role, no `packages/db`.

### 3.3 Navigation & session gate
```
apps/mobile/app/
  _layout.tsx           # loads fonts; subscribes to auth state; routes by session
  (auth)/sign-in.tsx
  (auth)/sign-up.tsx    # email + password + 18+ checkbox
  (auth)/verify-phone.tsx
  (tabs)/_layout.tsx    # bottom tabs: Discover · My Games · Profile
  (tabs)/discover.tsx
  (tabs)/my-games.tsx
  (tabs)/profile.tsx
  game/[id].tsx
```
- Root `_layout` uses `supabase.auth.getSession()` + `onAuthStateChange`: **no session → `(auth)/sign-in`**; session → `(tabs)`. `game/[id]` is reachable while signed in.
- **Phone-not-verified** users can browse Discover/detail but the Join control is replaced by a "Verify your phone to join" link to `(auth)/verify-phone` (mirrors web).

### 3.4 Screens (all data via the anon client + existing RPCs)
- **sign-up**: `supabase.auth.signUp({ email, password, options: { data: { is_18_plus: true } } })` — validated with `signUpSchema` from core (email, ≥10-char pw, 18+ required). The `handle_new_user` trigger reads `is_18_plus`. On session, route to verify-phone.
- **sign-in**: `supabase.auth.signInWithPassword`; errors via `friendlyAuthError` (core).
- **verify-phone**: input a 6-digit code (`otpSchema` from core); if it matches the dev code the app calls `supabase.rpc("mark_phone_verified")` (§4) and routes to Discover. (Dev stub — the client compares against `000000`; the RPC does the privileged flag write.)
- **Discover**: request foreground location (`expo-location`); call `games_near` with the viewer's lat/lng + filters (skill band, format, women-only, radius, date window — the filters already supported by `games_near`). Render the list (title, venue, distance via core's distance formatting, spots, price, skill badge). No map. Tapping a card → `game/[id]`.
- **game/[id]**: `game_detail` for meta + `viewer_joined` + (post-join) `precise_lat/lng` + roster. Host reputation: `profile_stats(host_id)` + host `self_reported_skill` → `computeTier`; host `photo_verified/id_verified/phone_verified` → `verificationSummary` badges. Controls:
  - Not joined, phone-verified, **free** game → **Join** (`join_game`); full → **Join waitlist**.
  - Not joined, **paid** game → price shown, Join **disabled** ("paid join coming to mobile").
  - Not phone-verified → "Verify your phone to join" link.
  - Joined → **You're in**: exact address + **Open in Maps** (`Linking.openURL(googleDirectionsUrl(lat,lng))`), roster names, and **Leave** (non-host).
  - Cancelled/waitlisted states mirror web copy.
- **My Games**: `my_games` → upcoming/past sections.
- **Profile (read-only)**: own `profile_stats` + `profiles` (self_reported_skill, phone/photo/id_verified) → tier badge (peer/self) + verification badges + stat tiles (karma, games, avg skill, no-shows, reliability). No payouts/identity/edit/blocked-management in v1.

### 3.5 Design system (`apps/mobile/theme.ts`)
Exported color/spacing/radius/typography constants matching the web tokens; shared RN primitives (`Badge`, `Button`, `Pill`, `Screen`) as needed. Fonts via `expo-google-fonts` (Anton, Inter), loaded in the root layout with a splash hold until ready.

## 4. Data Model / Backend

No table changes. **One additive RPC** (migration `0018_phone_verify_rpc.sql`):

- `mark_phone_verified()` — `security definer`, `set search_path = public`, granted to `authenticated`:
  ```sql
  update profiles
     set phone_verified = true,
         verification_level = case when verification_level = 'none' then 'phone' else verification_level end,
         updated_at = now()
   where id = auth.uid();
  ```
  Rationale: the 0017 lockdown made `phone_verified` non-client-writable; web flips it via a service-role server action, which the app can't do. Phone verification is a dev stub (code `000000`, anyone can enter it), so an authenticated user setting their **own** `phone_verified` is consistent with the current threat model. It uses `auth.uid()` (a user can only verify themselves) and never downgrades an existing `photo`/`id` level. `id_verified`/`photo_verified` remain writable ONLY by the service-role webhook via `mark_identity_verified` — unchanged. When real SMS OTP replaces the stub, verification moves to a provider-validated path and this dev RPC is removed.
  (The existing web `verifyPhoneAction` service-role path may later be switched to this RPC for a single code path, but that is out of scope here.)

## 5. Shared Logic (`packages/core`)

Reused as-is: `signUpSchema`, `otpSchema`, `friendlyAuthError`, `friendlyGameError`, distance/format helpers, `computeTier`/`MIN_RATINGS_FOR_TIER`/`meetsBand`, `verificationSummary`, `googleDirectionsUrl`, band/format constants. No additions expected; if a genuinely shared, pure helper is missing it goes in core (not the app).

## 6. Secrets / Config

- `apps/mobile/.env` (gitignored): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. An `.env.example` documents them. `EXPO_PUBLIC_*` values are embedded in the JS bundle (public) — acceptable for the publishable anon key only.
- No Google Maps key needed in v1 (external Maps deep link, no embedded map).

## 7. Testing

- `packages/core` logic is already unit-tested (67 tests) and is the correctness-bearing layer.
- The RN app is validated by **`tsc --noEmit` (strict)** + **on-device smoke in Expo Go**: sign-up→verify→discover→join→reveal→leave, My Games, Profile. Precise-location gate re-checked on device (address absent before join, present after).
- RN component/integration tests are deferred (Expo testing setup is heavy for v1).

## 8. Definition of Done

- [ ] `apps/mobile` runs in Expo Go on a device; Metro resolves `@footylocal/core` from source (a real core function is called on screen).
- [ ] Auth: sign-up (18+), sign-in (friendly errors), session persists across restarts (AsyncStorage), verify-phone flips `phone_verified` via `mark_phone_verified`.
- [ ] Discover lists nearby games (location + `games_near` + filters + distance); no map.
- [ ] Game detail shows host tier + verification badges; Join/Leave via `join_game`/`leave_game`; free-join only (paid disabled); Reveal shows address + Open-in-Maps only after joining.
- [ ] My Games (upcoming/past) + read-only Profile (tier + verification badges + stats).
- [ ] `mark_phone_verified` RPC: definer, `auth.uid()`-scoped, no downgrade, granted to authenticated; applied live; migration replays idempotently; `id_verified`/`photo_verified` still not client-writable.
- [ ] Service-role key absent from `apps/mobile`; `packages/db` not imported; anon key only.
- [ ] TS strict passes for `apps/mobile`; `packages/core` tests still green.
- [ ] Nike tokens + Anton/Inter applied.
