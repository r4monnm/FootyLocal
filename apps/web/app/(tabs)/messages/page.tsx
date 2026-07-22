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
