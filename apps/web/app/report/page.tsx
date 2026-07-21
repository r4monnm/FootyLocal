import Link from "next/link";
import { REPORT_REASONS } from "@footylocal/core";
import { Button } from "@footylocal/ui";
import { submitReportAction } from "./actions";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ reported?: string; game?: string; sent?: string; error?: string }>;
}) {
  const { reported, game, sent, error } = await searchParams;

  if (sent) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-10">
        <h1 className="display text-4xl">Report sent</h1>
        <p className="text-neutral-600">Thanks — our team will review it. FootyLocal is not an emergency service; if you're in danger, contact local authorities.</p>
        <Link href="/discover" className="text-sm uppercase underline">← Discover</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-10">
      <h1 className="display text-4xl">Report</h1>
      {error && <p className="text-[var(--color-error)] text-sm">Please choose a reason.</p>}
      <form className="flex flex-col gap-3">
        <input type="hidden" name="reportedId" value={reported ?? ""} />
        <input type="hidden" name="gameId" value={game ?? ""} />
        <select name="reason" required defaultValue="" className="rounded-2xl bg-gray px-5 py-4">
          <option value="" disabled>Choose a reason</option>
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
          ))}
        </select>
        <textarea name="details" placeholder="Details (optional)" className="rounded-2xl bg-gray px-5 py-4" />
        <Button formAction={submitReportAction}>Submit report</Button>
      </form>
      <Link href="/discover" className="text-xs uppercase text-neutral-500">Cancel</Link>
    </main>
  );
}
