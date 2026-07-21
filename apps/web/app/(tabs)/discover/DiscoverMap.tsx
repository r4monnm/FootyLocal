"use client";
import type { NearbyGame } from "./types";

// Placeholder — replaced with the real Google Map in Task 6.
export function DiscoverMap({ games }: {
  games: NearbyGame[];
  center: { lat: number; lng: number };
  onSelect: (g: NearbyGame) => void;
}) {
  return (
    <div className="grid h-80 place-items-center rounded-[var(--radius-card)] bg-gray">
      <span className="display text-2xl text-neutral-300">Map — {games.length} games (Task 6)</span>
    </div>
  );
}
