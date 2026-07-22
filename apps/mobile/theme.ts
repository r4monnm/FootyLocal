export const colors = {
  /** Primary text, and the background of inverted (primary) buttons. */
  ink: "#F2F5EF",
  /** App background. Near-black with a green cast. */
  surface: "#0B0F0A",
  /** Elevated surface: cards, inputs, tab bar. */
  gray: "#1A1F17",
  /** Lime. Same family as the reference's accent. */
  accent: "#CCFF00",
  /** Bright stop of the CTA gradient (hot, near-white lime). */
  accentBright: "#E8FF6B",
  /** Deep stop of the CTA gradient — the drop into saturated green. */
  accentDeep: "#5FBF00",
  /** Text/icons that sit ON an accent fill. */
  onAccent: "#0B0F0A",
  muted: "#9AA694",
  /** Hairline borders on dark surfaces. */
  border: "#2A3324",
  /** The green bloom behind auth headers. */
  glow: "rgba(140, 198, 63, 0.55)",
  /** Neon green recolor layer over the map basemap (blended, not painted). */
  mapTint: "#4BFF7A",
  /** Crushes the light basemap's land toward black. */
  mapShade: "rgba(0, 0, 0, 0.86)",
  /** Lifts the surviving roads and labels back into neon. */
  mapGlow: "#3E8F4E",
  error: "#FF6B6E",
  success: "#4ADE80",
};
export const radius = { pill: 999, card: 16 };
/** Fill the parent. Spreadable, unlike StyleSheet.absoluteFill (a style ID). */
export const absoluteFill = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;
export const space = (n: number) => n * 4;
export const font = { display: "Anton_400Regular", body: "Inter_400Regular", bodySemibold: "Inter_600SemiBold" };
