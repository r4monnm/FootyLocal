import type { ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  className?: string;
}

/** Photography-forward card shell. */
export function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`overflow-hidden rounded-[var(--radius-card)] bg-surface ${className}`}
    >
      {children}
    </div>
  );
}
