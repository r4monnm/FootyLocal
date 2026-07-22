# FootyLocal Phase 2c: No-show + In-app Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In-app event-driven notifications (game confirmed / spot opened / game cancelled) written atomically inside the state-change RPCs, surfaced in the Messages tab; host-marked attendance (no-show tracking) feeding a computed reliability signal on Profile. No external channel, no scheduler.

**Architecture:** A new `notifications` table (Drizzle) with own-row RLS and no user insert; notification INSERTs added inside `try_confirm_game`/`promote_waitlist`/`cancel_game` (SECURITY DEFINER, atomic with the event). A host-only `mark_attendance` RPC flips `game_players.status` to `attended`/`no_show`; `profile_stats` is extended to compute attended/no-shows/reliability. The Messages tab lists own notifications (RLS reads) + mark-read.

**Tech Stack:** TypeScript strict, Next.js App Router, Supabase (Postgres RPC + RLS), Drizzle, Zod, Vitest.

## Global Constraints

- Inherits all prior constraints (TS strict/no-any, RLS, seam-gated payments that build/run with no keys, design tokens).
- Notifications are written **only by SECURITY DEFINER RPCs**; RLS lets users **read/update only their own** and **not insert**.
- `mark_attendance` is **host-only + null-guarded + past-game-only**. Reliability/attendance are **computed** from `game_players.status`.
- Live DB provisioned; source `.env` for live commands. `tsx -e` fails — temp `.ts` files, deleted before commit.
- `apply-sql` replays all files: a function whose return type changes needs `drop function if exists` before every prior definition (this plan changes `profile_stats`).
- Frequent commits: each task ends committed.

---

## File Structure

```
packages/core/
  src/notifications/index.ts    # NOTIFICATION_TYPES, NotificationType
  src/notifications/notifications.test.ts
  src/index.ts                  # + export notifications
packages/db/
  src/schema/index.ts           # notification_type enum + notifications table
  migrations/0002_*.sql         # drizzle-generated (notifications table)
  migrations/sql/0010_trust_postgame.sql   # + drop-first profile_stats (replay)
  migrations/sql/0011_ratings_anonymity.sql# + drop-first profile_stats (replay)
  migrations/sql/0015_notifications_attendance.sql
apps/web/
  app/(tabs)/messages/page.tsx  # notifications list (replace placeholder)
  app/(tabs)/messages/actions.ts# markNotificationsReadAction
  app/game/[id]/page.tsx        # host attendance section (modify)
  app/game/[id]/attendance-actions.ts  # markAttendanceAction
  app/(tabs)/profile/page.tsx   # no-shows + reliability (modify)
```

---

### Task 1: core — NOTIFICATION_TYPES (TDD)

**Files:**
- Create: `packages/core/src/notifications/index.ts`, `packages/core/src/notifications/notifications.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `NOTIFICATION_TYPES = ["game_confirmed","spot_opened","game_cancelled"] as const`; `type NotificationType`.

- [ ] **Step 1: Write `packages/core/src/notifications/notifications.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { NOTIFICATION_TYPES } from "./index.js";

describe("NOTIFICATION_TYPES", () => {
  it("matches the DB notification_type enum values", () => {
    expect(NOTIFICATION_TYPES).toEqual(["game_confirmed", "spot_opened", "game_cancelled"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @footylocal/core test`
Expected: FAIL — `./notifications/index.js` not found.

- [ ] **Step 3: Implement `packages/core/src/notifications/index.ts`**

```ts
/** In-app notification types (mirror of the DB notification_type enum). */
export const NOTIFICATION_TYPES = [
  "game_confirmed",
  "spot_opened",
  "game_cancelled",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
```

- [ ] **Step 4: Export from barrel `packages/core/src/index.ts`**

Add:
```ts
export * from "./notifications/index.js";
```

- [ ] **Step 5: Typecheck + tests**

Run: `pnpm --filter @footylocal/core typecheck && pnpm --filter @footylocal/core test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): NOTIFICATION_TYPES"
```

---

### Task 2: db — notifications table + 0015 (notifications, attendance, profile_stats); apply live + smoke

**Files:**
- Modify: `packages/db/src/schema/index.ts`, `packages/db/migrations/sql/0010_trust_postgame.sql`, `packages/db/migrations/sql/0011_ratings_anonymity.sql`
- Create: `packages/db/migrations/0002_*.sql` (drizzle-generated), `packages/db/migrations/sql/0015_notifications_attendance.sql`

**Interfaces:**
- Produces: `notifications` table + `notification_type` enum; RLS; notification inserts in `try_confirm_game`/`promote_waitlist`/`cancel_game`; `mark_attendance`; extended `profile_stats`.

- [ ] **Step 1: Add the enum + table to `packages/db/src/schema/index.ts`**

Add the enum near the other `pgEnum`s:
```ts
export const notificationType = pgEnum("notification_type", [
  "game_confirmed",
  "spot_opened",
  "game_cancelled",
]);
```
Import `notificationType` into the tables file if enums are in a separate module (follow the existing pattern — the repo defines enums in `schema/enums.ts` and imports them). Add to `enums.ts` and import in `index.ts` consistent with existing enums.

Add the table (after `trustedContacts` or near the end):
```ts
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id),
  type: notificationType("type").notNull(),
  gameId: uuid("game_id").references(() => games.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Generate + apply the Drizzle migration**

Run:
```bash
cd ~/projects/footylocal
pnpm --filter @footylocal/db generate
```
Expected: creates `migrations/0002_*.sql` with the `notification_type` enum + `notifications` table only. Read it to confirm it adds just those (no destructive changes).

Then apply live:
```bash
set -a; . ./.env; set +a
pnpm --filter @footylocal/db migrate
```
Expected: applies `0002`, no errors.

- [ ] **Step 3: Add drop-first for profile_stats in 0010 and 0011 (replay idempotency)**

In `packages/db/migrations/sql/0010_trust_postgame.sql`, immediately before its `create or replace function profile_stats(p_user_id uuid)`, insert:
```sql
drop function if exists profile_stats(uuid);
```
In `packages/db/migrations/sql/0011_ratings_anonymity.sql`, immediately before its `create or replace function profile_stats(p_user_id uuid)`, insert the same line. (0015 changes profile_stats' return shape, so these earlier definitions must drop-first to keep the full `pnpm sql` replay re-runnable.)

- [ ] **Step 4: Create `packages/db/migrations/sql/0015_notifications_attendance.sql`**

```sql
-- Phase 2c: in-app notifications (RLS + writes inside state-change RPCs),
-- host attendance marking, and reliability stats.

-- RLS: users read/update only their own; only the SECURITY DEFINER RPCs insert.
alter table notifications enable row level security;
drop policy if exists notifications_read_own on notifications;
create policy notifications_read_own on notifications for select using (auth.uid() = user_id);
drop policy if exists notifications_update_own on notifications;
create policy notifications_update_own on notifications for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists notifications_user_read_idx
  on notifications (user_id, read, created_at desc);

-- try_confirm_game: notify all joined players on the open->confirmed transition.
create or replace function try_confirm_game(p_game_id uuid)
returns table (payment_intent_id text)
language plpgsql security definer set search_path = public as $$
declare v_status game_status; v_min integer; v_count integer;
begin
  select status, min_players_to_confirm into v_status, v_min from games where id = p_game_id for update;
  if not found then return; end if;
  select count(*) into v_count from game_players where game_id = p_game_id and status = 'joined';
  if v_status = 'open' and v_count >= v_min then
    update games set status = 'confirmed' where id = p_game_id;
    v_status := 'confirmed';
    insert into notifications (user_id, type, game_id, title, body)
    select gp.player_id, 'game_confirmed', p_game_id, 'Game confirmed',
           'Your game has enough players — it''s on.'
    from game_players gp where gp.game_id = p_game_id and gp.status = 'joined';
  end if;
  if v_status = 'confirmed' then
    return query select gp.payment_intent_id from game_players gp
      where gp.game_id = p_game_id and gp.status = 'joined'
        and gp.paid = false and gp.payment_intent_id is not null;
  end if;
  return;
end;
$$;
revoke execute on function try_confirm_game(uuid) from public, anon, authenticated;
grant execute on function try_confirm_game(uuid) to service_role;

-- promote_waitlist: notify the promoted player.
create or replace function promote_waitlist(p_game_id uuid)
returns table (payment_intent_id text, game_confirmed boolean)
language plpgsql security definer set search_path = public as $$
declare v_status game_status; v_max integer; v_count integer; v_promote uuid; v_pi text;
begin
  select status, max_players into v_status, v_max from games where id = p_game_id for update;
  if not found then return; end if;
  select count(*) into v_count from game_players where game_id = p_game_id and status = 'joined';
  if v_count >= v_max then return; end if;
  select player_id, game_players.payment_intent_id into v_promote, v_pi
  from game_players where game_id = p_game_id and status = 'waitlisted'
  order by joined_at asc limit 1;
  if v_promote is null then return; end if;
  update game_players set status = 'joined' where game_id = p_game_id and player_id = v_promote;
  insert into notifications (user_id, type, game_id, title, body)
  values (v_promote, 'spot_opened', p_game_id, 'You''re in!',
          'A spot opened and you were moved off the waitlist.');
  return query select v_pi, (v_status = 'confirmed');
end;
$$;
revoke execute on function promote_waitlist(uuid) from public, anon, authenticated;
grant execute on function promote_waitlist(uuid) to service_role;

-- cancel_game: notify all cancelled players (host-only, null-guarded).
create or replace function cancel_game(p_game_id uuid)
returns table (payment_intent_id text, paid boolean)
language plpgsql security definer set search_path = public as $$
declare v_host uuid;
begin
  select host_id into v_host from games where id = p_game_id for update;
  if not found then raise exception 'game not found'; end if;
  if auth.uid() is null or v_host <> auth.uid() then
    raise exception 'only the host can cancel this game';
  end if;
  update games set status = 'cancelled' where id = p_game_id;
  insert into notifications (user_id, type, game_id, title, body)
  select gp.player_id, 'game_cancelled', p_game_id, 'Game cancelled',
         'The host cancelled this game. Any payment is refunded.'
  from game_players gp where gp.game_id = p_game_id and gp.status in ('joined','waitlisted');
  return query
    with c as (
      update game_players set status = 'cancelled'
      where game_id = p_game_id and status in ('joined','waitlisted')
      returning game_players.payment_intent_id as pi, game_players.paid as pd
    )
    select c.pi, c.pd from c where c.pi is not null;
end;
$$;
grant execute on function cancel_game(uuid) to authenticated;

-- mark_attendance: host-only, past-game-only; flip joined -> attended/no_show.
create or replace function mark_attendance(p_game_id uuid, p_attended uuid[], p_no_show uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_host uuid; v_ends timestamptz;
begin
  select host_id, ends_at into v_host, v_ends from games where id = p_game_id for update;
  if not found then raise exception 'game not found'; end if;
  if auth.uid() is null or v_host <> auth.uid() then
    raise exception 'only the host can mark attendance';
  end if;
  if v_ends >= now() then raise exception 'attendance can only be marked after the game ends'; end if;
  update game_players set status = 'attended'
    where game_id = p_game_id and status = 'joined' and player_id = any(p_attended);
  update game_players set status = 'no_show'
    where game_id = p_game_id and status = 'joined' and player_id = any(p_no_show);
end;
$$;
grant execute on function mark_attendance(uuid, uuid[], uuid[]) to authenticated;

-- profile_stats: add attended / no_shows / reliability. Return shape changes → drop first.
drop function if exists profile_stats(uuid);
create function profile_stats(p_user_id uuid)
returns table (
  games_played bigint, karma bigint, avg_skill numeric, ratings_count bigint,
  attended bigint, no_shows bigint, reliability numeric
)
language sql security definer set search_path = public as $$
  select
    (select count(distinct gp.game_id) from game_players gp join games g on g.id = gp.game_id
       where gp.player_id = p_user_id and gp.status = 'joined' and g.ends_at < now()),
    (select count(*) from ratings where ratee_id = p_user_id and reliability_up),
    (select avg((skill_score->>'skill')::numeric) from ratings
       where ratee_id = p_user_id and jsonb_typeof(skill_score->'skill') = 'number'
         and (skill_score->>'skill')::numeric between 1 and 5),
    (select count(*) from ratings where ratee_id = p_user_id),
    (select count(*) from game_players where player_id = p_user_id and status = 'attended'),
    (select count(*) from game_players where player_id = p_user_id and status = 'no_show'),
    (select round(
       count(*) filter (where status = 'attended')::numeric
         / nullif(count(*) filter (where status in ('attended','no_show')), 0), 2)
     from game_players where player_id = p_user_id);
$$;
grant execute on function profile_stats(uuid) to anon, authenticated;
```

- [ ] **Step 5: Apply the SQL migration live**

Run:
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db sql
```
Expected: full replay through `0015 ok`, no errors (confirms the profile_stats drop-first edits kept it re-runnable).

- [ ] **Step 6: Live smoke (notifications + attendance + RLS)**

Create `packages/db/scripts/_smoke2c.ts` (delete after). Two games (one future for confirm/promote/cancel, one past for attendance), temp users, then cleanup:

```ts
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, svc, { auth: { persistSession: false } });
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

async function mkUser(tag: string) {
  const email = `2c-${tag}-${Date.now()}@mailinator.com`;
  const { data } = await admin.auth.admin.createUser({ email, password: "Smoke2c2026!", email_confirm: true, user_metadata: { is_18_plus: true } });
  const id = data.user!.id;
  await admin.from("profiles").update({ phone_verified: true, display_name: `2c ${tag}` }).eq("id", id);
  const client = createClient(url, anon);
  await client.auth.signInWithPassword({ email, password: "Smoke2c2026!" });
  return { id, client };
}
async function mkGame(hostId: string, venueId: string, startMs: number, min: number, max: number) {
  const gid = randomUUID(); const start = new Date(Date.now() + startMs);
  await admin.rpc("create_game", { p_game_id: gid, p_host_id: hostId, p_venue_id: venueId, p_title: "2c", p_description: null, p_starts_at: start.toISOString(), p_ends_at: new Date(start.getTime() + 3600_000).toISOString(), p_skill_band: "open", p_format: "five_a_side", p_max_players: max, p_min_players_to_confirm: min, p_is_women_only: false, p_price_cents: 0, p_public_lat: 33.75, p_public_lng: -84.39 });
  return gid;
}

const venueId = (await admin.from("venues").select("id").eq("is_verified", true).limit(1).single()).data!.id;
const H = await mkUser("host"); const B = await mkUser("b"); const C = await mkUser("c");

// Future game: confirm -> notify joined; waitlist -> promote -> notify; cancel -> notify all.
const g1 = await mkGame(H.id, venueId, 5 * 86400_000, 2, 2);
await B.client.rpc("join_game", { p_game_id: g1 });
await admin.rpc("try_confirm_game", { p_game_id: g1 });
const bConfirmed = (await B.client.from("notifications").select("type").eq("game_id", g1).eq("type", "game_confirmed")).data;
console.log("B game_confirmed notifs:", (bConfirmed ?? []).length, "(expect 1)");
await C.client.rpc("join_game", { p_game_id: g1 }); // waitlisted
await B.client.rpc("leave_game", { p_game_id: g1 });
await admin.rpc("promote_waitlist", { p_game_id: g1 });
const cPromoted = (await C.client.from("notifications").select("type").eq("game_id", g1).eq("type", "spot_opened")).data;
console.log("C spot_opened notifs:", (cPromoted ?? []).length, "(expect 1)");
await H.client.rpc("cancel_game", { p_game_id: g1 });
const cCancelled = (await C.client.from("notifications").select("type").eq("game_id", g1).eq("type", "game_cancelled")).data;
console.log("C game_cancelled notifs:", (cCancelled ?? []).length, "(expect 1)");
// RLS: B cannot see C's notifications (B's client only returns B's rows).
const bSeesC = (await B.client.from("notifications").select("user_id").eq("user_id", C.id)).data;
console.log("B sees C's notifications:", (bSeesC ?? []).length, "(expect 0)");

// Past game: attendance.
const g2 = await mkGame(H.id, venueId, -2 * 3600_000, 2, 4); // ended 1h ago
await B.client.rpc("join_game", { p_game_id: g2 });
console.log("non-host mark_attendance rejected:", !!(await C.client.rpc("mark_attendance", { p_game_id: g2, p_attended: [B.id], p_no_show: [] })).error);
await H.client.rpc("mark_attendance", { p_game_id: g2, p_attended: [B.id], p_no_show: [H.id] });
const bStat = (await admin.rpc("profile_stats", { p_user_id: B.id })).data![0];
console.log("B stats attended:", bStat.attended, "no_shows:", bStat.no_shows, "reliability:", bStat.reliability, "(expect attended>=1)");

// Cleanup (per-game single-value deletes; avoids postgres.js array-syntax pitfalls).
for (const g of [g1, g2]) {
  await sql`delete from notifications where game_id = ${g}`;
  await sql`delete from game_players where game_id = ${g}`;
  await sql`delete from games where id = ${g}`;
}
for (const u of [H, B, C]) await admin.auth.admin.deleteUser(u.id);
console.log("games remaining:", (await sql`select count(*)::int c from games`)[0].c, "(expect 3)");
await sql.end();
```

Run:
```bash
cd ~/projects/footylocal && set -a; . ./.env; set +a
pnpm --filter @footylocal/db exec tsx scripts/_smoke2c.ts
rm -f packages/db/scripts/_smoke2c.ts
```
Expected: B game_confirmed 1; C spot_opened 1; C game_cancelled 1; B sees C's notifications 0; non-host mark_attendance rejected true; B attended >= 1; games remaining 3.
If any deviates, STOP and report BLOCKED. Delete the temp script regardless.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @footylocal/db typecheck`
Expected: PASS.
```bash
git add -A
git commit -m "feat(db): notifications table + RLS, notification writes in state-change RPCs, mark_attendance, reliability stats"
```

---

### Task 3: web — Messages tab (notifications list + mark read)

**Files:**
- Create: `apps/web/app/(tabs)/messages/actions.ts`
- Modify: `apps/web/app/(tabs)/messages/page.tsx`

**Interfaces:**
- Consumes: server Supabase client (RLS reads own notifications).
- Produces: notifications list + `markNotificationsReadAction`.

- [ ] **Step 1: Create `apps/web/app/(tabs)/messages/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function markNotificationsReadAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
  redirect("/messages");
}
```

- [ ] **Step 2: Replace `apps/web/app/(tabs)/messages/page.tsx`**

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { markNotificationsReadAction } from "./actions";

type Notif = {
  id: string;
  type: string;
  game_id: string | null;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

export default async function Messages() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, type, game_id, title, body, read, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  const notifs = (data ?? []) as Notif[];
  const unread = notifs.filter((n) => !n.read).length;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="display text-6xl">Messages{unread > 0 ? ` · ${unread}` : ""}</h1>
        {unread > 0 && (
          <form>
            <button formAction={markNotificationsReadAction} className="text-xs uppercase underline">
              Mark all read
            </button>
          </form>
        )}
      </div>

      {notifs.length === 0 ? (
        <p className="text-neutral-500">No notifications yet. You'll hear when a game confirms, a spot opens, or a game is cancelled.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notifs.map((n) => {
            const row = (
              <div className={`rounded-[var(--radius-card)] p-4 ${n.read ? "bg-gray" : "border border-ink bg-surface"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{n.title}</span>
                  {!n.read && <span className="text-accent">●</span>}
                </div>
                <p className="text-sm text-neutral-600">{n.body}</p>
                <span className="text-xs text-neutral-400">{new Date(n.created_at).toLocaleString()}</span>
              </div>
            );
            return (
              <li key={n.id}>
                {n.game_id ? <Link href={`/game/${n.game_id}`}>{row}</Link> : row}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): Messages tab notifications list + mark-all-read"
```

---

### Task 4: web — host attendance (game detail) + Profile reliability

**Files:**
- Create: `apps/web/app/game/[id]/attendance-actions.ts`
- Modify: `apps/web/app/game/[id]/page.tsx`, `apps/web/app/(tabs)/profile/page.tsx`

**Interfaces:**
- Consumes: `game_detail` (roster + status + ends_at); `mark_attendance`; `profile_stats` (attended/no_shows/reliability).
- Produces: host Attendance section on a past game; Profile no-shows + reliability.

- [ ] **Step 1: Create `apps/web/app/game/[id]/attendance-actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function markAttendanceAction(formData: FormData): Promise<void> {
  const gameId = String(formData.get("gameId"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  // Each roster player has a select named att:<playerId> = attended|no_show|skip.
  const attended: string[] = [];
  const noShow: string[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("att:")) continue;
    const playerId = key.slice(4);
    if (value === "attended") attended.push(playerId);
    else if (value === "no_show") noShow.push(playerId);
  }
  const { error } = await supabase.rpc("mark_attendance", {
    p_game_id: gameId,
    p_attended: attended,
    p_no_show: noShow,
  });
  if (error) redirect(`/game/${gameId}?error=${encodeURIComponent("Couldn't save attendance.")}`);
  redirect(`/game/${gameId}`);
}
```

- [ ] **Step 2: Add the host Attendance section to `apps/web/app/game/[id]/page.tsx`**

Add the import:
```tsx
import { markAttendanceAction } from "./attendance-actions";
```
Add near the other flags:
```tsx
  const isPast = new Date(game.ends_at).getTime() < Date.now();
```
When the viewer is the host, the game is past, joined, and not cancelled, render an Attendance section (place it inside the `viewer_joined` section, after the roster). It reuses `game.roster`:
```tsx
      {isHost && isPast && !isCancelled && (
        <form className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-gray p-4">
          <h3 className="text-xs uppercase text-neutral-500">Attendance</h3>
          <input type="hidden" name="gameId" value={game.id} />
          {(game.roster ?? []).filter((r) => r.role !== "host").map((r) => (
            <label key={r.player_id} className="flex items-center justify-between text-sm">
              <span>{r.name ?? "Player"}</span>
              <select name={`att:${r.player_id}`} defaultValue="skip" className="rounded-lg bg-gray px-2 py-1 text-xs">
                <option value="skip">—</option>
                <option value="attended">attended</option>
                <option value="no_show">no-show</option>
              </select>
            </label>
          ))}
          <button className="rounded-[var(--radius-pill)] bg-ink px-6 py-3 text-sm font-semibold uppercase text-accent">
            Save attendance
          </button>
        </form>
      )}
```
(Note: `game.roster` reflects `status='joined'` players; already-marked attended/no_show players drop out of the roster after saving, which naturally shows the remaining unmarked ones.)

- [ ] **Step 3: Add no-shows + reliability to `apps/web/app/(tabs)/profile/page.tsx`**

Extend the `stats` shape to include `attended`, `no_shows`, `reliability` (from `profile_stats`). Add two tiles to the stats grid (or a small line), e.g. change the stats array to also show reliability:
```tsx
  let stats = { games_played: 0, karma: 0, avg_skill: null as number | null, ratings_count: 0, attended: 0, no_shows: 0, reliability: null as number | null };
```
And add to the rendered tiles group:
```tsx
          { label: "No-shows", value: Number(stats.no_shows) },
          { label: "Reliability", value: stats.reliability != null ? `${Math.round(Number(stats.reliability) * 100)}%` : "—" },
```
(Insert these into the existing `[{label,value},...]` array that renders the tile grid.)

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @footylocal/web typecheck && pnpm --filter @footylocal/web build`
Expected: PASS; `/game/[id]` + `/profile` compile.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): host attendance marking on past games + Profile reliability"
```

---

## Final Verification (Definition of Done)

- [ ] `pnpm typecheck` clean; `pnpm --filter @footylocal/core test` green (NOTIFICATION_TYPES); `pnpm --filter @footylocal/web build` succeeds.
- [ ] Task 2 smoke passed: confirm→game_confirmed for joined; promote→spot_opened; cancel→game_cancelled; RLS (B can't see C's notifications); non-host mark_attendance rejected; attendance flips status + profile_stats reflects it; games remaining 3. Full `pnpm sql` replay clean (profile_stats drop-first).
- [ ] notifications table has own-row RLS + no user insert; notifications written only by the definer RPCs.
- [ ] Messages tab lists own notifications + mark-all-read + unread count; Profile shows no-shows + reliability; host sees Attendance on a past game they hosted.

## Self-Review Notes (author)

- **Spec coverage:** notifications table §3.1 → T2; notification writes §3.2 → T2 (RPCs); mark_attendance §3.3 → T2 + T4; profile_stats §3.4 → T2 + T4; read/mark-read §3.5 → T3; core types §5 → T1; UI §6 → T3/T4; DoD §8 → Final Verification.
- **Security:** notifications RLS own-row read/update, no insert (definer RPCs only); mark_attendance host-only + null-guard + past-game; cancel_game keeps the null-guard fix. RLS smoke-verified (B can't read C's).
- **Replay:** profile_stats return shape changes → drop-first added to 0010/0011 + drop+create in 0015; full replay re-verified in T2 Step 5.
- **Type consistency:** NOTIFICATION_TYPES ↔ DB enum (T1 test); profile_stats new columns ↔ Profile stats shape (T4); notifications columns ↔ Messages Notif type (T3); mark_attendance array params ↔ action.
- **Known follow-ups (later):** time-based reminders ("game tomorrow") + email/push delivery (channel seam + scheduler); per-game chat in Messages (Phase 4); the recurring apply-sql non-idempotency (migration-tracking table).
```

