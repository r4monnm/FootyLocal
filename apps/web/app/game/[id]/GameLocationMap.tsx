"use client";
import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/maps/loader";

export function GameLocationMap({ lat, lng }: { lat: number; lng: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "no-key">("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const maps = await loadGoogleMaps();
      if (cancelled) return;
      if (!maps || !ref.current) {
        setStatus("no-key");
        return;
      }
      const map = new maps.Map(ref.current, {
        center: { lat, lng },
        zoom: 15,
        disableDefaultUI: true,
        zoomControl: true,
      });
      new maps.Marker({ position: { lat, lng }, map, title: "Exact pitch" });
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  if (status === "no-key") {
    return (
      <div className="grid h-56 place-items-center rounded-[var(--radius-card)] bg-gray text-center">
        <span className="px-6 text-sm text-neutral-500">
          Map unavailable — use the directions link below.
        </span>
      </div>
    );
  }
  return <div ref={ref} className="h-56 w-full rounded-[var(--radius-card)] bg-gray" />;
}
