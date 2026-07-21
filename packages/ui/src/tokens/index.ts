/** Design tokens — source of truth for JS/native. Mirrored in theme.css for
 * Tailwind v4. Keep the two in sync (see DECISIONS.md). */
export const tokens = {
  color: {
    surface: "#FFFFFF",
    ink: "#111111",
    gray: "#F5F5F5",
    accent: "#CCFF00", // electric volt
    error: "#E5484D",
    success: "#30A46C",
  },
  font: {
    display: '"Anton", system-ui, sans-serif',
    body: '"Inter", system-ui, sans-serif',
  },
  radius: {
    pill: "9999px",
    card: "20px",
  },
} as const;

export type Tokens = typeof tokens;
