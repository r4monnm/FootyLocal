"use client";
import { roundPublicDistance } from "@footylocal/core";
import { Badge, Card } from "@footylocal/ui";
import type { NearbyGame } from "./types";

export function DiscoverList({
  games,
  onSelect,
}: {
  games: NearbyGame[];
  onSelect: (g: NearbyGame) => void;
}) {
  if (games.length === 0) {
    return <p className="text-neutral-500">No games nearby yet. Try a wider distance, or host one.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {games.map((g) => {
        const spots = g.max_players - Number(g.joined_count);
        return (
          <Card key={g.id} className="border border-gray p-5">
            <button className="flex w-full flex-col gap-2 text-left" onClick={() => onSelect(g)}>
              <div className="flex items-center justify-between">
                <span className="display text-2xl">{g.title}</span>
                <Badge tone="accent">{g.skill_band}</Badge>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-neutral-600">
                <span>{g.format.replace(/_/g, " ")}</span>
                <span>{new Date(g.starts_at).toLocaleString()}</span>
                <span>{spots} spot{spots === 1 ? "" : "s"} left</span>
                <span>{roundPublicDistance(g.distance_meters)}</span>
                {g.is_women_only && <span>women-only</span>}
              </div>
            </button>
          </Card>
        );
      })}
    </div>
  );
}
