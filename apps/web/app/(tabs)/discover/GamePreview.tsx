"use client";
import Link from "next/link";
import { roundPublicDistance } from "@footylocal/core";
import { Badge } from "@footylocal/ui";
import type { NearbyGame } from "./types";

export function GamePreview({
  game,
  onClose,
}: {
  game: NearbyGame;
  onClose: () => void;
}) {
  const spots = game.max_players - Number(game.joined_count);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-t-[var(--radius-card)] bg-surface p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="display text-3xl">{game.title}</h2>
          <Badge tone="accent">{game.skill_band}</Badge>
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-neutral-600">
          <span>{game.format.replace(/_/g, " ")}</span>
          <span>{new Date(game.starts_at).toLocaleString()}</span>
          <span>{spots} spot{spots === 1 ? "" : "s"} left</span>
          <span>{roundPublicDistance(game.distance_meters)}</span>
          {game.host_name && <span>host: {game.host_name}</span>}
        </div>
        <p className="text-xs text-neutral-500">
          Approximate area shown. The exact pitch is revealed after you join.
        </p>
        <Link
          href={`/game/${game.id}`}
          className="inline-flex items-center justify-center rounded-[var(--radius-pill)] bg-ink px-8 py-4 text-sm font-semibold uppercase tracking-wide text-accent"
        >
          View game
        </Link>
        <button onClick={onClose} className="text-xs uppercase text-neutral-500">Close</button>
      </div>
    </div>
  );
}
