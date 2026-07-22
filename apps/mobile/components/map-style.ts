/**
 * Google Maps custom style: black land, neon green lines.
 *
 * Only applies when the map renders with PROVIDER_GOOGLE, which needs a
 * development build (Expo Go's iOS binary ships no Google Maps SDK). With
 * Apple Maps this array is ignored and <MapSkin/> does the recoloring instead.
 *
 * Colors are drawn from theme.ts by hand rather than imported, because this is
 * a Google style document with a fixed schema, not a React style object.
 *   surface #0B0F0A · accent #CCFF00 · accentDeep #5FBF00 · muted #9AA694
 */
export const NEON_MAP_STYLE = [
  // Base: kill the default palette.
  { elementType: "geometry", stylers: [{ color: "#0B0F0A" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#7FBF5A" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#050805" }, { weight: 2 }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },

  // Points of interest: off. They are noise for finding a pitch, and every
  // one of them draws a competing colored icon.
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },

  // Parks stay — a pickup game is usually in one — but only as a faint fill.
  { featureType: "poi.park", elementType: "geometry", stylers: [{ visibility: "on" }, { color: "#0F1A0D" }] },

  // Roads: the neon lines. Local roads dim, arterials brighter, highways hot.
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#1E3A16" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8FCF6A" }] },
  { featureType: "road.arterial", elementType: "geometry.fill", stylers: [{ color: "#3E7A22" }] },
  { featureType: "road.highway", elementType: "geometry.fill", stylers: [{ color: "#5FBF00" }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry.fill", stylers: [{ color: "#7FE000" }] },

  // Water reads as void, a shade below the land.
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#04160A" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3E7A22" }] },

  // Administrative borders: thin neon hairlines.
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#2A5C1B" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#CCFF00" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#0D140B" }] },
];
