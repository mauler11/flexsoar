"use client";

/**
 * components/market/PlGraph.tsx
 *
 * Portfolio value graph (Courtyard-arranged, theme green): the line is
 * always green; the number carries the verdict — up arrow + green when
 * the book is ahead, solid down arrow + red with the percentage when it
 * is behind. Fiat follows the viewer's own display currency; the percent
 * is currency-neutral (a ratio, never converted).
 *
 * The series arrives precomputed (30 daily points, oldest first). Ranges
 * slice it client-side. Under two distinct values the line flats out —
 * the honest empty-book state, same as the reference.
 */

import { useState } from "react";
import { FiatAmount, useFiat } from "@/components/market/Fiat";
import { formatMyr } from "@/components/card/format";
import { cn } from "@/components/ui/cn";

const W = 600;
const H = 150;
const PAD = 8;

type Range = "7D" | "30D";

export interface PlGraphProps {
  points30: ReadonlyArray<{ tMs: number; valueCents: number }>;
  costCents: number;
  valuedCount: number;
  totalCount: number;
}

export function PlGraph({ points30, costCents, valuedCount, totalCount }: PlGraphProps) {
  const [range, setRange] = useState<Range>("7D");
  const { siteCode } = useFiat();

  const points = range === "7D" ? points30.slice(-7) : points30;
  const current = points.length > 0 ? points[points.length - 1].valueCents : 0;
  const start = points.length > 0 ? points[0].valueCents : 0;
  // Headline move: this window (range start → now). Cost-basis return sits
  // muted beside it — one line, one meaning each.
  const delta = current - start;
  const periodPct = start > 0 ? (delta / start) * 100 : null;
  const periodUp = delta >= 0;
  const totalPl = current - costCents;
  const totalUp = totalPl >= 0;

  const values = points.map((p) => p.valueCents);
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 0);
  const span = hi - lo || 1;
  const x = (i: number) =>
    points.length < 2 ? W / 2 : PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.valueCents).toFixed(1)}`).join(" ");
  const area =
    points.length >= 1
      ? `${line} L${x(points.length - 1).toFixed(1)},${(H - PAD).toFixed(1)} L${x(0).toFixed(1)},${(H - PAD).toFixed(1)} Z`
      : null;

  return (
    <section
      aria-label="Portfolio performance"
      className="flex flex-col gap-2 rounded-2xl border border-line bg-raised p-4"
    >
      <p className="text-3xl font-extrabold tabular-nums tracking-tight">
        <FiatAmount cents={current} />{" "}
        <span className="text-sm font-bold text-muted">{siteCode}</span>
      </p>
      <p
        className={cn(
          "text-sm font-bold tabular-nums",
          periodUp ? "text-accent" : "text-[#FF4444]",
        )}
      >
        {periodUp ? "▲" : "▼"} <FiatAmount cents={Math.abs(delta)} /> (
        {periodPct == null ? "—" : `${periodUp ? "+" : "−"}${Math.abs(periodPct).toFixed(1)}%`}){" "}
        <span className="font-semibold text-muted">{range}</span>
        <span className="ml-2 font-semibold text-muted">
          {totalUp ? "+" : "−"}
          <FiatAmount cents={Math.abs(totalPl)} /> vs cost
        </span>
      </p>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Portfolio value chart, current ${formatMyr(current)}`}
        className="w-full"
      >
        <defs>
          <linearGradient id="pl-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#35F07A" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#35F07A" stopOpacity={0} />
          </linearGradient>
        </defs>
        {area && (
          <>
            <path d={area} fill="url(#pl-fill)" />
            <path d={line} fill="none" stroke="#35F07A" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}
      </svg>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Time range">
          {(["7D", "30D"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                range === r
                  ? "bg-accent font-semibold text-[#0B0B0B]"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">
            {valuedCount} of {totalCount} cards valued
          </span>
        </div>
      </div>
      <p className="px-1 text-[11px] text-muted">
        Live asks where available, oracle value otherwise · unrealized only —
        sold cards aren&apos;t in this number.
      </p>
    </section>
  );
}
