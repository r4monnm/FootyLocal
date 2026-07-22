import { View } from "react-native";
import { colors } from "../theme";

/**
 * Map marker for a game's approximate area.
 *
 * A custom view instead of Marker's `pinColor` because Google Maps quantizes
 * that prop to a fixed hue — our lime came out olive. A view renders exactly
 * the color we ask for on both providers.
 */
export function GamePin({ selected }: { selected: boolean }) {
  const size = selected ? 22 : 16;
  return (
    <View
      style={{
        width: size + 12,
        height: size + 12,
        borderRadius: (size + 12) / 2,
        alignItems: "center",
        justifyContent: "center",
        // Halo, so a pin stays findable against bright road lines.
        backgroundColor: selected ? "rgba(204,255,0,0.28)" : "rgba(204,255,0,0.16)",
      }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.accent,
          borderWidth: 2,
          borderColor: selected ? "#FFFFFF" : colors.surface,
        }}
      />
    </View>
  );
}
