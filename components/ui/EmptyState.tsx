/**
 * components/ui/EmptyState.tsx
 *
 * The "nothing here" panel. Dashed border, optional icon, title, description,
 * and an optional action slot.
 */
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 border border-dashed border-line-strong bg-raised px-4 py-10 text-center",
        className,
      )}
    >
      {icon != null && (
        <div aria-hidden className="text-muted">
          {icon}
        </div>
      )}
      <h3 className="font-mono text-[12px] font-bold uppercase tracking-tight">
        {title}
      </h3>
      {description != null && (
        <p className="max-w-sm font-mono text-[11px] leading-snug tracking-tight text-muted">
          {description}
        </p>
      )}
      {action != null && <div className="mt-2">{action}</div>}
    </div>
  );
}
