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
    success: { border: "#00FF66", text: "#00FF66", marker: "#00FF66" },
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
        "flex items-start gap-2.5 rounded-2xl border bg-raised px-4 py-3 text-[13px] leading-snug",
        className,
      )}
      style={{ borderColor: t.border, color: t.text }}
    >
      <span
        aria-hidden
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ background: t.marker }}
      />
      <div>
        <div className="font-bold">{title}</div>
        {children != null && (
          <div className="mt-0.5 text-muted">{children}</div>
        )}
      </div>
    </div>
  );
}