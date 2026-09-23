"use client";

/**
 * components/market/ProfileTabs.tsx
 *
 * The profile's two tabs — Collections and Activity — Courtyard-arranged:
 * underline active state, counts in the labels. Content arrives as
 * pre-rendered server nodes; this only switches visibility.
 */

import { useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export function ProfileTabs({
  collections,
  collectionsCount,
  activity,
  activityCount,
}: {
  collections: ReactNode;
  collectionsCount: number;
  activity: ReactNode;
  activityCount: number;
}) {
  const [tab, setTab] = useState<"collections" | "activity">("collections");

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Profile sections"
        className="flex gap-6 border-b border-line"
      >
        {(
          [
            { id: "collections", label: "Collections", count: collectionsCount },
            { id: "activity", label: "Activity", count: activityCount },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 pb-2 text-sm font-bold transition-colors",
              tab === t.id
                ? "border-accent text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t.label}
            <span
              aria-hidden
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                tab === t.id ? "bg-accent/15 text-accent" : "bg-raised text-muted",
              )}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      <div role="tabpanel" hidden={tab !== "collections"}>
        {collections}
      </div>
      <div role="tabpanel" hidden={tab !== "activity"}>
        {activity}
      </div>
    </div>
  );
}
