/**
 * components/market/MarketNav.tsx
 *
 * The header's route nav. Needs the current pathname to mark the active
 * item, which a Server Component (app/(market)/layout.tsx) can't read
 * directly — split out as a small client component for that reason alone.
 *
 * "/" matches ONLY the exact root: `pathname.startsWith('/')` is true for
 * every route in this app and was why Market used to stay highlighted (and,
 * worse, unlinked) everywhere. Every other item matches by prefix so
 * /card/[id] still lights up under a parent like /u/[handle] would.
 *
 * The active item is still a real link. A user must always be able to click
 * back to where they already are — never disable or de-link the current
 * page's own nav entry.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface MarketNavItem {
  href: string;
  label: string;
}

export interface MarketNavProps {
  items: readonly MarketNavItem[];
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MarketNav({ items }: MarketNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Market"
      className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-tight"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "border border-accent bg-accent px-1.5 py-0.5 font-bold text-[#0B0B0B]"
                : "border border-line px-1.5 py-0.5 text-muted hover:text-foreground"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
