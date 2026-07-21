import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "accent";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/** Pill CTA. `primary` = black on white; `accent` = volt on black. */
export function Button({
  variant = "primary",
  className = "",
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-[var(--radius-pill)] px-8 py-4 text-sm font-semibold uppercase tracking-wide transition-transform active:scale-95 disabled:opacity-40";
  const styles: Record<Variant, string> = {
    primary: "bg-ink text-surface",
    accent: "bg-ink text-accent",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...rest} />;
}
