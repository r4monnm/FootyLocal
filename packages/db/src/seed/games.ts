/** Seeds ~3 open demo games so Discover isn't empty. Idempotent-ish: it clears
 * any prior demo-host games first. Run: pnpm --filter @footylocal/db seed:games */
import { createServiceClient } from "../client.js";
import { createGame } from "../games.js";

const DEMO_EMAIL = "demo-host@mailinator.com";

async function ensureHost(): Promise<string> {
  const supabase = createServiceClient();
  const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  let host = list?.users.find((u) => u.email === DEMO_EMAIL);
  if (!host) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: "FootyDemoHost2026!",
      email_confirm: true,
      user_metadata: { is_18_plus: true },
    });
    if (error) throw error;
    host = data.user!;
  }
  await supabase
    .from("profiles")
    .update({ phone_verified: true, verification_level: "phone", display_name: "Demo Host" })
    .eq("id", host.id);
  return host.id;
}

async function main(): Promise<void> {
  const supabase = createServiceClient();
  const hostId = await ensureHost();

  // Clear prior demo games so re-seeding doesn't pile up. game_players FK-
  // references games with no cascade, so delete the roster rows first.
  const { data: oldGames } = await supabase
    .from("games")
    .select("id")
    .eq("host_id", hostId);
  const oldIds = (oldGames ?? []).map((g) => g.id);
  if (oldIds.length) {
    await supabase.from("game_players").delete().in("game_id", oldIds);
    await supabase.from("games").delete().in("id", oldIds);
  }

  const { data: venues, error: vErr } = await supabase
    .from("venues")
    .select("id, name")
    .eq("is_verified", true)
    .limit(3);
  if (vErr) throw vErr;
  if (!venues || venues.length < 3) throw new Error("need >=3 verified venues (run venue seed first)");

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const specs = [
    { band: "open" as const, format: "five_a_side" as const, title: "Friday Night 5s", inDays: 2, max: 10, min: 6 },
    { band: "intermediate" as const, format: "seven_a_side" as const, title: "Sunday 7s", inDays: 4, max: 14, min: 8 },
    { band: "advanced" as const, format: "eleven_a_side" as const, title: "Weekend 11-a-side", inDays: 6, max: 22, min: 14 },
  ];

  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    const v = venues[i]!;
    const start = new Date(now + s.inDays * day + 18 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 90 * 60 * 1000);
    const id = await createGame(hostId, {
      title: s.title,
      description: `Demo game at ${v.name}.`,
      venueId: v.id,
      startsAt: start,
      endsAt: end,
      skillBand: s.band,
      format: s.format,
      maxPlayers: s.max,
      minPlayersToConfirm: s.min,
      isWomenOnly: false,
      priceCents: 0,
    });
    process.stdout.write(`seeded game ${s.title} (${id}) at ${v.name}\n`);
  }
  process.stdout.write("done\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
