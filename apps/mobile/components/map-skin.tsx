import { View } from "react-native";
import { colors, absoluteFill } from "../theme";

/**
 * Recolors the map basemap to the app's neon green.
 *
 * Apple Maps has no custom style API (that is Google Maps' customMapStyle,
 * which on iOS needs PROVIDER_GOOGLE and therefore a development build), so
 * instead we stack blend layers over the native map view:
 *
 *   1. `color` blend with neon green — replaces the basemap's hue/saturation
 *      while keeping its luminance, so roads and labels stay legible.
 *   2. `multiply` shade — pushes the whole thing back toward near-black.
 *
 * Both layers are pointerEvents="none" so pans, zooms and marker taps still
 * reach the map underneath.
 */
export function MapSkin() {
  return (
    <>
      <View pointerEvents="none" style={{ ...absoluteFill, backgroundColor: colors.mapTint, mixBlendMode: "color" }} />
      <View pointerEvents="none" style={{ ...absoluteFill, backgroundColor: colors.mapShade, mixBlendMode: "multiply" }} />
    </>
  );
}
