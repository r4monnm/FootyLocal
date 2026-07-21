"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/discover", label: "Discover" },
  { href: "/my-games", label: "My Games" },
  { href: "/host", label: "Host" },
  { href: "/messages", label: "Messages" },
  { href: "/profile", label: "Profile" },
];

export function TabBar() {
  const path = usePathname();
  return (
    <nav className="sticky bottom-0 flex justify-around border-t border-gray bg-surface py-3">
      {TABS.map((t) => {
        const active = path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href}
            className={`text-xs font-semibold uppercase tracking-wide ${
              active ? "text-ink" : "text-neutral-400"
            }`}>
            {active ? <span className="text-accent">●</span> : null} {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
