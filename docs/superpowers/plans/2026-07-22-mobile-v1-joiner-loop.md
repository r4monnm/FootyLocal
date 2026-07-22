# FootyLocal Mobile v1 (Joiner Loop) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable Expo (React Native) app `apps/mobile` — the player loop: sign up → verify phone → discover nearby games → join → see the exact pitch — reusing `packages/core` and the existing Supabase RPCs, running in Expo Go.

**Architecture:** Expo managed workflow + Expo Router (file-based), TypeScript strict, in the existing pnpm/Turborepo monorepo. A Supabase **anon** client (AsyncStorage session, AppState auto-refresh) calls the same `games_near`/`game_detail`/`join_game`/`leave_game`/`my_games`/`profile_stats` RPCs (all safety gates stay server-side). `packages/core` is reused verbatim; `packages/db` (service-role) is never imported. One additive backend RPC (`mark_phone_verified`, migration 0018) bridges the 0017 lockdown for the phone-verify dev stub.

**Tech Stack:** Expo (latest SDK), Expo Router, React Native, TypeScript strict, `@supabase/supabase-js` + `@react-native-async-storage/async-storage` + `react-native-url-polyfill`, `expo-location`, `@expo-google-fonts/anton` + `@expo-google-fonts/inter`, Vitest (core, already green).

## Global Constraints

- **TS strict, no `any`** without justification.
- **Never trust the client:** all authorization/reveal gates live in the DB RPCs (unchanged). The app only *renders* what the RPC returns. **Precise location comes only from `game_detail` after joining** — the app must not fetch or synthesize it another way.
- **Anon key only.** Use `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The **service-role key must never appear in `apps/mobile`**, and **`packages/db` must never be imported by the app**.
- **Reuse `packages/core` verbatim** (schemas, tiers, verification, distance/error helpers, `googleDirectionsUrl`). No mobile fork of domain logic; a genuinely-shared new pure helper goes in `core`, not the app.
- **Design tokens (Nike):** ink `#111111`, surface `#FFFFFF`, gray `#F5F5F5`, volt accent `#CCFF00`; pill/rounded; uppercase condensed headlines (Anton) + Inter body.
- **Runs in Expo Go** — no custom native modules (no `react-native-maps`); external Maps via `Linking`.
- Package name `@footylocal/mobile`. Frequent commits: each task ends committed.
- **Verification model:** implementers verify with `tsc --noEmit` (strict) and, where noted, `npx expo export` (Metro bundle succeeds — this catches monorepo/resolution breakage without a device). **On-device Expo Go smoke is the human's final acceptance, not an implementer step** — do not block a task on device testing.

---

## RPC Contracts (verified — bind screens to these exactly)

- `games_near(lat float8, lng float8, radius_meters int, filters jsonb)` → rows: `id, title, skill_band, format, price_cents, starts_at, is_women_only, max_players, joined_count(bigint), host_name, public_lat, public_lng, precise_lat, precise_lng, distance_meters`. Granted anon+authenticated. Filters jsonb via `toGamesNearFilters(DiscoverFilters)`.
- `game_detail(p_game_id uuid)` → one row: `id, title, description, skill_band, format, price_cents, starts_at, ends_at, is_women_only, max_players, min_players_to_confirm, status, host_id, host_name, venue_name, venue_address, surface_type, public_lat, public_lng, joined_count(bigint), viewer_joined(bool), viewer_status(text), precise_lat, precise_lng, roster(jsonb: [{player_id,name,role}])`. `precise_*`/`roster` are non-null only when the viewer is joined. Granted anon+authenticated.
- `join_game(p_game_id uuid)` → `text` (e.g. `joined`/`waitlisted`/`full`/error). authenticated.
- `leave_game(p_game_id uuid)` → row `(payment_intent_id, paid, starts_at, was_joined)`. authenticated. (v1 ignores payment fields; refetch detail after.)
- `my_games()` → rows: `id, title, starts_at, ends_at, venue_name, role, is_past(bool), status, player_status`. authenticated.
- `profile_stats(p_user_id uuid)` → one row: `games_played, karma, avg_skill(numeric), ratings_count, attended, no_shows, reliability(numeric)`. Granted anon+authenticated.
- `profiles` (anon-readable cols): `display_name, phone_verified, photo_verified, id_verified, self_reported_skill, verification_level, ...`.

## core exports used

`signUpSchema` (email, password≥10, is18Plus:true), `otpSchema` ({code:/^\d{6}$/}), `friendlyAuthError`, `friendlyGameError`, `computeTier`, `MIN_RATINGS_FOR_TIER`, `verificationSummary`, `googleDirectionsUrl`, `roundPublicDistance(meters)→string`, `toGamesNearFilters`, `type DiscoverFilters`, `SKILL_BANDS`, `GAME_BANDS`, `GAME_FORMATS`, `type SkillBand`, `type GameBand`.

---

## File Structure

```
apps/mobile/
  package.json  app.json  tsconfig.json  metro.config.js  babel.config.js  .env.example  .gitignore
  theme.ts                     # tokens + typography
  components/ui.tsx            # Badge, Button, Pill, Screen, Field, StatTile
  lib/supabase.ts              # anon client (AsyncStorage + AppState refresh)
  lib/session.tsx              # SessionProvider + useSession (auth state)
  app/_layout.tsx              # fonts + SessionProvider + auth routing gate
  app/(auth)/sign-in.tsx
  app/(auth)/sign-up.tsx
  app/(auth)/verify-phone.tsx
  app/(tabs)/_layout.tsx       # bottom tabs: Discover · My Games · Profile
  app/(tabs)/discover.tsx
  app/(tabs)/my-games.tsx
  app/(tabs)/profile.tsx
  app/game/[id].tsx
packages/db/migrations/sql/0018_phone_verify_rpc.sql   # mark_phone_verified
```

---

### Task 1: Scaffold Expo app + monorepo Metro config + core-import smoke

**Files:** create `apps/mobile/*` (package.json, app.json, tsconfig.json, metro.config.js, babel.config.js, .gitignore, .env.example, `app/_layout.tsx`, `app/index.tsx`).

**Interfaces:** Produces a bootable Expo Router app in the workspace where `import { roundPublicDistance } from "@footylocal/core"` resolves from TS source.

**This is the exploratory toolchain task.** Scaffold with the current Expo SDK, then adjust the monorepo config empirically until `npx expo export` succeeds. Report the exact SDK version and any deviation.

- [x] **Step 1: Scaffold** into `apps/mobile` (from repo root):
```bash
pnpm create expo-app apps/mobile --template blank-typescript --no-install
```
Then set `apps/mobile/package.json` name to `@footylocal/mobile`, add `"@footylocal/core": "workspace:*"` to dependencies, and add scripts:
```json
"scripts": { "start": "expo start", "typecheck": "tsc --noEmit", "export": "expo export --platform ios --output-dir /tmp/footylocal-mobile-export" }
```
Convert to Expo Router: add deps `expo-router`, `react-native-safe-area-context`, `react-native-screens`, and set `"main": "expo-router/entry"` in package.json. Add to `app.json` `expo`: `"scheme": "footylocal"`, and `"plugins": ["expo-router"]`. Remove the template `App.tsx` (Expo Router uses `app/`).

- [x] **Step 2: Metro monorepo config** — `apps/mobile/metro.config.js`:
```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

// packages/core uses ESM-style ".js" extensions on its .ts source imports
// (e.g. "./skill/index.js"). Resolve those to the real .ts files.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (e) {
    if (moduleName.endsWith(".js")) {
      return context.resolveRequest(context, moduleName.replace(/\.js$/, ".ts"), platform);
    }
    throw e;
  }
};

module.exports = config;
```
`babel.config.js`:
```js
module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
```

- [x] **Step 3: tsconfig strict** — `apps/mobile/tsconfig.json`:
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": { "strict": true, "jsx": "react-jsx", "skipLibCheck": true },
  "include": ["app", "components", "lib", "theme.ts", "*.ts", "*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

- [x] **Step 4: `.gitignore` + `.env.example`** — `apps/mobile/.gitignore` must include `.env`, `.expo/`, `node_modules/`, `/tmp` export dirs. `.env.example`:
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```
Create the real gitignored `apps/mobile/.env` by copying the URL + anon key from the repo-root `.env` (`NEXT_PUBLIC_SUPABASE_URL` → `EXPO_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `EXPO_PUBLIC_SUPABASE_ANON_KEY`). **Never** copy the service-role key.

- [x] **Step 5: Core-import smoke screen** — `apps/mobile/app/_layout.tsx`:
```tsx
import { Stack } from "expo-router";
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```
`apps/mobile/app/index.tsx`:
```tsx
import { Text, View } from "react-native";
import { roundPublicDistance } from "@footylocal/core";
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>FootyLocal — core says: {roundPublicDistance(1234)}</Text>
    </View>
  );
}
```

- [x] **Step 6: Install + verify Metro bundles** (from repo root):
```bash
pnpm install
pnpm --filter @footylocal/mobile typecheck
cd apps/mobile && npx expo export --platform ios --output-dir /tmp/fl-export && cd -
```
Expected: typecheck clean; `expo export` completes without a resolution error for `@footylocal/core` (proves Metro resolves the workspace TS source incl. its `.js` imports). **If pnpm's symlinked layout breaks Metro**, the accepted fallback is adding `node-linker=hoisted` to the repo-root `.npmrc` and re-installing — if you do this, REPORT it as a concern (it changes install strategy repo-wide; the web app must still `pnpm --filter @footylocal/web build`). Prefer the symlinked approach if it works.

- [x] **Step 7: Commit**
```bash
git add -A && git commit -m "feat(mobile): scaffold Expo Router app + monorepo Metro config + core import"
```

---

### Task 2: Theme tokens + UI primitives + fonts

**Files:** create `apps/mobile/theme.ts`, `apps/mobile/components/ui.tsx`; modify `apps/mobile/app/_layout.tsx` (load fonts).

**Interfaces:** Produces `theme` (colors/spacing/radius), and components `Screen`, `Badge`, `Button`, `Pill`, `Field`, `StatTile` used by all screens.

- [x] **Step 1: Fonts deps** — add `expo-font`, `@expo-google-fonts/anton`, `@expo-google-fonts/inter`, `expo-splash-screen`; `pnpm install`.

- [x] **Step 2: `theme.ts`**
```ts
export const colors = {
  ink: "#111111",
  surface: "#FFFFFF",
  gray: "#F5F5F5",
  accent: "#CCFF00",
  muted: "#8A8A8A",
  error: "#E5484D",
  success: "#30A46C",
};
export const radius = { pill: 999, card: 16 };
export const space = (n: number) => n * 4;
export const font = { display: "Anton_400Regular", body: "Inter_400Regular", bodySemibold: "Inter_600SemiBold" };
```

- [x] **Step 3: `components/ui.tsx`** (complete primitives)
```tsx
import { ReactNode } from "react";
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, space, font } from "../theme";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ padding: space(6), gap: space(5) }}>{children}</ScrollView>
    </SafeAreaView>
  );
}
export function Title({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: font.display, fontSize: 44, color: colors.ink, textTransform: "uppercase" }}>{children}</Text>;
}
export function Badge({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "accent" }) {
  const bg = tone === "accent" ? colors.accent : colors.ink;
  const fg = tone === "accent" ? colors.ink : colors.surface;
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: space(3), paddingVertical: space(1.5), alignSelf: "flex-start" }}>
      <Text style={{ color: fg, fontFamily: font.bodySemibold, fontSize: 12, textTransform: "uppercase" }}>{children}</Text>
    </View>
  );
}
export function Button({ label, onPress, variant = "primary", disabled }: { label: string; onPress?: () => void; variant?: "primary" | "accent" | "outline"; disabled?: boolean }) {
  const styles = variant === "accent" ? { bg: colors.ink, fg: colors.accent } : variant === "outline" ? { bg: colors.surface, fg: colors.ink } : { bg: colors.ink, fg: colors.surface };
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={{ backgroundColor: styles.bg, borderColor: colors.ink, borderWidth: variant === "outline" ? 1 : 0, borderRadius: radius.pill, paddingVertical: space(4), paddingHorizontal: space(8), alignItems: "center", opacity: disabled ? 0.4 : 1 }}>
      <Text style={{ color: styles.fg, fontFamily: font.bodySemibold, fontSize: 14, textTransform: "uppercase" }}>{label}</Text>
    </Pressable>
  );
}
export function Field(props: TextInputProps & { label: string }) {
  const { label, ...rest } = props;
  return (
    <View style={{ gap: space(1) }}>
      <Text style={{ fontSize: 12, textTransform: "uppercase", color: colors.muted, fontFamily: font.bodySemibold }}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={{ backgroundColor: colors.gray, borderRadius: radius.card, padding: space(3), fontFamily: font.body, color: colors.ink }} {...rest} />
    </View>
  );
}
export function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={{ backgroundColor: colors.gray, borderRadius: radius.card, padding: space(4), alignItems: "center", flex: 1 }}>
      <Text style={{ fontFamily: font.display, fontSize: 28, color: colors.ink }}>{value}</Text>
      <Text style={{ fontSize: 11, textTransform: "uppercase", color: colors.muted }}>{label}</Text>
    </View>
  );
}
export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.muted, fontFamily: font.body }}>{children}</Text>;
}
export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.error, fontFamily: font.body }}>{children}</Text>;
}
const _s = StyleSheet.create({});
```

- [x] **Step 4: Load fonts in `_layout.tsx`** (replace Task 1's `_layout`):
```tsx
import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Anton_400Regular } from "@expo-google-fonts/anton";
import { Inter_400Regular, Inter_600SemiBold } from "@expo-google-fonts/inter";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({ Anton_400Regular, Inter_400Regular, Inter_600SemiBold });
  useEffect(() => { if (loaded) SplashScreen.hideAsync(); }, [loaded]);
  if (!loaded) return null;
  return <Stack screenOptions={{ headerShown: false }} />;
}
```
(The session gate is layered on in Task 3.)

- [x] **Step 5: Verify + commit**
```bash
pnpm --filter @footylocal/mobile typecheck
git add -A && git commit -m "feat(mobile): Nike theme tokens, UI primitives, Anton/Inter fonts"
```

---

### Task 3: Supabase anon client + session gate + sign-in / sign-up

**Files:** create `apps/mobile/lib/supabase.ts`, `apps/mobile/lib/session.tsx`, `apps/mobile/app/(auth)/sign-in.tsx`, `apps/mobile/app/(auth)/sign-up.tsx`; modify `app/_layout.tsx` (wrap in SessionProvider + routing), delete `app/index.tsx`.

**Interfaces:** Produces `supabase` (anon client), `useSession()` → `{ session, loading }`, and the auth routing gate.

- [x] **Step 1: Deps** — add `@supabase/supabase-js`, `@react-native-async-storage/async-storage`, `react-native-url-polyfill`; `pnpm install`.

- [x] **Step 2: `lib/supabase.ts`**
```ts
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anonKey, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
```

- [x] **Step 3: `lib/session.tsx`**
```tsx
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const Ctx = createContext<{ session: Session | null; loading: boolean }>({ session: null, loading: true });
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return <Ctx.Provider value={{ session, loading }}>{children}</Ctx.Provider>;
}
```

- [x] **Step 4: Auth routing in `_layout.tsx`** — wrap the `Stack` and redirect by session. Replace the `_layout` body with:
```tsx
import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Anton_400Regular } from "@expo-google-fonts/anton";
import { Inter_400Regular, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { SessionProvider, useSession } from "../lib/session";

SplashScreen.preventAutoHideAsync();

function Gate() {
  const { session, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === "(auth)";
    if (!session && !inAuth) router.replace("/(auth)/sign-in");
    else if (session && inAuth) router.replace("/(tabs)/discover");
  }, [session, loading, segments]);
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Anton_400Regular, Inter_400Regular, Inter_600SemiBold });
  useEffect(() => { if (fontsLoaded) SplashScreen.hideAsync(); }, [fontsLoaded]);
  if (!fontsLoaded) return null;
  return <SessionProvider><Gate /></SessionProvider>;
}
```
Delete `app/index.tsx` (routing now targets `(auth)`/`(tabs)`).

- [x] **Step 5: `app/(auth)/sign-in.tsx`**
```tsx
import { useState } from "react";
import { useRouter, Link } from "expo-router";
import { friendlyAuthError } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { Screen, Title, Field, Button, ErrorText, Muted } from "../../components/ui";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(friendlyAuthError(error.message));
    else router.replace("/(tabs)/discover");
  }
  return (
    <Screen>
      <Title>Sign in</Title>
      {error && <ErrorText>{error}</ErrorText>}
      <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <Button label={busy ? "…" : "Sign in"} onPress={submit} disabled={busy} variant="accent" />
      <Link href="/(auth)/sign-up"><Muted>New here? Create an account →</Muted></Link>
    </Screen>
  );
}
```

- [x] **Step 6: `app/(auth)/sign-up.tsx`** (18+ required via `signUpSchema`)
```tsx
import { useState } from "react";
import { Pressable, View, Text } from "react-native";
import { useRouter, Link } from "expo-router";
import { signUpSchema, friendlyAuthError } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { Screen, Title, Field, Button, ErrorText, Muted } from "../../components/ui";
import { colors, space } from "../../theme";

export default function SignUp() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [is18, setIs18] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    const parsed = signUpSchema.safeParse({ email, password, is18Plus: is18 });
    if (!parsed.success) { setError(parsed.error.issues[0]!.message); return; }
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { is_18_plus: true } } });
    setBusy(false);
    if (error) setError(friendlyAuthError(error.message));
    else router.replace("/(auth)/verify-phone");
  }
  return (
    <Screen>
      <Title>Create account</Title>
      {error && <ErrorText>{error}</ErrorText>}
      <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <Field label="Password (min 10 chars)" secureTextEntry value={password} onChangeText={setPassword} />
      <Pressable onPress={() => setIs18(!is18)} style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.ink, backgroundColor: is18 ? colors.accent : colors.surface }} />
        <Text style={{ color: colors.ink }}>I confirm I am 18 or older</Text>
      </Pressable>
      <Button label={busy ? "…" : "Create account"} onPress={submit} disabled={busy} variant="accent" />
      <Link href="/(auth)/sign-in"><Muted>Already have an account? Sign in →</Muted></Link>
    </Screen>
  );
}
```
Note: Supabase may require email confirmation OFF for an immediate session (it is OFF for this project — see Phase 0 followups). If no session is returned, the gate keeps the user in `(auth)`; that is acceptable.

- [x] **Step 7: Verify + commit**
```bash
pnpm --filter @footylocal/mobile typecheck
git add -A && git commit -m "feat(mobile): Supabase anon client, session gate, sign-in/sign-up (18+)"
```

---

### Task 4: `mark_phone_verified` RPC (migration 0018) + verify-phone screen

**Files:** create `packages/db/migrations/sql/0018_phone_verify_rpc.sql`, `apps/mobile/app/(auth)/verify-phone.tsx`.

**Interfaces:** Produces the RPC `mark_phone_verified()` and the verify-phone screen calling it.

- [x] **Step 1: `packages/db/migrations/sql/0018_phone_verify_rpc.sql`**
```sql
-- Phone verification for clients without a server action (the native app).
-- 0017 made phone_verified non-client-writable; web flips it via a service-role
-- server action, which the app can't do. Phone verification is a DEV STUB (code
-- 000000, anyone can enter it), so an authenticated user setting their OWN
-- phone_verified is consistent with the current threat model. Uses auth.uid()
-- (self only) and never downgrades an existing photo/id verification_level.
-- id_verified/photo_verified remain writable ONLY by the service-role webhook
-- via mark_identity_verified — unchanged. Replaced by real SMS OTP later.
create or replace function mark_phone_verified()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
     set phone_verified = true,
         verification_level = case when verification_level = 'none' then 'phone' else verification_level end,
         updated_at = now()
   where id = auth.uid();
end;
$$;

revoke execute on function mark_phone_verified() from public, anon;
grant execute on function mark_phone_verified() to authenticated;
```

- [x] **Step 2: Apply live + smoke** (from repo root, env sourced):
```bash
set -a; . ./.env; set +a
pnpm --filter @footylocal/db sql
```
Then a temp `.ts` smoke (write file, run, delete — `tsx -e` fails in this repo). Verify with the `postgres` client (as scripts/apply-sql.ts) that `authenticated` HAS execute on `mark_phone_verified` and that `id_verified` is still NOT client-updatable (unchanged from 0017): `has_function_privilege('authenticated','mark_phone_verified()','EXECUTE')` → true; `has_column_privilege('authenticated','profiles','id_verified','UPDATE')` → false. Full `pnpm sql` replay (0000–0018) must be clean.

- [x] **Step 3: `app/(auth)/verify-phone.tsx`** (dev OTP 000000)
```tsx
import { useState } from "react";
import { useRouter } from "expo-router";
import { otpSchema } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { Screen, Title, Field, Button, ErrorText, Muted } from "../../components/ui";

export default function VerifyPhone() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    const parsed = otpSchema.safeParse({ code });
    if (!parsed.success) { setError(parsed.error.issues[0]!.message); return; }
    if (code !== "000000") { setError("Invalid code"); return; } // dev stub
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("mark_phone_verified");
    setBusy(false);
    if (error) setError("Couldn't verify. Try again.");
    else router.replace("/(tabs)/discover");
  }
  return (
    <Screen>
      <Title>Verify phone</Title>
      <Muted>Enter 000000 (dev). Real SMS comes later.</Muted>
      {error && <ErrorText>{error}</ErrorText>}
      <Field label="6-digit code" keyboardType="number-pad" value={code} onChangeText={setCode} maxLength={6} />
      <Button label={busy ? "…" : "Verify"} onPress={submit} disabled={busy} variant="accent" />
      <Button label="Skip for now" onPress={() => router.replace("/(tabs)/discover")} variant="outline" />
    </Screen>
  );
}
```
(Skip lets an unverified user browse; Join is gated in Task 6.)

- [x] **Step 4: Verify + commit**
```bash
pnpm --filter @footylocal/mobile typecheck && pnpm --filter @footylocal/db typecheck
git add -A && git commit -m "feat(mobile,db): mark_phone_verified RPC (0018) + verify-phone screen"
```

---

### Task 5: Tabs layout + Discover (location + games_near)

**Files:** create `apps/mobile/app/(tabs)/_layout.tsx`, `apps/mobile/app/(tabs)/discover.tsx`.

**Interfaces:** Produces the bottom-tab navigator (Discover · My Games · Profile) and the Discover list.

- [x] **Step 1: Deps** — add `expo-location`; `pnpm install`.

- [x] **Step 2: `app/(tabs)/_layout.tsx`**
```tsx
import { Tabs } from "expo-router";
import { colors } from "../../theme";
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.ink, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.surface } }}>
      <Tabs.Screen name="discover" options={{ title: "Discover" }} />
      <Tabs.Screen name="my-games" options={{ title: "My Games" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
```

- [x] **Step 3: `app/(tabs)/discover.tsx`** (location → games_near → list)
```tsx
import { useCallback, useState } from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { toGamesNearFilters, roundPublicDistance, GAME_BANDS, type DiscoverFilters, type GameBand } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { Title, Badge, Muted } from "../../components/ui";
import { colors, radius, space, font } from "../../theme";
import { SafeAreaView } from "react-native-safe-area-context";

type Row = {
  id: string; title: string; skill_band: string; format: string; price_cents: number;
  starts_at: string; is_women_only: boolean; max_players: number; joined_count: number;
  host_name: string | null; distance_meters: number;
};

export default function Discover() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [filters, setFilters] = useState<DiscoverFilters>({ radiusMeters: 20000 });
  const [status, setStatus] = useState<string>("Finding games near you…");

  const load = useCallback(async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") { setStatus("Location permission needed to find nearby games."); return; }
    const pos = await Location.getCurrentPositionAsync({});
    const { data, error } = await supabase.rpc("games_near", {
      lat: pos.coords.latitude, lng: pos.coords.longitude,
      radius_meters: filters.radiusMeters, filters: toGamesNearFilters(filters),
    });
    if (error) { setStatus("Couldn't load games."); return; }
    const list = (data ?? []) as Row[];
    setRows(list); setStatus(list.length ? "" : "No games nearby. Widen your search.");
  }, [filters]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ padding: space(6), gap: space(4), flex: 1 }}>
        <Title>Discover</Title>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
          {(["", ...GAME_BANDS] as (GameBand | "")[]).map((b) => {
            const active = (filters.skillBand ?? "") === b;
            return (
              <Pressable key={b || "all"} onPress={() => setFilters({ ...filters, skillBand: (b || undefined) as GameBand | undefined })}
                style={{ backgroundColor: active ? colors.ink : colors.gray, borderRadius: radius.pill, paddingHorizontal: space(3), paddingVertical: space(1.5) }}>
                <Text style={{ color: active ? colors.surface : colors.ink, fontSize: 11, textTransform: "uppercase", fontFamily: font.bodySemibold }}>{b || "All"}</Text>
              </Pressable>
            );
          })}
        </View>
        {status ? <Muted>{status}</Muted> : null}
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ gap: space(3), paddingBottom: space(10) }}
          renderItem={({ item }) => {
            const spots = item.max_players - Number(item.joined_count);
            return (
              <Pressable onPress={() => router.push(`/game/${item.id}`)}
                style={{ backgroundColor: colors.gray, borderRadius: radius.card, padding: space(4), gap: space(1) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontFamily: font.display, fontSize: 22, color: colors.ink }}>{item.title}</Text>
                  <Badge tone="accent">{item.skill_band}</Badge>
                </View>
                <Muted>{item.host_name ?? "—"} · {roundPublicDistance(item.distance_meters)} away</Muted>
                <Muted>{spots} of {item.max_players} spots · {item.price_cents > 0 ? `$${(item.price_cents / 100).toFixed(0)}` : "Free"}</Muted>
              </Pressable>
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}
```
Also add `expo-location` permission strings to `app.json` (`ios.infoPlist.NSLocationWhenInUseUsageDescription`, `android.permissions` includes `ACCESS_FINE_LOCATION`) via the `expo-location` config plugin: add `["expo-location", { "locationWhenInUsePermission": "FootyLocal shows games near you." }]` to `plugins`.

- [x] **Step 4: Verify + commit**
```bash
pnpm --filter @footylocal/mobile typecheck
cd apps/mobile && npx expo export --platform ios --output-dir /tmp/fl-export2 && cd -
git add -A && git commit -m "feat(mobile): tabs + Discover (location + games_near list + filters)"
```
(`expo export` re-run here confirms the new native dep `expo-location` still bundles.)

---

### Task 6: Game detail + Join/Leave + Reveal

**Files:** create `apps/mobile/app/game/[id].tsx`.

**Interfaces:** Consumes `game_detail`, `join_game`, `leave_game`, `profile_stats`, `profiles`; `computeTier`, `verificationSummary`, `googleDirectionsUrl`, `friendlyGameError`.

- [x] **Step 1: `app/game/[id].tsx`** (complete)
```tsx
import { useCallback, useState } from "react";
import { View, Text, Linking } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect, Link } from "expo-router";
import { computeTier, verificationSummary, googleDirectionsUrl, friendlyGameError, type SkillBand } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { Screen, Title, Badge, Button, Muted, ErrorText } from "../../components/ui";
import { colors, space, font } from "../../theme";

type Detail = {
  id: string; title: string; description: string | null; skill_band: string; format: string;
  price_cents: number; starts_at: string; ends_at: string; status: string; max_players: number;
  min_players_to_confirm: number; host_id: string; host_name: string | null;
  venue_name: string; venue_address: string; surface_type: string; joined_count: number;
  viewer_joined: boolean; viewer_status: string | null;
  precise_lat: number | null; precise_lng: number | null;
  roster: { player_id: string; name: string | null; role: string }[] | null;
};
const VERIF_LABEL: Record<"phone" | "photo" | "id", string> = { phone: "Phone ✓", photo: "Photo ✓", id: "ID ✓" };

export default function GameDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [game, setGame] = useState<Detail | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [hostBand, setHostBand] = useState<string>("");
  const [hostBadges, setHostBadges] = useState<("phone" | "photo" | "id")[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("game_detail", { p_game_id: id });
    const g = (data?.[0] ?? null) as Detail | null;
    setGame(g);
    if (!g) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: me } = await supabase.from("profiles").select("phone_verified").eq("id", user.id).single();
      setPhoneVerified(me?.phone_verified ?? false);
    }
    const [{ data: s }, { data: hp }] = await Promise.all([
      supabase.rpc("profile_stats", { p_user_id: g.host_id }),
      supabase.from("profiles").select("self_reported_skill, phone_verified, photo_verified, id_verified").eq("id", g.host_id).single(),
    ]);
    const stat = s?.[0];
    setHostBand(computeTier(stat?.avg_skill != null ? Number(stat.avg_skill) : null, stat ? Number(stat.ratings_count) : 0, (hp?.self_reported_skill ?? null) as SkillBand | null).band);
    setHostBadges(verificationSummary({ phone_verified: hp?.phone_verified ?? false, photo_verified: hp?.photo_verified ?? false, id_verified: hp?.id_verified ?? false }).badges);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function join() {
    setBusy(true); setError(null);
    const { data, error } = await supabase.rpc("join_game", { p_game_id: id });
    setBusy(false);
    if (error) setError(friendlyGameError(error.message));
    else if (typeof data === "string" && !["joined", "waitlisted"].includes(data)) setError(friendlyGameError(data));
    else load();
  }
  async function leave() {
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("leave_game", { p_game_id: id });
    setBusy(false);
    if (error) setError(friendlyGameError(error.message)); else load();
  }

  if (!game) return <Screen><Muted>Game not found.</Muted></Screen>;
  const spots = game.max_players - Number(game.joined_count);
  const isPaid = game.price_cents > 0;
  const isCancelled = game.status === "cancelled";
  const isWaitlisted = game.viewer_status === "waitlisted";

  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Title>{game.title}</Title>
        <Badge tone="accent">{game.skill_band}</Badge>
      </View>
      {error && <ErrorText>{error}</ErrorText>}
      <Muted>{game.venue_name}</Muted>
      <Muted>{new Date(game.starts_at).toLocaleString()}</Muted>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
        <Muted>Host: {game.host_name ?? "—"} · {hostBand.toUpperCase()}</Muted>
        {hostBadges.map((b) => <Badge key={b} tone="accent">{VERIF_LABEL[b]}</Badge>)}
      </View>
      <Muted>{spots} of {game.max_players} spots · {isPaid ? `$${(game.price_cents / 100).toFixed(0)}` : "Free"}</Muted>
      {game.status === "confirmed" && <Badge tone="accent">confirmed</Badge>}
      {isCancelled && <ErrorText>This game was cancelled.</ErrorText>}
      {game.description ? <Text style={{ color: colors.ink, fontFamily: font.body }}>{game.description}</Text> : null}

      {game.viewer_joined ? (
        <View style={{ gap: space(3) }}>
          <Text style={{ fontFamily: font.display, fontSize: 24, color: colors.ink }}>YOU'RE IN</Text>
          <Muted>{game.venue_address}</Muted>
          {game.precise_lat != null && game.precise_lng != null && (
            <Button label="Open in Maps" variant="outline" onPress={() => Linking.openURL(googleDirectionsUrl(game.precise_lat!, game.precise_lng!))} />
          )}
          <View style={{ gap: space(1) }}>
            <Muted>Roster</Muted>
            {(game.roster ?? []).map((r) => (
              <Text key={r.player_id} style={{ color: colors.ink, fontFamily: font.body }}>{r.name ?? "Player"}{r.role === "host" ? " · host" : ""}</Text>
            ))}
          </View>
          {game.host_id /* non-host can leave */ && <Button label={busy ? "…" : "Leave game"} variant="outline" onPress={leave} disabled={busy} />}
        </View>
      ) : (
        <View style={{ gap: space(3) }}>
          <Muted>Approximate area only. The exact pitch appears once you join.</Muted>
          {isCancelled ? null : isWaitlisted ? (
            <Button label={busy ? "…" : "Leave waitlist"} variant="outline" onPress={leave} disabled={busy} />
          ) : !phoneVerified ? (
            <Link href="/(auth)/verify-phone"><Text style={{ color: colors.ink, fontFamily: font.bodySemibold, textTransform: "uppercase" }}>Verify your phone to join →</Text></Link>
          ) : isPaid ? (
            <Button label="Paid join — coming to mobile" variant="accent" disabled />
          ) : (
            <Button label={busy ? "…" : spots > 0 ? "Join game" : "Join waitlist"} variant="accent" onPress={join} disabled={busy} />
          )}
        </View>
      )}
    </Screen>
  );
}
```
Note: the "Leave" control shows for any joined non-host; the host cannot leave (server `leave_game` rejects it and `friendlyGameError` surfaces the message). Keep it simple — the DB is authoritative.

- [x] **Step 2: Verify + commit**
```bash
pnpm --filter @footylocal/mobile typecheck
git add -A && git commit -m "feat(mobile): game detail + join/leave + reveal (address + open-in-maps)"
```

---

### Task 7: My Games + Profile (read-only)

**Files:** create `apps/mobile/app/(tabs)/my-games.tsx`, `apps/mobile/app/(tabs)/profile.tsx`.

**Interfaces:** Consumes `my_games`, `profile_stats`, `profiles`; `computeTier`, `verificationSummary`.

- [x] **Step 1: `app/(tabs)/my-games.tsx`**
```tsx
import { useCallback, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { supabase } from "../../lib/supabase";
import { Screen, Title, Badge, Muted } from "../../components/ui";
import { colors, radius, space, font } from "../../theme";

type Row = { id: string; title: string; starts_at: string; venue_name: string; is_past: boolean; status: string; player_status: string };

export default function MyGames() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  useFocusEffect(useCallback(() => {
    supabase.rpc("my_games").then(({ data }) => setRows((data ?? []) as Row[]));
  }, []));
  const upcoming = rows.filter((r) => !r.is_past);
  const past = rows.filter((r) => r.is_past);
  const Card = (r: Row) => (
    <Pressable key={r.id} onPress={() => router.push(`/game/${r.id}`)}
      style={{ backgroundColor: colors.gray, borderRadius: radius.card, padding: space(4), gap: space(1) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontFamily: font.display, fontSize: 20, color: colors.ink }}>{r.title}</Text>
        <Badge tone={r.status === "confirmed" ? "accent" : "ink"}>{r.player_status === "waitlisted" ? "waitlist" : r.status}</Badge>
      </View>
      <Muted>{r.venue_name} · {new Date(r.starts_at).toLocaleString()}</Muted>
    </Pressable>
  );
  return (
    <Screen>
      <Title>My Games</Title>
      <Muted>Upcoming</Muted>
      {upcoming.length ? upcoming.map(Card) : <Muted>Nothing upcoming.</Muted>}
      <Muted>Past</Muted>
      {past.length ? past.map(Card) : <Muted>No past games yet.</Muted>}
    </Screen>
  );
}
```

- [x] **Step 2: `app/(tabs)/profile.tsx`** (read-only)
```tsx
import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import { computeTier, verificationSummary, type SkillBand } from "@footylocal/core";
import { supabase } from "../../lib/supabase";
import { Screen, Title, Badge, Button, Muted, StatTile } from "../../components/ui";
import { space } from "../../theme";

const VERIF_LABEL: Record<"phone" | "photo" | "id", string> = { phone: "Phone ✓", photo: "Photo ✓", id: "ID ✓" };

export default function Profile() {
  const [name, setName] = useState<string | null>(null);
  const [band, setBand] = useState("beginner");
  const [source, setSource] = useState<"peer" | "self">("self");
  const [badges, setBadges] = useState<("phone" | "photo" | "id")[]>([]);
  const [stats, setStats] = useState({ karma: 0, games_played: 0, avg_skill: null as number | null, no_shows: 0, reliability: null as number | null });

  useFocusEffect(useCallback(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: p }, { data: s }] = await Promise.all([
        supabase.from("profiles").select("display_name, self_reported_skill, phone_verified, photo_verified, id_verified").eq("id", user.id).single(),
        supabase.rpc("profile_stats", { p_user_id: user.id }),
      ]);
      setName(p?.display_name ?? null);
      const stat = s?.[0];
      if (stat) setStats(stat);
      const t = computeTier(stat?.avg_skill != null ? Number(stat.avg_skill) : null, stat ? Number(stat.ratings_count) : 0, (p?.self_reported_skill ?? null) as SkillBand | null);
      setBand(t.band); setSource(t.source);
      setBadges(verificationSummary({ phone_verified: p?.phone_verified ?? false, photo_verified: p?.photo_verified ?? false, id_verified: p?.id_verified ?? false }).badges);
    })();
  }, []));

  return (
    <Screen>
      <Title>{name ?? "Profile"}</Title>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
        {badges.length ? badges.map((b) => <Badge key={b} tone="accent">{VERIF_LABEL[b]}</Badge>) : <Badge>unverified</Badge>}
        <Badge tone="accent">{band}</Badge>
        <Muted>{source === "peer" ? "peer-rated" : "self-rated"}</Muted>
      </View>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <StatTile label="Karma" value={Number(stats.karma)} />
        <StatTile label="Games" value={Number(stats.games_played)} />
        <StatTile label="Avg skill" value={stats.avg_skill != null ? Number(stats.avg_skill).toFixed(1) : "—"} />
      </View>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <StatTile label="No-shows" value={Number(stats.no_shows)} />
        <StatTile label="Reliability" value={stats.reliability != null ? `${Math.round(Number(stats.reliability) * 100)}%` : "—"} />
      </View>
      <Button label="Sign out" variant="outline" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
```

- [x] **Step 3: Verify + commit**
```bash
pnpm --filter @footylocal/mobile typecheck
cd apps/mobile && npx expo export --platform ios --output-dir /tmp/fl-export3 && cd -
git add -A && git commit -m "feat(mobile): My Games + read-only Profile (tier + verification badges + stats)"
```

---

## Final Verification (Definition of Done)

- [x] `pnpm --filter @footylocal/mobile typecheck` clean; `npx expo export` bundles the whole app (Metro resolves `@footylocal/core` from source); `packages/core` tests still green.
- [x] Auth: sign-up (18+), sign-in (friendly errors), session persists across restarts; verify-phone flips `phone_verified` via `mark_phone_verified`.
- [x] Discover lists nearby games (location + `games_near` + skill filter + distance); no map.
- [x] Game detail shows host tier + verification badges; free Join/Leave via RPCs; paid Join disabled; Reveal (address + Open in Maps) only after joining.
- [x] My Games (upcoming/past) + read-only Profile (tier + verification badges + stats + sign out).
- [x] Migration 0018 applied; `authenticated` can execute `mark_phone_verified`; `id_verified` still not client-writable; replay idempotent.
- [x] Service-role key absent from `apps/mobile`; `packages/db` not imported; anon key only.
- [x] Nike tokens + Anton/Inter applied.
- [ ] **Human on-device Expo Go smoke** (not an implementer gate): full loop sign-up→verify→discover→join→reveal→leave on a real phone; precise address absent before join, present after.

## Self-Review Notes (author)

- **Spec coverage:** scaffold/Metro §3.1 → T1; supabase client §3.2 → T3; session gate §3.3 → T3; screens §3.4 → T3/T4/T5/T6/T7; theme §3.5 → T2; `mark_phone_verified` §4 → T4; testing §7 → typecheck + expo export per task, on-device by human.
- **Never-trust-client:** the app only renders RPC output; precise location comes solely from `game_detail` (T6). `mark_phone_verified` is `auth.uid()`-scoped and does not touch `id_verified` (money gate) — re-verified in T4 smoke.
- **No `packages/db` / service-role:** T3 client uses anon key only; grep for `SERVICE_ROLE`/`packages/db` in `apps/mobile` should be empty (final review check).
- **Type notes:** Supabase JS has no generated Database types here (project-wide follow-up), so `.rpc`/`.from` data is cast at each call site with explicit row types — matches the web app's pattern; not blanket `any`.
- **Risk front-loaded:** T1 proves Metro monorepo resolution before any screen is built; the `node-linker=hoisted` fallback is called out with a repo-wide caveat.
- **Known follow-ups:** embedded `react-native-maps` (needs a dev build); host/paid-join/ratings/identity/messages screens; RN component tests; generated Supabase types; wire real SMS OTP (removes `mark_phone_verified` dev stub); the host-can't-leave case is handled by the DB error rather than hiding the button (cosmetic).
```
