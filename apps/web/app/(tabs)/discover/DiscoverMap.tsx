"use client";
import { useEffect, useRef, useState } from "react";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { loadGoogleMaps } from "@/lib/maps/loader";
import type { NearbyGame } from "./types";

export function DiscoverMap({
  games,
  center,
  onSelect,
}: {
  games: NearbyGame[];
  center: { lat: number; lng: number };
  onSelect: (g: NearbyGame) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clusterRef = useRef<MarkerClusterer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "no-key">("loading");

  // Init the map once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const maps = await loadGoogleMaps();
      if (cancelled) return;
      if (!maps || !ref.current) {
        setStatus("no-key");
        return;
      }
      mapRef.current = new maps.Map(ref.current, {
        center,
        zoom: 11,
        disableDefaultUI: true,
        zoomControl: true,
      });
      clusterRef.current = new MarkerClusterer({ map: mapRef.current });
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-plot markers when games change.
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (status !== "ready" || !map || !cluster) return;
    cluster.clearMarkers();
    const markers = games.map((g) => {
      const marker = new google.maps.Marker({
        position: { lat: g.public_lat, lng: g.public_lng },
        title: g.title,
      });
      marker.addListener("click", () => onSelect(g));
      return marker;
    });
    cluster.addMarkers(markers);
    if (games.length > 0) {
      map.panTo({ lat: games[0]!.public_lat, lng: games[0]!.public_lng });
    }
  }, [games, status, onSelect]);

  if (status === "no-key") {
    return (
      <div className="grid h-80 place-items-center rounded-[var(--radius-card)] bg-gray text-center">
        <span className="px-6 text-sm text-neutral-500">
          Map unavailable — set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. The list view still works.
        </span>
      </div>
    );
  }
  return <div ref={ref} className="h-80 w-full rounded-[var(--radius-card)] bg-gray" />;
}
