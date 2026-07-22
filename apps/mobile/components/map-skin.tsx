import { View } from "react-native";
import { colors, absoluteFill } from "../theme";

/**
 * Recolors the map basemap toward the app's neon green.
 *
 * Apple Maps has no custom style API — that is Google Maps' `customMapStyle`,
 * which needs `PROVIDER_GOOGLE`, and Expo Go's iOS binary ships no Google Maps
 * SDK (verified: no GMS symbols or frameworks in it). So a true designed
 * black-with-neon-lines basemap requires an EAS development build. Until then
 * we blend over the native map view:
 *
 *   1. `color`  — neon green replaces the basemap's hue/saturation, keeping
 *                 its luminance so roads and labels stay legible.
 *   2. `multiply` — crushes the land toward black.
 *   3. `color-dodge` — lifts what survived back into neon; true black stays
 *                 black.
 *
 * Why this can only get so close: `userInterfaceStyle="dark"` is NOT honored
 * in Expo Go (it is a native build-time setting, and forcing the simulator to
 * dark appearance changes nothing), so the basemap always renders LIGHT —
 * where land and roads are both near-white and there is barely any luminance
 * separation to turn into dark land plus bright lines. Steps 2 and 3 are also
 * mathematical inverses (multiply by k, divide by 1-d), so tuning them against
 * each other slides along one curve; the values below are a balance point, not
 * a dial with more to give.
 *
 * All layers are pointerEvents="none" so pans, zooms and marker taps still
 * reach the map underneath.
 */
export function MapSkin() {
  return (
    <>
      <View pointerEvents="none" style={{ ...absoluteFill, backgroundColor: colors.mapTint, mixBlendMode: "color" }} />
      <View pointerEvents="none" style={{ ...absoluteFill, backgroundColor: colors.mapShade, mixBlendMode: "multiply" }} />
      <View pointerEvents="none" style={{ ...absoluteFill, backgroundColor: colors.mapGlow, mixBlendMode: "color-dodge" }} />
    </>
  );
}
