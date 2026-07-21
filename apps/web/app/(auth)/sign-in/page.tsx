import { Button } from "@footylocal/ui";
import { signInAction, signUpAction } from "../actions";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6">
      <h1 className="display text-6xl">Footy&nbsp;Local</h1>
      {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}

      <form className="flex flex-col gap-3">
        <input name="email" type="email" required placeholder="Email"
          className="rounded-2xl bg-gray px-5 py-4" />
        <input name="password" type="password" required placeholder="Password"
          className="rounded-2xl bg-gray px-5 py-4" />
        <Button formAction={signInAction}>Sign in</Button>
      </form>

      <form className="flex flex-col gap-3">
        <input name="email" type="email" required placeholder="Email (new account)"
          className="rounded-2xl bg-gray px-5 py-4" />
        <input name="password" type="password" required placeholder="Password (min 10)"
          className="rounded-2xl bg-gray px-5 py-4" />
        <label className="flex items-center gap-2 text-sm">
          <input name="is18Plus" type="checkbox" /> I am 18 or older
        </label>
        <Button variant="accent" formAction={signUpAction}>Create account</Button>
      </form>
    </main>
  );
}
