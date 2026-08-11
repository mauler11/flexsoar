/**
 * components/market/Banner.tsx
 *
 * The single surface for "the server said something, now show it": searchParams
 * carry an error text (server actions redirect with the message verbatim), a
 * settled purchase, a listing created, or a redemption submitted — the pages
 * map those onto a Banner. One tone map, same visual language as the Toasts.
 */
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export type BannerTone = "error" | "success" | "warn" | "info";

export interface BannerProps {
  tone?: BannerTone;
  title: string;
  children?: ReactNode;
  className?: string;
}

const TONE: Record<BannerTone, { border: string; text: string; marker: string }> =
  {
    error: { border: "#FF4444", text: "#FF4444", marker: "#FF4444" },
    success: { border: "#35F07A", text: "#35F07A", marker: "#35F07A" },
    warn: { border: "#E8B33A", text: "#E8B33A", marker: "#E8B33A" },
    info: { border: "#3B9EFF", text: "#3B9EFF", marker: "#3B9EFF" },
  };

export function Banner({
  tone = "info",
  title,
  children,
  className,
}: BannerProps) {
  const t = TONE[tone];
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 border bg-overlay px-3 py-2 font-mono text-[11px] leading-snug tracking-tight",
        className,
      )}
      style={{ borderColor: t.border, color: t.text }}
    >
      <span
        aria-hidden
        className="mt-1 h-2 w-2 shrink-0"
        style={{ background: t.marker }}
      />
      <div>
        <div className="font-bold uppercase">{title}</div>
        {children != null && (
          <div className="mt-0.5 text-muted">{children}</div>
        )}
      </div>
    </div>
  );
}