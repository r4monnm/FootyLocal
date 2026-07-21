"use client";
import { useEffect, useState, useCallback } from "react";
import { type DiscoverFilters, toGamesNearFilters } from "@footylocal/core";
import { createClient } from "@/lib/supabase/client";
import { FilterBar } from "./FilterBar";
import { DiscoverList } from "./DiscoverList";
import { DiscoverMap } from "./DiscoverMap";
import { GamePreview } from "./GamePreview";
import type { NearbyGame } from "./types";

const ATLANTA = { lat: 33.749, lng: -84.388 };

export function DiscoverView() {
  const [center, setCenter] = useState(ATLANTA);
  const [filters, setFilters] = useState<DiscoverFilters>({ radiusMeters: 20000 });
  const [games, setGames] = useState<NearbyGame[]>([]);
  const [view, setView] = useState<"map" | "list">("list");
  const [selected, setSelected] = useState<NearbyGame | null>(null);

  // Ask for geolocation once; fall back to Atlanta.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 8000 },
    );
  }, []);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("games_near", {
      lat: center.lat,
      lng: center.lng,
      radius_meters: filters.radiusMeters,
      filters: toGamesNearFilters(filters),
    });
    if (!error && data) setGames(data as NearbyGame[]);
  }, [center, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="display text-6xl">Discover</h1>
        <div className="flex gap-2">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-[var(--radius-pill)] px-4 py-2 text-xs font-semibold uppercase ${
                view === v ? "bg-ink text-accent" : "bg-gray text-neutral-500"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <FilterBar filters={filters} onChange={setFilters} />

      {view === "list" ? (
        <DiscoverList games={games} onSelect={setSelected} />
      ) : (
        <DiscoverMap games={games} center={center} onSelect={setSelected} />
      )}

      {selected && <GamePreview game={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}
