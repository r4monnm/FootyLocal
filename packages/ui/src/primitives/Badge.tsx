import type { ReactNode } from "react";

export interface BadgeProps {
  children: ReactNode;
  tone?: "ink" | "accent";
}

/** Small uppercase pill used for skill band / verification. */
export function Badge({ children, tone = "ink" }: BadgeProps) {
  const styles =
    tone === "accent"
      ? "bg-accent text-ink"
      : "bg-ink text-surface";
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-pill)] px-3 py-1 text-xs font-semibold uppercase tracking-wide ${styles}`}
    >
      {children}
    </span>
  );
}
