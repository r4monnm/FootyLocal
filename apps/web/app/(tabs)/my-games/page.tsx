import Link from "next/link";
import { Badge, Card } from "@footylocal/ui";
import { createClient } from "@/lib/supabase/server";

type MyGame = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  venue_name: string;
  role: string;
  is_past: boolean;
  status: string;
  player_status: string;
};

export default async function MyGames() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_games");
  const games = (data ?? []) as MyGame[];
  const upcoming = games.filter((g) => !g.is_past);
  const past = games.filter((g) => g.is_past);

  const Row = ({ g }: { g: MyGame }) => (
    <Card className="border border-gray p-4">
      <div className="flex items-center justify-between">
        <Link href={`/game/${g.id}`} className="display text-xl">{g.title}</Link>
        {g.player_status === "waitlisted" && <Badge>waitlist</Badge>}
        {g.status === "confirmed" && <Badge tone="accent">confirmed</Badge>}
        {g.status === "cancelled" && <span className="text-xs uppercase text-[var(--color-error)]">cancelled</span>}
        {g.role === "host" && <Badge tone="accent">host</Badge>}
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-sm text-neutral-600">
        <span>{g.venue_name}</span>
        <span>{new Date(g.starts_at).toLocaleString()}</span>
        {g.is_past && (
          <Link href={`/game/${g.id}/rate`} className="uppercase underline">Rate players</Link>
        )}
      </div>
    </Card>
  );

  return (
    <section className="flex flex-col gap-6">
      <h1 className="display text-6xl">My Games</h1>

      <div>
        <h2 className="text-xs uppercase text-neutral-500">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No upcoming games. Find one on Discover.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-3">{upcoming.map((g) => <Row key={g.id} g={g} />)}</div>
        )}
      </div>

      <div>
        <h2 className="text-xs uppercase text-neutral-500">Past</h2>
        {past.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No past games yet.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-3">{past.map((g) => <Row key={g.id} g={g} />)}</div>
        )}
      </div>
    </section>
  );
}
