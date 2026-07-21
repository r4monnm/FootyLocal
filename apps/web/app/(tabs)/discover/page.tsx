import { Button } from "@footylocal/ui";

export default function Discover() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="display text-7xl">Discover</h1>
      <p className="max-w-sm text-neutral-600">
        No games near you yet. The map and nearby games arrive in the next phase.
      </p>
      <div className="grid h-64 place-items-center rounded-[var(--radius-card)] bg-gray">
        <span className="display text-3xl text-neutral-300">Map coming soon</span>
      </div>
      <Button variant="accent" disabled>Host the first game</Button>
    </section>
  );
}
