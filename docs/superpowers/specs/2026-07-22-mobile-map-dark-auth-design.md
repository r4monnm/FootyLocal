# Mobile: Discover Map + Dark Theme + Reference Auth Screens — Design

Date: 2026-07-22
Branch: `mobile-v1-joiner-loop`
Status: approved by user, building

## Goal

Two user-driven changes to the Expo app:

1. A **map on Discover** showing where games are.
2. The **auth screens restyled** to a supplied reference: dark surface, green
   glow, pill inputs, lime gradient CTA. Approved to extend the dark theme to
   the whole app so there is no light/dark whiplash between auth and tabs.

Plus one approved add-on: a **reveal mini-map on game detail** at the precise
pitch, once the viewer has joined (web parity).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Map library | `react-native-maps` | Ships inside Expo Go for SDK 57 (Apple Maps on iOS, no API key in dev). `expo-maps` would force an EAS development build and break the Expo Go smoke path. |
| Discover layout | Map top ~40%, list below | Matches web Discover; user-selected. |
| Theme scope | Whole app dark | Auth and tabs read as one product. |
| Social sign-in | Omitted | No OAuth providers configured in Supabase; buttons that error are worse than absent. |
| Clustering | Omitted in v1 | Web's clusterer earns its keep at density we do not have. |

## Safety: the load-bearing constraint

The precise pitch must never reach a non-roster client. `games_near` returns
both `public_lat/lng` (deterministically fuzzed) and `precise_lat/lng` (NULL
unless the caller is on the roster).

**The Discover map plots `public_lat`/`public_lng` only — unconditionally, with
no roster branch**, even for games the viewer has joined. One rule, no
conditional that could regress into a leak. The precise location appears in
exactly one place: the game detail screen, behind the existing join gate, fed
by `game_detail` (which already NULLs the coordinates off-roster).

No DB migration. No RPC change. This is a client-rendering change only.

## A. Discover map

- `MapView` in the upper pane, `userInterfaceStyle="dark"` (iOS) to match theme.
- Initial region from `expo-location`; re-fit to returned games when the set
  changes.
- One `Marker` per game at its public (fuzzed) coordinate.
- Tapping a pin selects the game and scrolls the list to that card; tapping a
  card selects its pin. Selection is a single piece of state shared by both.
- Filters continue to drive the query; both panes render the same rows.
- List becomes a `FlatList` in the lower pane rather than the whole page.
- The mobile `Row` type gains `public_lat` / `public_lng` (already returned by
  the RPC, previously just not typed). `precise_*` are deliberately NOT added
  to the Discover row type — if the field is not in the type, it cannot be
  plotted by accident.

## B. Dark theme

Token flip in `theme.ts`; every screen already draws from it and from
`components/ui.tsx`, so this propagates without touching most screens.

| Token | Before | After |
|---|---|---|
| `surface` | `#FFFFFF` | `#0B0F0A` (near-black, green cast) |
| `gray` | `#F5F5F5` | `#1A1F17` (elevated card) |
| `ink` | `#111111` | `#F2F5EF` (primary text / inverted button bg) |
| `muted` | `#8A8A8A` | `#9AA694` |
| `accent` | `#CCFF00` | unchanged (already the reference's family) |

`ink` currently does double duty as text color and primary-button background.
New explicit tokens (`onAccent`, `border`, `glow`, `accentDeep`) so nothing
depends on that coincidence.

New dependency: `expo-linear-gradient` (in Expo Go) for the lime gradient CTA
and the green top glow.

## C. Auth screens

Per the reference: centered **FOOTYLOCAL** wordmark (Anton), green glow bleeding
from the top edge, centered heading + one line of subtext, dark pill inputs with
the label inside as placeholder, full-width lime gradient CTA, footer link.

- Password fields get a show/hide eye toggle.
- Sign-up keeps the 18+ checkbox, restyled — a legal gate, not decoration.
- `verify-phone` gets the same treatment so the flow is consistent.

New/changed primitives in `components/ui.tsx`: `AuthScreen` (glow + centered
column), `Wordmark`, `GradientButton`, `PillField` (with `secureToggle`),
`Checkbox`. Existing primitives keep their names and signatures so the tab
screens keep working.

## D. Game detail reveal mini-map

Inside the existing `viewer_joined` branch only, a non-interactive `MapView`
(~180pt) centered on `precise_lat/lng` with a single marker, above the existing
"Open in Maps" button. Renders only when both coordinates are non-null, so an
off-roster viewer renders nothing.

## Verification

- `pnpm --filter @footylocal/mobile typecheck` clean.
- `npx expo export` bundles.
- `packages/core` 67 tests still green (no core changes expected).
- Simulator screenshots of sign-in, sign-up, and Discover-with-map.
- Re-assert the safety property by reading the built Discover source: no
  reference to `precise_` anywhere in the Discover screen.
