/**
 * components/ui/Badge.tsx
 *
 * Small fixed-status pill. Tones map to the palette: accent (green), info
 * (blue), warn (amber), danger (red), neutral (grey). A leading dot keeps
 * the tone readable in greyscale.
 */
import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "accent" | "info" | "warn" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const TONE: Record<BadgeTone, { border: string; text: string; square: string }> =
  {
    neutral: { border: "#3A3A3A", text: "#9A9A9A", square: "#6B6B6B" },
    accent: { border: "#35F07A", text: "#35F07A", square: "#35F07A" },
    info: { border: "#3B9EFF", text: "#3B9EFF", square: "#3B9EFF" },
    warn: { border: "#E8B33A", text: "#E8B33A", square: "#E8B33A" },
    danger: { border: "#FF4444", text: "#FF4444", square: "#FF4444" },
  };

export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  const t = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-overlay px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        className,
      )}
      style={{ borderColor: t.border, color: t.text }}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.square }} />
      {children}
    </span>
  );
}
