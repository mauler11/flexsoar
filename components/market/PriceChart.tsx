import { formatMyr } from "@/components/card/format";
import type { PricePoint } from "@/lib/api/contract";

/**
 * components/market/PriceChart.tsx
 *
 * The model's trading graph: FlexSoar sales (accent dots + line) against
 * admin-entered market references (muted line). Pure SVG, no chart library
 * and no client JS — it renders from the server page's props, so the
 * 20s bell poll that revalidates every market page keeps it live without
 * any subscription of its own. A settled sale is written at webhook time
 * and appears here on the next refresh: real-time by construction, not by
 * socket.
 *
 * Change % is last point vs first point in the rendered window — the same
 * number a trader reads off any tape, with the honest caveat below it when
 * the window is reference-only (no FlexSoar sale yet).
 */

export interface PriceChange {
  /** Null when fewer than two points exist. */
  pct: number | null;
  firstCents: number | null;
  lastCents: number | null;
}

/** Exported so tests pin the arithmetic without rendering SVG. */
export function priceChange(points: readonly PricePoint[]): PriceChange {
  if (points.length < 2) {
    const only = points.length === 1 ? points[0].priceCents : null;
    return { pct: null, firstCents: only, lastCents: only };
  }
  const firstCents = points[0].priceCents;
  const lastCents = points[points.length - 1].priceCents;
  if (firstCents <= 0) {
    return { pct: null, firstCents, lastCents };
  }
  return {
    pct: ((lastCents - firstCents) / firstCents) * 100,
    firstCents,
    lastCents,
  };
}

const W = 560;
const H = 220;
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

function pathFor(
  series: readonly { x: number; y: number }[],
): string {
  return series.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export function PriceChart({ points }: { points: readonly PricePoint[] }) {
  const change = priceChange(points);

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

  const prices = points.map((p) => p.priceCents);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(max - min, 1);
  const lo = Math.floor(min - span * 0.1);
  const hi = Math.ceil(max + span * 0.1);

  const flex = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.source === "flexsoar")
    .map(({ p, i }) => ({ x: xFor(i, points.length), y: yFor(p.priceCents, lo, hi), p }));
  const market = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.source === "market")
    .map(({ p, i }) => ({ x: xFor(i, points.length), y: yFor(p.priceCents, lo, hi), p }));

  const up = change.pct != null && change.pct >= 0;
  const hasFlex = flex.length > 0;

  return (
    <section aria-label="Price history" className="flex flex-col gap-2 rounded-2xl border border-line bg-raised p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-extrabold tracking-tight">Price history</h2>
        <div className="flex items-baseline gap-2">
          {change.lastCents != null && (
            <span className="text-lg font-extrabold tabular-nums">
              {formatMyr(change.lastCents)}
            </span>
          )}
          {change.pct != null ? (
            <span
              className={`text-xs font-bold tabular-nums ${up ? "text-accent" : "text-[#FF4444]"}`}
            >
              {up ? "▲" : "▼"} {Math.abs(change.pct).toFixed(1)}%
            </span>
          ) : (
            <span className="text-xs font-semibold text-muted">first point</span>
          )}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Price chart, last ${change.lastCents != null ? formatMyr(change.lastCents) : "no price"}`} className="w-full">
        {[0.25, 0.5, 0.75].map((t) => {
          const y = PAD_T + t * (H - PAD_T - PAD_B);
          const v = Math.round(hi - t * (hi - lo));
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.12} />
              <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.55}>
                {v >= 1000 ? `${(v / 100).toFixed(0)}` : v}
              </text>
            </g>
          );
        })}
        {market.length >= 2 && (
          <path d={pathFor(market)} fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="4 3" />
        )}
        {market.length === 1 && (
          <circle cx={market[0].x} cy={market[0].y} r={3} fill="currentColor" opacity={0.45} />
        )}
        {flex.length >= 2 && (
          <path d={pathFor(flex)} fill="none" stroke="#4dff88" strokeWidth={2} />
        )}
        {flex.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={3.5} fill="#4dff88">
            <title>{`FlexSoar sale ${formatMyr(d.p.priceCents)} on ${d.p.observedAt.slice(0, 10)}`}</title>
          </circle>
        ))}
      </svg>

      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[#4dff88]" />
          FlexSoar sales{hasFlex ? ` (${flex.length})` : ""}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2 w-6 border-t-2 border-dashed border-muted" />
          Market reference
        </span>
        {!hasFlex && (
          <span>Reference only — no FlexSoar sale yet. The tape starts with the first trade.</span>
        )}
      </div>
    </section>
  );
}
