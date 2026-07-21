"use client";
import { GAME_BANDS, GAME_FORMATS, type DiscoverFilters } from "@footylocal/core";

const SEL = "rounded-[var(--radius-pill)] bg-gray px-4 py-2 text-xs uppercase";

export function FilterBar({
  filters,
  onChange,
}: {
  filters: DiscoverFilters;
  onChange: (f: DiscoverFilters) => void;
}) {
  const set = (patch: Partial<DiscoverFilters>) => onChange({ ...filters, ...patch });
  return (
    <div className="flex flex-wrap gap-2">
      <select
        className={SEL}
        value={filters.skillBand ?? ""}
        onChange={(e) => set({ skillBand: (e.target.value || undefined) as DiscoverFilters["skillBand"] })}
      >
        <option value="">Any band</option>
        {GAME_BANDS.map((b) => (<option key={b} value={b}>{b}</option>))}
      </select>
      <select
        className={SEL}
        value={filters.format ?? ""}
        onChange={(e) => set({ format: (e.target.value || undefined) as DiscoverFilters["format"] })}
      >
        <option value="">Any format</option>
        {GAME_FORMATS.map((f) => (<option key={f} value={f}>{f.replace(/_/g, " ")}</option>))}
      </select>
      <select
        className={SEL}
        value={filters.radiusMeters}
        onChange={(e) => set({ radiusMeters: Number(e.target.value) })}
      >
        {[5000, 10000, 20000, 50000].map((m) => (
          <option key={m} value={m}>{m / 1000} km</option>
        ))}
      </select>
      <label className={`${SEL} flex items-center gap-2`}>
        <input
          type="checkbox"
          checked={!!filters.womenOnly}
          onChange={(e) => set({ womenOnly: e.target.checked || undefined })}
        />
        Women-only
      </label>
    </div>
  );
}
