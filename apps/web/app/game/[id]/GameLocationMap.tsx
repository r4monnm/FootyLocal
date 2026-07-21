"use client";

// Placeholder — replaced with the real precise mini-map in Task 4.
export function GameLocationMap({ lat, lng }: { lat: number; lng: number }) {
  return (
    <div className="grid h-56 place-items-center rounded-[var(--radius-card)] bg-gray">
      <span className="text-sm text-neutral-400">Pitch map — {lat.toFixed(4)}, {lng.toFixed(4)} (Task 4)</span>
    </div>
  );
}
