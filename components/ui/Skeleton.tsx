/**
 * components/ui/Skeleton.tsx
 *
 * Placeholder while content loads. A single block, or `lines` stacked blocks
 * that taper in width. Purely decorative — aria-hidden.
 */
import { cn } from "./cn";

export interface SkeletonProps {
  className?: string;
  /** Render `lines` stacked blocks that taper in width. */
  lines?: number;
}

const TAPER = ["w-full", "w-2/3", "w-1/2"] as const;

export function Skeleton({ className, lines }: SkeletonProps) {
  if (lines != null && lines > 1) {
    return (
      <div aria-hidden className="flex flex-col gap-1.5">
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className={cn("block h-3 animate-pulse bg-line", TAPER[i % TAPER.length], className)}
          />
        ))}
      </div>
    );
  }
  return (
    <span
      aria-hidden
      className={cn("block h-3 animate-pulse bg-line", className)}
    />
  );
}
