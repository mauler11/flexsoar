"use client";

import { useState } from "react";
import { cn } from "@/components/ui/cn";
import type { ProvenanceEntry } from "@/lib/api/contract";
import { formatUsd } from "@/components/card/format";

export interface ProvenanceChainProps {
  provenance: ProvenanceEntry[];
}

function ActionIcon({ action }: { action: "mint" | "sold" | "acquired" }) {
  switch (action) {
    case "mint":
      return (
        <svg className="h-4 w-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      );
    case "sold":
      return (
        <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "acquired":
      return (
        <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2M7 7h10" />
        </svg>
      );
  }
}

export function ProvenanceChain({ provenance }: ProvenanceChainProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (provenance.length === 0) {
    return (
      <div className="font-mono text-sm tracking-tight text-muted py-4">
        No provenance recorded.
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 font-mono text-sm uppercase tracking-tight text-muted hover:text-foreground/80 transition-colors mb-4 lg:hidden"
        aria-expanded={isExpanded}
      >
        <span>Provenance ({provenance.length})</span>
        <svg
          className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <ol className={cn("space-y-5", !isExpanded && "hidden lg:block")}>
        {provenance.map((entry, index) => {
          const released = entry.released_at ? entry.released_at.slice(0, 10) : null;
          const isMint = index === 0;
          const action = isMint ? "mint" : (released ? "sold" : "acquired");

          return (
            <li
              key={`${entry.owner.id}-${entry.acquired_at}`}
              className="relative border-l-2 border-line pb-6 pl-6 last:pb-0"
            >
              <span
                aria-hidden
                className="absolute -left-2 top-2 h-3 w-3 border border-line bg-raised rounded-full"
              />
              <div className="font-mono text-xs uppercase tracking-tight text-muted mb-2">
                {isMint ? "Minted" : "Acquired"}
                <span className="mx-1 text-foreground/40">·</span>
                {entry.acquired_at.slice(0, 10)}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-sm tracking-tight">
                <div className="flex items-center gap-2">
                  <ActionIcon action={action} />
                  <a
                    href={`/u/${entry.owner.handle}`}
                    className="text-accent hover:underline font-medium"
                  >
                    @{entry.owner.handle}
                  </a>
                </div>
                <span className="border border-line px-2 py-1 text-[9px] uppercase tracking-tight text-muted">
                  LV {entry.owner_level}
                </span>
                {entry.price_cents != null && (
                  <span className="text-foreground font-medium">{formatUsd(entry.price_cents)}</span>
                )}
                {released && (
                  <span className="text-xs text-muted">→ sold {released}</span>
                )}
              </div>
            </li>
          );
        })}
        {provenance.length === 0 && (
          <li className="font-mono text-sm tracking-tight text-muted py-4">
            No provenance recorded.
          </li>
        )}
      </ol>
    </div>
  );
}