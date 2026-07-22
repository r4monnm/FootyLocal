# FootyLocal — Phase 2c: No-show Tracking + In-app Notifications (Design Spec)

**Date:** 2026-07-21
**Status:** Approved for planning
**Scope:** Phase 2c. Time-based reminders ("game tomorrow"), external email/push delivery, per-game chat (Phase 4), and auto-expiry of unconfirmed games (scheduler) are out of scope.

## 1. Goal

Close the reliability loop: **in-app, event-driven notifications** (game confirmed / spot opened / game cancelled) and **host-marked attendance** (no-show tracking) feeding a computed reliability signal on profiles. No external delivery channel and no scheduler — everything fires synchronously in flows we already have.

At the end of 2c:
- A `notifications` table holds per-user notifications, created **atomically inside the state-change RPCs**; the Messages tab lists them with mark-as-read + an unread count.
- Confirming a game notifies all joined players; promoting a waitlisted player notifies them; cancelling a game notifies all its players.
- A host can mark each joined player of a **past game they hosted** as **attended** or **no-show**; Profile shows games played (attended), no-shows, and a reliability %.

### Non-goals (later)
"Game tomorrow" / any time-based reminder (needs a scheduler); email/push delivery (needs a channel seam + provider); per-game chat (Phase 4 Realtime); auto-expiry of unconfirmed games; notifications for paid capture/refund events (the in-app confirmed/cancelled covers the user-facing story).

## 2. Constraints

Inherits all prior constraints (TS strict/no-any, RLS, seam-gated payments, design tokens). Plus:

- Notifications are created **only by SECURITY DEFINER RPCs** (atomic with the event); users can **read/update only their own** and **cannot insert**. No notification identifies another user's private data.
- Attendance is marked **only by the host** of the game (`auth.uid()` check), and only for **past** games (`ends_at < now()`).
- Reliability/attendance stats are **computed** from `game_players.status` (no drift-prone counters); `profiles.no_shows`/`games_played` columns remain unused (kept for a possible future denormalization).

## 3. Architecture

### 3.1 `notifications` table (Drizzle) + RLS (SQL)
- **Drizzle schema + generated migration**: `notification_type` pgEnum (`game_confirmed`, `spot_opened`, `game_cancelled`); `notifications` table — `id uuid pk`, `user_id uuid → profiles`, `type notification_type`, `game_id uuid → games` (nullable), `title text`, `body text`, `read boolean default false`, `created_at`.
- **SQL migration `0015`**: enable RLS; policy `notifications_read_own` (`select using auth.uid()=user_id`); policy `notifications_update_own` (`update using/with check auth.uid()=user_id`) — for marking read. **No insert policy** (only the definer RPCs write, bypassing RLS). A GiST/btree index on `(user_id, read, created_at)` for the list query.

### 3.2 Notification writes inside the state-change RPCs (SQL `0015`, CREATE OR REPLACE — same return types)
- **`try_confirm_game`**: on the actual `open→confirmed` transition (not the already-confirmed path), insert a `game_confirmed` notification for **every joined player**.
- **`promote_waitlist`**: after promoting, insert a `spot_opened` notification for the **promoted player**.
- **`cancel_game`**: insert a `game_cancelled` notification for **every player just cancelled** (joined + waitlisted).
- Each insert stores a short `title`/`body` and the `game_id`. Adding INSERTs doesn't change these functions' return types, so `CREATE OR REPLACE` is valid.

### 3.3 `mark_attendance` RPC (SQL `0015`, host-only)
`mark_attendance(p_game_id uuid, p_attended uuid[], p_no_show uuid[])`: `require auth.uid() is not null and = host and ends_at < now()`; set the listed players' `game_players.status` to `attended` / `no_show` (only rows currently `joined`). SECURITY DEFINER, granted `authenticated`, host-gated with the **null-guard** (`auth.uid() is null or host <> auth.uid()`).

### 3.4 `profile_stats` extended (SQL `0015`)
Add `attended bigint` (game_players `status='attended'`), `no_shows bigint` (`status='no_show'`), `reliability numeric` (`attended / nullif(attended + no_shows, 0)`). Keep the existing karma/avg_skill/ratings_count/games_played. (`games_played` stays the "past joined games" count; attendance is a separate, sharper signal.)

### 3.5 Notifications read/mark-read via the user client (RLS)
The Messages tab reads `notifications` (own rows, newest first) and a `markNotificationsReadAction` sets `read=true` for the user's rows — plain RLS-scoped writes (no RPC).

## 4. Data Model

One new table (`notifications`) + one enum (`notification_type`) via Drizzle. SQL `0015`: RLS + index for notifications; notification INSERTs added to `try_confirm_game`/`promote_waitlist`/`cancel_game`; new `mark_attendance`; extended `profile_stats`. Reuses `game_players.status` values `attended`/`no_show` (Phase 0 enum).

## 5. Shared Logic (`packages/core`)

- `NOTIFICATION_COPY: Record<NotificationType, { title: string; bodyFor(gameTitle): string }>` or simpler per-type copy constants — the notification title/body text lives in one place (used by the SQL is hard-coded, but a core helper formats any client-side display and keeps the type union). Minimal: export `NOTIFICATION_TYPES` + a `NotificationType` type; tests assert the union matches the DB enum.

## 6. UI (within design tokens)

- **Messages tab (`/messages`)** (currently a placeholder): a **Notifications** list — each row shows title, body, relative time, unread emphasis; a "Mark all read" action. An unread count is shown in the tab label/heading. *(Note: the master prompt earmarks Messages for per-game chat via Realtime in Phase 4; 2c repurposes the tab for notifications, and Phase 4 will add chat alongside.)*
- **Game detail (host, past game)**: an **Attendance** section listing joined players with attended/no-show toggles → `mark_attendance`. Only shown to the host when `ends_at < now()` and the game isn't cancelled.
- **Profile**: add **no-shows** and **reliability %** next to karma/games/avg (from `profile_stats`).

## 7. Testing

- `packages/core`: `NOTIFICATION_TYPES` equals the DB enum values.
- **DB live smoke (no external deps):** a small free game — confirm → each joined player gets a `game_confirmed` row; a waitlisted join then a leave → the promoted player gets a `spot_opened` row; host cancel → all players get `game_cancelled`; mark_attendance flips statuses and `profile_stats` reflects attended/no_show/reliability; a non-host `mark_attendance` is rejected; RLS: a user reads only their own notifications. Then cleanup (temp users + game + their notifications).
- Build/typecheck pass.

## 8. Definition of Done

- [ ] `notifications` table + RLS (own-row read/update, no user insert); index for the list query.
- [ ] `try_confirm_game`/`promote_waitlist`/`cancel_game` write the right notifications atomically (confirmed→all joined; spot_opened→promoted; cancelled→all cancelled), verified by the smoke.
- [ ] `mark_attendance` is host-only + null-guarded + past-game-only; flips joined→attended/no_show; `profile_stats` computes attended/no_shows/reliability.
- [ ] Messages tab lists own notifications + mark-read + unread count; Profile shows no-shows + reliability; host sees Attendance on a past game they hosted.
- [ ] `packages/core` NOTIFICATION_TYPES test passes; typecheck clean; `next build` succeeds.
- [ ] RLS: a user cannot read another user's notifications (smoke-verified).
