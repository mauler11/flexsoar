/**
 * components/market/ProvenanceChain.tsx
 *
 * The ownership history for a card, oldest first. Each hop links to the
 * owner's public profile and shows their frozen acquisition level, when they
 * took possession, when they let it go, and what it changed hands for. The
 * terminal "MINTED" node reads as the card's birth.
 */
import type { ProvenanceEntry } from "@/lib/api/contract";
import { formatUsd } from "@/components/card/format";

export interface ProvenanceChainProps {
  provenance: ProvenanceEntry[];
}

export function ProvenanceChain({ provenance }: ProvenanceChainProps) {
  return (
    <ol className="space-y-0">
      {provenance.map((entry, index) => {
        const released = entry.released_at ? entry.released_at.slice(0, 10) : null;
        return (
          <li
            key={`${entry.owner.id}-${entry.acquired_at}`}
            className="relative border-l-2 border-line pb-4 pl-4 last:pb-0"
          >
            <span
              aria-hidden
              className="absolute -left-1.5 top-1.5 h-2.5 w-2.5 border border-line bg-raised"
            />
            <div className="font-mono text-[10px] uppercase tracking-tight text-muted">
              {index === 0 ? "Minted" : "Acquired"}
              <span className="mx-1 text-foreground/40">·</span>
              {entry.acquired_at.slice(0, 10)}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] tracking-tight">
              <a
                href={`/u/${entry.owner.handle}`}
                className="text-accent hover:underline"
              >
                @{entry.owner.handle}
              </a>
              <span className="border border-line px-1 py-px text-[9px] uppercase tracking-tight text-muted">
                LV {entry.owner_level}
              </span>
              {entry.price_cents != null && (
                <span className="text-foreground">{formatUsd(entry.price_cents)}</span>
              )}
              {released && (
                <span className="text-[10px] text-muted">→ sold {released}</span>
              )}
            </div>
          </li>
        );
      })}
      {provenance.length === 0 && (
        <li className="font-mono text-[11px] tracking-tight text-muted">
          No provenance recorded.
        </li>
      )}
    </ol>
  );
}