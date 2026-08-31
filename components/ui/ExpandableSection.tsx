"use client";

import { useState } from "react";
import { ReactNode } from "react";

export function ExpandableSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="group border border-line bg-overlay rounded-lg">
      <summary className="flex items-center justify-between gap-3 p-4 cursor-pointer list-none font-mono text-sm uppercase tracking-tight text-muted hover:text-foreground/80">
        {title}
        <svg className="h-4 w-4 text-muted transition-transform duration-200 group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="p-4 border-t border-line animate-in fade-in-50 slide-in-from-top-2 duration-200">
        {children}
      </div>
    </details>
  );
}