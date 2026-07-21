import { Button } from "@footylocal/ui";
import { verifyPhoneAction } from "../actions";

export default async function VerifyPhone({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <h1 className="display text-5xl">Verify your phone</h1>
      <p className="text-sm text-neutral-600">
        Phone verification is required before you can join or host a game. In
        development, enter <code>000000</code>.
      </p>
      {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}
      <form className="flex flex-col gap-3">
        <input name="code" inputMode="numeric" placeholder="6-digit code"
          className="rounded-2xl bg-gray px-5 py-4 tracking-[0.5em]" />
        <Button formAction={verifyPhoneAction}>Verify</Button>
      </form>
    </main>
  );
}
