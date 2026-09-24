"use client";

/**
 * components/market/Sidebar.tsx
 *
 * The market shell's left rail: Market, List, Dashboard, Profile, and Admin
 * for admins. Icon rail on small screens, icons + labels from lg up. Active
 * item gets the green pill, matching the header's active states.
 *
 * Mobile uses an off-canvas drawer instead of the rail: the header burger
 * (MobileNavButton, lg:hidden) toggles it via a window event, so the server
 * layout needs no client state. The drawer carries nav + account actions but
 * never the club banner — minimized means no club. Client component for the
 * same reason as MarketNav: only the browser knows the current pathname.
 * The active item stays a real link — never disable the current page's own
 * nav entry.
 */

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui/cn";

export interface SidebarItem {
  href: string;
  label: string;
  icon: "market" | "list" | "dashboard" | "payouts" | "profile" | "admin" | "shipments" | "settings";
  /** Rail section label. Items render under their section's tiny header. */
  section?: string;
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
    case "payouts":
      return (
        <svg {...props}>
          <path d="M12 4v12" />
          <path d="M8 11l4 4 4-4" />
          <path d="M4 20h16" />
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
    case "shipments":
      return (
        <svg {...props}>
          <rect x="1" y="5" width="14" height="10" rx="1.5" />
          <path d="M15 9h4l3 3v3h-7V9z" />
          <circle cx="5.5" cy="18" r="1.8" />
          <circle cx="17.5" cy="18" r="1.8" />
        </svg>
      );
    case "settings":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
        </svg>
      );
  }
}

export function Sidebar({ items }: SidebarProps) {
  const pathname = usePathname();

  function renderItem(item: SidebarItem) {
    const active = isActive(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        title={item.label}
        className={cn(
          "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
          active
            ? "bg-gradient-to-r from-accent/20 via-accent/5 to-transparent font-semibold text-accent shadow-[0_0_24px_-8px_rgba(53,240,122,0.45)]"
            : "text-muted hover:translate-x-px hover:bg-overlay hover:text-foreground",
        )}
      >
        {active && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_8px_1px_rgba(53,240,122,0.6)]"
          />
        )}
        <Icon icon={item.icon} />
        <span className="hidden lg:inline">{item.label}</span>
      </Link>
    );
  }

  // Consecutive items sharing a section render under one tiny header.
  const groups: Array<{ section: string | null; items: SidebarItem[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.section === (item.section ?? null)) {
      last.items.push(item);
    } else {
      groups.push({ section: item.section ?? null, items: [item] });
    }
  }

  return (
    <nav
      aria-label="Primary"
      className="sticky top-16 hidden h-[calc(100vh-4rem)] w-16 shrink-0 flex-col gap-1 self-start overflow-y-auto border-r border-line bg-gradient-to-b from-raised/60 via-raised/40 to-transparent px-2 py-4 lg:flex lg:m-3 lg:h-[calc(100vh-6rem)] lg:w-52 lg:rounded-2xl lg:border lg:border-line lg:px-3 lg:shadow-[0_8px_40px_-16px_rgba(0,0,0,0.7)]"
    >
      {groups.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-1">
          {group.section && (
            <span
              aria-hidden="true"
              className="hidden px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted/70 lg:block"
            >
              {group.section}
            </span>
          )}
          {group.items.map(renderItem)}
        </div>
      ))}

      <ClubCard />
    </nav>
  );
}

const CLUB_HIDDEN_KEY = "flexsoar-hide-club";

/**
 * The "Join the FlexSoar club" banner. Dismissable via the X (revealed on
 * hover for mouse users, always visible on touch and keyboard focus) and
 * remembered in localStorage. Rendered in the desktop rail only.
 */
function ClubCard() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CLUB_HIDDEN_KEY) === "1") setHidden(true);
    } catch {
      // Private mode: banner just comes back next visit.
    }
  }, []);

  if (hidden) return null;

  function dismiss() {
    setHidden(true);
    try {
      window.localStorage.setItem(CLUB_HIDDEN_KEY, "1");
    } catch {
      // Ignore persistence failures.
    }
  }

  return (
    <div className="group relative mt-auto hidden flex-col gap-2 rounded-2xl border border-line bg-overlay p-3 lg:flex">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss FlexSoar club banner"
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-base leading-none text-muted transition hover:bg-raised hover:text-foreground focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
      >
        ×
      </button>
      <Image
        src="/club-logo.png"
        alt="FlexSoar club"
        width={64}
        height={64}
        className="rounded-xl"
      />
      <p className="text-sm font-extrabold leading-tight tracking-tight">
        Join the FlexSoar club
      </p>
      <p className="text-xs leading-snug text-muted">
        Don&apos;t miss hot drops. Early access, member-only heat, and
        collection updates — straight to you.
      </p>
      <Link
        href="/socials"
        className="inline-flex items-center justify-center rounded-lg border border-accent/60 px-2 py-1.5 text-xs font-bold text-accent transition hover:bg-accent/10"
      >
        Learn more →
      </Link>
    </div>
  );
}

const TOGGLE_NAV_EVENT = "flexsoar:toggle-nav";

/**
 * The mobile burger (renders nothing on lg). Dispatches a window event the
 * drawer listens for, keeping state local to the sidebar module.
 */
export function MobileNavButton() {
  return (
    <button
      type="button"
      aria-label="Open navigation menu"
      onClick={() =>
        window.dispatchEvent(new CustomEvent(TOGGLE_NAV_EVENT))
      }
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line-strong text-foreground transition hover:border-muted lg:hidden"
    >
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  );
}

/**
 * Mobile off-canvas drawer (renders nothing on lg). Opens via the burger,
 * closes on navigation, backdrop tap, or Escape. Carries nav + account —
 * never the club banner.
 */
export function MobileNav({
  items,
  account,
  wallet,
}: {
  items: readonly SidebarItem[];
  account?: React.ReactNode;
  /** Signed-in wallet shortcut (button + modal live here). */
  wallet?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener(TOGGLE_NAV_EVENT, toggle);
    return () => window.removeEventListener(TOGGLE_NAV_EVENT, toggle);
  }, []);

  // Close on navigation and lock body scroll while open.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open ]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="Close navigation menu"
        onClick={() => setOpen(false)}
        className="absolute inset-0 cursor-default bg-black/60"
      />
      <nav
        aria-label="Primary"
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-1 overflow-y-auto border-r border-line bg-raised px-3 py-4"
      >
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-bold uppercase tracking-widest text-muted">
            Menu
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-xl leading-none text-muted transition hover:bg-overlay hover:text-foreground"
          >
            ×
          </button>
        </div>
        {items.map((item) => {
          const active = isActive(pathname ?? "", item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-xl px-3 py-3 text-base font-medium transition-colors",
                active
                  ? "bg-gradient-to-r from-accent/20 via-accent/5 to-transparent font-semibold text-accent"
                  : "text-muted hover:bg-overlay hover:text-foreground",
              )}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-accent"
                />
              )}
              <Icon icon={item.icon} />
              {item.label}
            </Link>
          );
        })}
        {wallet && (
          <div className="mt-3 border-t border-line pt-3">
            <span className="px-1 text-xs font-bold uppercase tracking-widest text-muted">
              Wallet
            </span>
            <div className="mt-2 [&>button]:w-full">{wallet}</div>
          </div>
        )}
        {account && <div className="mt-auto pt-4">{account}</div>}
      </nav>
    </div>
  );
}
