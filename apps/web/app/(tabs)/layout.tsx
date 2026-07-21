import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TabBar } from "./TabBar";

export default async function TabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let phoneVerified = true;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("phone_verified")
      .eq("id", user.id)
      .single();
    phoneVerified = data?.phone_verified ?? false;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
      {!phoneVerified && (
        <Link href="/verify-phone"
          className="bg-accent px-6 py-3 text-sm font-semibold uppercase text-ink">
          Verify your phone to join or host →
        </Link>
      )}
      <div className="flex-1 px-6 py-8">{children}</div>
      <TabBar />
    </div>
  );
}
