import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { HostGameForm } from "./HostGameForm";

export default async function Host({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let phoneVerified = false;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("phone_verified")
      .eq("id", user.id)
      .single();
    phoneVerified = data?.phone_verified ?? false;
  }

  const { data: venues } = await supabase
    .from("venues")
    .select("id, name")
    .eq("is_verified", true)
    .order("name");

  return (
    <section className="flex flex-col gap-6">
      <h1 className="display text-6xl">Host</h1>
      {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}
      {!phoneVerified ? (
        <div className="flex flex-col gap-3">
          <p className="text-neutral-600">You must verify your phone before hosting a game.</p>
          <Link href="/verify-phone" className="text-sm font-semibold uppercase text-ink underline">
            Verify your phone →
          </Link>
        </div>
      ) : (
        <HostGameForm venues={venues ?? []} />
      )}
    </section>
  );
}
