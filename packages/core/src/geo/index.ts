/**
 * Deterministic location privacy. `public_location` is computed once at write
 * time; the same (precise, gameId) always yields the same fuzzed output so it
 * cannot be averaged out across reads.
 */

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;
// Grid cell ~0.01deg (~1.1km). We snap to the cell then add a seeded sub-offset.
const GRID_DEG = 0.01;
const MAX_OFFSET_M = 400; // seeded offset applied to the snapped cell center
const DISPLAY_RADIUS_M = 800; // public circle radius shown on the map

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Offset a point by distance (m) along a bearing (radians). Equirectangular
 * approximation — accurate to well under a meter at sub-km scales. */
function offsetPoint(p: LatLng, distM: number, bearing: number): LatLng {
  const dLat = (distM * Math.cos(bearing)) / 111_320;
  const dLng = (distM * Math.sin(bearing)) / (111_320 * Math.cos(toRad(p.lat)));
  return { lat: p.lat + dLat, lng: p.lng + dLng };
}

/** FNV-1a 32-bit hash → uint32. Deterministic per string. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic unit float in [0, 1) from a seed. */
function seededUnit(seed: string): number {
  return fnv1a(seed) / 0x100000000;
}

/** Snap a coordinate to the center of its grid cell. */
function snapToCellCenter(value: number): number {
  return Math.floor(value / GRID_DEG) * GRID_DEG + GRID_DEG / 2;
}

/**
 * Fuzzed public point: snap the precise point to its grid cell center, then
 * add a fixed per-game offset seeded from the game id. Stored as
 * `games.public_location`.
 */
export function fuzzToPublicPoint(precise: LatLng, gameId: string): LatLng {
  const snapped: LatLng = {
    lat: snapToCellCenter(precise.lat),
    lng: snapToCellCenter(precise.lng),
  };
  const bearing = seededUnit(`${gameId}:bearing`) * 2 * Math.PI;
  const dist = seededUnit(`${gameId}:dist`) * MAX_OFFSET_M;
  return offsetPoint(snapped, dist, bearing);
}

/**
 * Public display circle. Its center is offset from the TRUE point by a seeded
 * amount smaller than the radius, so the true pitch is never the circle center
 * (Strava Privacy-Zone fix).
 */
export function publicDisplayCircle(
  precise: LatLng,
  gameId: string,
): { center: LatLng; radiusMeters: number } {
  const bearing = seededUnit(`${gameId}:circle-bearing`) * 2 * Math.PI;
  // Offset between 30% and 70% of the radius: always > 0 and < radius.
  const frac = 0.3 + seededUnit(`${gameId}:circle-dist`) * 0.4;
  const center = offsetPoint(precise, DISPLAY_RADIUS_M * frac, bearing);
  return { center, radiusMeters: DISPLAY_RADIUS_M };
}

/** Coarse, human-readable distance for un-joined viewers. Never precise. */
export function roundPublicDistance(meters: number): string {
  if (meters < 500) return "under 500 m away";
  const km = Math.round(meters / 1000);
  return `about ${km} km away`;
}
