/** Seeds ~6 verified public venues. Run: pnpm --filter @footylocal/db seed */
import { createServiceClient } from "../client.js";

type SeedVenue = {
  name: string;
  address: string;
  surface_type: "turf" | "grass" | "indoor" | "court" | "street";
  lat: number;
  lng: number;
};

export const SEED_VENUES: SeedVenue[] = [
  { name: "Piedmont Park Active Oval", address: "400 Park Dr NE, Atlanta, GA", surface_type: "grass", lat: 33.7859, lng: -84.3733 },
  { name: "Grant Park Field", address: "840 Cherokee Ave SE, Atlanta, GA", surface_type: "grass", lat: 33.7377, lng: -84.3699 },
  { name: "Historic Fourth Ward Turf", address: "680 Dallas St NE, Atlanta, GA", surface_type: "turf", lat: 33.7616, lng: -84.3653 },
  { name: "Westside Park Pitch", address: "1660 Johnson Rd NW, Atlanta, GA", surface_type: "turf", lat: 33.7961, lng: -84.4308 },
  { name: "Chastain Park Court", address: "216 W Wieuca Rd NW, Atlanta, GA", surface_type: "court", lat: 33.8858, lng: -84.3831 },
  { name: "Decatur Indoor Soccer", address: "245 Pharr Rd, Decatur, GA", surface_type: "indoor", lat: 33.7748, lng: -84.2963 },
];

async function main(): Promise<void> {
  const supabase = createServiceClient();
  for (const v of SEED_VENUES) {
    // Insert non-geo columns via the SDK, then set geography via RPC-free SQL
    // using a PostGIS point. We use the service role and a raw RPC helper.
    const { data, error } = await supabase
      .from("venues")
      .upsert(
        {
          name: v.name,
          address: v.address,
          surface_type: v.surface_type,
          is_verified: true,
        },
        { onConflict: "name" },
      )
      .select("id")
      .single();
    if (error) throw error;

    const { error: geoErr } = await supabase.rpc("set_venue_location", {
      venue_id: data.id,
      lat: v.lat,
      lng: v.lng,
    });
    if (geoErr) throw geoErr;
    process.stdout.write(`seeded ${v.name}\n`);
  }
  process.stdout.write("done\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
