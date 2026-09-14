"use client";

/**
 * components/market/PriceChart.tsx
 *
 * The model's trading graph: FlexSoar sales (accent dots + line) against
 * market references (muted dashed line with gradient fill — manual pins
 * plus the daily eBay-solds median from the sync-comps cron). Still pure
 * SVG with zero chart libraries; hover and range selection are the only
 * client state, so the server render already shows the full tape and the
 * 20s bell poll that revalidates every market page keeps it live without
 * any subscription of its own. A settled sale is written at webhook time
 * and appears here on the next refresh: real-time by construction, not by
 * socket.
 *
 * Change % is last point vs first point in the rendered window — the same
 * number a trader reads off any tape, with the honest caveat below it when
 * the window is reference-only (no FlexSoar sale yet).
 */

import { useMemo, useState } from "react";
import { formatMyr } from "@/components/card/format";
import type { PricePoint } from "@/lib/api/contract";
import {
  trend,
  filterByRange,
  type ChartRange,
} from "@/lib/market/pricing";

const RANGES: readonly ChartRange[] = ["1M", "6M", "1Y", "ALL"];

const W = 560;
const H = 240;
const PAD_L = 56;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 24;

function xFor(index: number, count: number): number {
  if (count <= 1) return PAD_L + (W - PAD_L - PAD_R) / 2;
  return PAD_L + (index / (count - 1)) * (W - PAD_L - PAD_R);
}

function yFor(price: number, min: number, max: number): number {
  if (max <= min) return PAD_T + (H - PAD_T - PAD_B) / 2;
  const t = (price - min) / (max - min);
  return H - PAD_B - t * (H - PAD_T - PAD_B);
}

function pathFor(series: readonly { x: number; y: number }[]): string {
  return series
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
}

export function PriceChart({ points, retailCents = null }: { points: readonly PricePoint[]; retailCents?: number | null }) {
  const [range, setRange] = useState<ChartRange>("ALL");
  const [hover, setHover] = useState<number | null>(null);

  const windowed = useMemo(
    () => filterByRange(points, range),
    [points, range],
  );
  // Momentum, not first-vs-last: trailing-14d median vs trailing-90d
  // median, so one odd comp cannot flip the arrow.
  const momentum = trend(windowed);
  const lastCents =
    windowed.length > 0 ? windowed[windowed.length - 1].priceCents : null;

  if (points.length === 0) {
    return (
      <section aria-label="Price history" className="flex flex-col gap-1 rounded-2xl border border-line bg-raised p-4">
        <h2 className="text-sm font-extrabold tracking-tight">Price history</h2>
        <p className="text-[13px] text-muted">
          No sales yet — this model&apos;s tape starts with its first trade.
        </p>
      </section>
    );
  }

  const prices = windowed.map((p) => p.priceCents);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(max - min, 1);
  const lo = Math.floor(min - span * 0.1);
  const hi = Math.ceil(max + span * 0.1);
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

  const at = (i: number) => ({
    x: xFor(i, windowed.length),
    y: yFor(windowed[i].priceCents, lo, hi),
  });
  const flexIdx = windowed
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.source === "flexsoar")
    .map(({ i }) => i);
  const marketIdx = windowed
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.source === "market")
    .map(({ i }) => i);
  const marketLine = marketIdx.map((i) => at(i));
  const flexLine = flexIdx.map((i) => at(i));
  const area =
    marketLine.length >= 2
      ? `${pathFor(marketLine)} L${marketLine[marketLine.length - 1].x.toFixed(1)},${(H - PAD_B).toFixed(1)} L${marketLine[0].x.toFixed(1)},${(H - PAD_B).toFixed(1)} Z`
      : null;
  const hasFlex = flexIdx.length > 0;
  const up = momentum.direction === "up";
  const hovered = hover != null && hover < windowed.length ? { p: windowed[hover], ...at(hover) } : null;

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < windowed.length; i++) {
      const d = Math.abs(at(i).x - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHover(best);
  }

  return (
    <section aria-label="Price history" className="flex flex-col gap-2 rounded-2xl border border-line bg-raised p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-extrabold tracking-tight">Price history</h2>
        <div className="flex items-center gap-1" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRange(r);
                setHover(null);
              }}
              aria-pressed={range === r}
              className={`rounded-lg px-2 py-0.5 text-[11px] font-bold transition ${
                range === r
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
        {lastCents != null && (
          <span className="text-lg font-extrabold tabular-nums">
            {formatMyr(lastCents)}
          </span>
        )}
        {momentum.bps != null && momentum.direction !== "flat" ? (
          <span className={`font-bold tabular-nums ${up ? "text-accent" : "text-[#FF4444]"}`}>
            {up ? "▲" : "▼"} {Math.abs(momentum.bps / 100).toFixed(1)}%
          </span>
        ) : (
          <span className="font-semibold text-muted">steady</span>
        )}
        <span className="tabular-nums text-muted">High {formatMyr(max)}</span>
        <span className="tabular-nums text-muted">Low {formatMyr(min)}</span>
        <span className="tabular-nums text-muted">Avg {formatMyr(avg)}</span>
        {retailCents != null && (
          <span className="tabular-nums text-muted">Retail {formatMyr(retailCents)}</span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Price chart, last ${lastCents != null ? formatMyr(lastCents) : "no price"}`}
        className="w-full cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="tape-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4dff88" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#4dff88" stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((t) => {
          const y = PAD_T + t * (H - PAD_T - PAD_B);
          const v = Math.round(hi - t * (hi - lo));
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.12} />
              <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.55}>
                {(v / 100).toFixed(0)}
              </text>
            </g>
          );
        })}
        {area && <path d={area} fill="url(#tape-fill)" />}
        {marketLine.length >= 2 && (
          <path d={pathFor(marketLine)} fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="4 3" />
        )}
        {marketLine.length === 1 && (
          <circle cx={marketLine[0].x} cy={marketLine[0].y} r={3} fill="currentColor" opacity={0.45} />
        )}
        {retailCents != null && retailCents >= lo && retailCents <= hi && (
          <g>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yFor(retailCents, lo, hi)}
              y2={yFor(retailCents, lo, hi)}
              stroke="currentColor"
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text
              x={W - PAD_R}
              y={yFor(retailCents, lo, hi) - 4}
              textAnchor="end"
              fontSize={9}
              fill="currentColor"
              opacity={0.6}
            >
              Retail
            </text>
          </g>
        )}
        {flexLine.length >= 2 && (
          <path d={pathFor(flexLine)} fill="none" stroke="#4dff88" strokeWidth={2} />
        )}
        {flexIdx.map((i) => {
          const d = at(i);
          return (
            <circle key={i} cx={d.x} cy={d.y} r={3.5} fill="#4dff88">
              <title>{`FlexSoar sale ${formatMyr(windowed[i].priceCents)} on ${windowed[i].observedAt.slice(0, 10)}`}</title>
            </circle>
          );
        })}
        {hovered && (
          <g>
            <line
              x1={hovered.x}
              x2={hovered.x}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeDasharray="2 2"
            />
            <circle cx={hovered.x} cy={hovered.y} r={4.5} fill="none" stroke="#4dff88" strokeWidth={2} />
          </g>
        )}
      </svg>

      {hovered ? (
        <p className="text-[12px] tabular-nums text-foreground" aria-live="polite">
          {formatMyr(hovered.p.priceCents)} · {hovered.p.observedAt.slice(0, 10)} ·{" "}
          {hovered.p.source === "flexsoar" ? "FlexSoar sale" : "Market reference"}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[#4dff88]" />
            FlexSoar sales{hasFlex ? ` (${flexIdx.length})` : ""}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2 w-6 border-t-2 border-dashed border-muted" />
            Market reference
          </span>
          {!hasFlex && (
            <span>Reference only — no FlexSoar sale yet. The tape starts with the first trade.</span>
          )}
        </div>
      )}
    </section>
  );
}
