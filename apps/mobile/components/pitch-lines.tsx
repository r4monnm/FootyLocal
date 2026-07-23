import { View } from "react-native";
import { colors, absoluteFill } from "../theme";

/**
 * Decorative pitch markings — halfway line, centre circle, centre spot, and a
 * penalty arc peeking in from the bottom. Drawn with plain Views (borders and
 * borderRadius) rather than SVG so it costs no dependency.
 *
 * Purely decorative: pointerEvents="none" throughout, and it renders behind
 * content at low opacity. Never put information in here.
 */
export function PitchLines({ opacity = 0.09 }: { opacity?: number }) {
  const line = colors.ink;
  return (
    <View pointerEvents="none" style={{ ...absoluteFill, opacity, overflow: "hidden" }}>
      {/* Halfway line */}
      <View style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, backgroundColor: line }} />

      {/* Centre circle */}
      <View
        style={{
          position: "absolute", left: "50%", top: "50%",
          width: 200, height: 200, marginLeft: -100, marginTop: -100,
          borderRadius: 100, borderWidth: 2, borderColor: line,
        }}
      />
      {/* Centre spot */}
      <View
        style={{
          position: "absolute", left: "50%", top: "50%",
          width: 10, height: 10, marginLeft: -5, marginTop: -5,
          borderRadius: 5, backgroundColor: line,
        }}
      />

      {/* Penalty box, entering from the bottom edge */}
      <View
        style={{
          position: "absolute", left: "50%", bottom: -90,
          width: 280, height: 150, marginLeft: -140,
          borderWidth: 2, borderColor: line,
        }}
      />
      {/* Penalty arc */}
      <View
        style={{
          position: "absolute", left: "50%", bottom: 34,
          width: 120, height: 120, marginLeft: -60,
          borderRadius: 60, borderWidth: 2, borderColor: line,
        }}
      />
    </View>
  );
}
