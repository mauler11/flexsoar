"use client";

/**
 * components/market/ProfileTabs.tsx
 *
 * The profile's section tabs — Collections, Listings, Activity (counts in
 * the labels), Courtyard-arranged: underline active state. Content arrives
 * as pre-rendered server nodes; this only switches visibility.
 */

import { useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export interface ProfileTab {
  id: string;
  label: string;
  count: number;
  content: ReactNode;
}

export function ProfileTabs({ tabs }: { tabs: ProfileTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Profile sections"
        className="flex gap-6 overflow-x-auto border-b border-line"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-b-2 pb-2 text-sm font-bold transition-colors",
              active === t.id
                ? "border-accent text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t.label}
            <span
              aria-hidden
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                active === t.id ? "bg-accent/15 text-accent" : "bg-raised text-muted",
              )}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={active !== t.id}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
