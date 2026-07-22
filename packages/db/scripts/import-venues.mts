/**
 * Discovers soccer venues near a point via Google Places (New) and reports
 * what it finds. DRY RUN BY DEFAULT — pass --write to insert.
 *
 *   set -a; . ./.env; set +a
 *   pnpm --filter @footylocal/db tsx scripts/import-venues.mts --lat 33.7748 --lng -84.3863
 *
 * Everything it inserts lands with is_verified = false. Hosting is restricted
 * to verified venues, so an import can never put an unvetted pitch in front of
 * players — a human still has to promote it.
 */
import postgres from "postgres";

type Place = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  types?: string[];
  businessStatus?: string;
  regularOpeningHours?: {
    openNow?: boolean;
    periods?: { open?: { day: number; hour: number; minute: number }; close?: { day: number; hour: number; minute: number } }[];
    weekdayDescriptions?: string[];
  };
};

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const WRITE = args.includes("--write");
const lat = Number(flag("lat", "33.7748"));
const lng = Number(flag("lng", "-84.3863"));
const radius = Number(flag("radius", "25000"));
const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_IOS_API_KEY;
if (!key) throw new Error("No Google Maps API key in env");

/** Several queries, because one phrasing misses whole categories of pitch. */
const QUERIES = ["soccer field", "soccer complex", "futsal court", "football pitch", "park with soccer field", "indoor soccer"];

/**
 * Google has no "open to the public" flag, so this is a heuristic, not truth.
 * Anything not clearly a public park is left for a human to judge.
 */
function classifyAccess(p: Place): { access: "public" | "private-or-paid" | "unknown"; why: string } {
  const types = new Set([p.primaryType, ...(p.types ?? [])].filter(Boolean) as string[]);
  if (types.has("park") || types.has("dog_park") || types.has("national_park")) return { access: "public", why: "park type" };
  if (types.has("athletic_field") || types.has("sports_complex")) {
    // Municipal fields are usually inside a park; club/academy pitches are not.
    return { access: "unknown", why: "athletic field — could be municipal or club" };
  }
  if (types.has("gym") || types.has("stadium") || types.has("sports_club")) return { access: "private-or-paid", why: "club/stadium type" };
  return { access: "unknown", why: `types: ${[...types].join(", ") || "none"}` };
}

function guessSurface(p: Place): "grass" | "turf" | "court" | "indoor" {
  const n = (p.displayName?.text ?? "").toLowerCase();
  if (n.includes("indoor")) return "indoor";
  if (n.includes("futsal") || n.includes("court")) return "court";
  if (n.includes("turf")) return "turf";
  return "grass";
}

async function search(textQuery: string): Promise<Place[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key!,
      "X-Goog-FieldMask": [
        "places.id", "places.displayName", "places.formattedAddress", "places.location",
        "places.primaryType", "places.types", "places.businessStatus",
        "places.regularOpeningHours",
      ].join(","),
    },
    body: JSON.stringify({
      textQuery,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      maxResultCount: 20,
    }),
  });
  if (!res.ok) throw new Error(`Places ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { places?: Place[] };
  return json.places ?? [];
}

const byId = new Map<string, Place>();
for (const q of QUERIES) {
  const places = await search(q);
  for (const p of places) if (p.id) byId.set(p.id, p); // dedupe across queries
  console.log(`  "${q}" → ${places.length}`);
}

const rows = [...byId.values()]
  .filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY")
  .map((p) => {
    const { access, why } = classifyAccess(p);
    const hours = p.regularOpeningHours?.weekdayDescriptions;
    return {
      name: p.displayName?.text ?? "(unnamed)",
      address: p.formattedAddress ?? "",
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      surface: guessSurface(p),
      access,
      why,
      hasHours: !!hours,
      hours,
      placeId: p.id,
    };
  });

console.log(`\n=== ${rows.length} distinct venues within ${radius / 1000}km of ${lat},${lng} ===\n`);
for (const r of rows) {
  console.log(`${r.access.padEnd(16)} ${r.hasHours ? "hours" : "  —  "}  ${r.name}`);
  console.log(`${" ".repeat(24)}${r.address}`);
  if (r.hours) console.log(`${" ".repeat(24)}${r.hours[0]}`);
}

const counts = rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.access]: (a[r.access] ?? 0) + 1 }), {});
console.log(`\naccess: ${JSON.stringify(counts)}`);
console.log(`with opening hours: ${rows.filter((r) => r.hasHours).length}/${rows.length}`);

if (!WRITE) {
  console.log("\nDRY RUN — nothing written. Re-run with --write to insert (all as is_verified = false).");
  process.exit(0);
}

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
let inserted = 0;
for (const r of rows) {
  if (r.lat == null || r.lng == null) continue;
  const existing = await sql`select id from venues where name = ${r.name} and address = ${r.address} limit 1`;
  if (existing.length) continue;
  const [v] = await sql`
    insert into venues (name, address, surface_type, is_verified)
    values (${r.name}, ${r.address}, ${r.surface}::surface_type, false)
    returning id`;
  await sql`select set_venue_location(${v!.id}::uuid, ${r.lat}, ${r.lng})`;
  inserted++;
}
console.log(`inserted ${inserted} venues (is_verified = false)`);
await sql.end();
