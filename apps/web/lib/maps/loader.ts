import { Loader } from "@googlemaps/js-api-loader";

let loader: Loader | null = null;

/** Returns the google.maps namespace, or null if no key is configured. */
export async function loadGoogleMaps(): Promise<typeof google.maps | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  loader ??= new Loader({ apiKey, libraries: ["maps", "marker"] });
  await loader.load();
  return google.maps;
}
