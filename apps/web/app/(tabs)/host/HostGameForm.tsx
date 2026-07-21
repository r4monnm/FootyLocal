"use client";
import { GAME_BANDS, GAME_FORMATS } from "@footylocal/core";
import { Button } from "@footylocal/ui";
import { hostGameAction } from "./actions";

type Venue = { id: string; name: string };

const FIELD = "rounded-2xl bg-gray px-5 py-4 w-full";

export function HostGameForm({ venues }: { venues: Venue[] }) {
  return (
    <form className="flex flex-col gap-3">
      <input name="title" required placeholder="Game title" className={FIELD} />
      <textarea name="description" placeholder="Description (optional)" className={FIELD} />
      <select name="venueId" required className={FIELD} defaultValue="">
        <option value="" disabled>Choose a verified venue</option>
        {venues.map((v) => (
          <option key={v.id} value={v.id}>{v.name}</option>
        ))}
      </select>
      <label className="text-xs uppercase text-neutral-500">Starts</label>
      <input name="startsAt" type="datetime-local" required className={FIELD} />
      <label className="text-xs uppercase text-neutral-500">Ends</label>
      <input name="endsAt" type="datetime-local" required className={FIELD} />
      <select name="skillBand" required className={FIELD} defaultValue="open">
        {GAME_BANDS.map((b) => (
          <option key={b} value={b}>{b}</option>
        ))}
      </select>
      <select name="format" required className={FIELD} defaultValue="five_a_side">
        {GAME_FORMATS.map((f) => (
          <option key={f} value={f}>{f.replace(/_/g, " ")}</option>
        ))}
      </select>
      <input name="maxPlayers" type="number" min={2} max={64} required placeholder="Max players" className={FIELD} />
      <input name="minPlayersToConfirm" type="number" min={2} max={64} required placeholder="Min players to confirm" className={FIELD} />
      <label className="flex items-center gap-2 text-sm">
        <input name="isWomenOnly" type="checkbox" /> Women-only game
      </label>
      <Button variant="accent" formAction={hostGameAction}>Host game</Button>
    </form>
  );
}
