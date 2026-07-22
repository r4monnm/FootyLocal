import Constants, { ExecutionEnvironment } from "expo-constants";
import { PROVIDER_GOOGLE, PROVIDER_DEFAULT, type MapViewProps } from "react-native-maps";
import { NEON_MAP_STYLE } from "./map-style";

/**
 * Expo Go's iOS binary ships no Google Maps SDK, so PROVIDER_GOOGLE only works
 * in a development or production build. Detect which one we are running in and
 * pick the best map we can:
 *
 *   dev/prod build → Google Maps + NEON_MAP_STYLE (black land, neon lines).
 *   Expo Go        → Apple Maps, recolored approximately by <MapSkin/>.
 *
 * Screens read `needsSkin` to decide whether to render <MapSkin/> — layering it
 * over an already-styled Google map would double-tint it.
 */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const useGoogleMaps = !isExpoGo;
export const needsSkin = isExpoGo;

/** Spread onto <MapView/>. */
export const mapProviderProps: Pick<MapViewProps, "provider" | "customMapStyle"> = useGoogleMaps
  ? { provider: PROVIDER_GOOGLE, customMapStyle: NEON_MAP_STYLE }
  : { provider: PROVIDER_DEFAULT };
