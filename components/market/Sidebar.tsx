"use client";

/**
 * components/market/Sidebar.tsx
 *
 * The market shell's left rail: Market, List, Dashboard, Profile, and Admin
 * for admins. Icon rail on small screens, icons + labels from lg up. Active
 * item gets the green pill, matching the header's active states.
 *
 * Client component for the same reason as MarketNav: only the browser knows
 * the current pathname. The active item stays a real link — never disable
 * the current page's own nav entry.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui/cn";

export interface SidebarItem {
  href: string;
  label: string;
  icon: "market" | "list" | "dashboard" | "profile" | "admin";
}

export interface SidebarProps {
  items: readonly SidebarItem[];
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Icon({ icon }: { icon: SidebarItem["icon"] }) {
  const props = {
    className: "h-5 w-5 shrink-0",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  } as const;
  switch (icon) {
    case "market":
      return (
        <svg {...props}>
          <path d="M3 11l9-8 9 8" />
          <path d="M5 10v10h5v-6h4v6h5V10" />
        </svg>
      );
    case "list":
      return (
        <svg {...props}>
          <path d="M4 4h7l9 9-7 7-9-9V4z" />
          <circle cx="9" cy="9" r="1.5" />
        </svg>
      );
    case "dashboard":
      return (
        <svg {...props}>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "profile":
      return (
        <svg {...props}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
        </svg>
      );
    case "admin":
      return (
        <svg {...props}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
        </svg>
      );
  }
}

export function Sidebar({ items }: SidebarProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="sticky top-16 flex h-[calc(100vh-4rem)] w-16 shrink-0 flex-col gap-1 self-start overflow-y-auto border-r border-line bg-raised/40 px-2 py-4 lg:w-52 lg:px-3"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={item.label}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-accent/15 text-accent"
                : "text-muted hover:bg-overlay hover:text-foreground",
            )}
          >
            <Icon icon={item.icon} />
            <span className="hidden lg:inline">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
