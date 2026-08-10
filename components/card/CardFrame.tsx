/**
 * components/card/CardFrame.tsx
 *
 * Rarity frame. Colour is part of the signal but never the only part: the
 * ornament escalates with tier so cards stay readable in greyscale and for
 * colour-blind users.
 *
 *   Common    — 1px border only
 *   Uncommon  — + corner studs
 *   Rare      — + top accent bar
 *   Epic      — + inner hairline
 *   Legendary — + edge marks
 *
 * `is_exceptional` overrides the border colour to red and adds the "1 OF 1"
 * corner ribbon. The tier still drives every ornament below it.
 */
import type { ReactNode } from "react";
import type { Tier } from "@/lib/db/types";
import { borderColorFor } from "@/lib/domain/rarity";
import { cn } from "@/components/ui/cn";

export interface CardFrameProps {
  tier: Tier;
  isExceptional?: boolean;
  className?: string;
  children: ReactNode;
}

export function CardFrame({
  tier,
  isExceptional = false,
  className,
  children,
}: CardFrameProps) {
  const color = borderColorFor(tier, isExceptional);
  return (
    <div
      className={cn("relative", className)}
      style={{
        borderColor: color,
        borderWidth: isExceptional ? 2 : 1,
        borderStyle: "solid",
      }}
    >
      {children}
      {tier >= 2 && <CornerStuds color={color} />}
      {tier >= 3 && <TopAccentBar color={color} />}
      {tier >= 4 && <InnerHairline color={color} />}
      {tier >= 5 && <EdgeMarks color={color} />}
      {isExceptional && <ExceptionalRibbon />}
    </div>
  );
}

function CornerStuds({ color }: { color: string }) {
  const stud = "absolute h-[6px] w-[6px]";
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-10">
      <span className={cn(stud, "left-0 top-0")} style={{ background: color }} />
      <span className={cn(stud, "right-0 top-0")} style={{ background: color }} />
      <span className={cn(stud, "bottom-0 left-0")} style={{ background: color }} />
      <span className={cn(stud, "bottom-0 right-0")} style={{ background: color }} />
    </span>
  );
}

function TopAccentBar({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-[3px] top-0 z-10 block h-[3px]"
      style={{ background: color }}
    />
  );
}

function InnerHairline({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-[4px] z-10 block border"
      style={{ borderColor: color }}
    />
  );
}

const H_EDGE = ["left-1/4", "left-1/2", "left-3/4"] as const;
const V_EDGE = ["top-1/4", "top-1/2", "top-3/4"] as const;

/** Legendary ruler ticks along all four edges, clear of the corner studs. */
function EdgeMarks({ color }: { color: string }) {
  const ticks: Array<{ key: string; className: string }> = [];
  for (const pos of H_EDGE) {
    ticks.push(
      { key: `t-${pos}`, className: cn(pos, "top-0 h-[2px] w-[6px] -translate-x-1/2") },
      { key: `b-${pos}`, className: cn(pos, "bottom-0 h-[2px] w-[6px] -translate-x-1/2") },
    );
  }
  for (const pos of V_EDGE) {
    ticks.push(
      { key: `l-${pos}`, className: cn(pos, "left-0 w-[2px] h-[6px] -translate-y-1/2") },
      { key: `r-${pos}`, className: cn(pos, "right-0 w-[2px] h-[6px] -translate-y-1/2") },
    );
  }
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-10">
      {ticks.map((tick) => (
        <span
          key={tick.key}
          className={cn("absolute", tick.className)}
          style={{ background: color }}
        />
      ))}
    </span>
  );
}

/** "1 OF 1" corner diamond for is_exceptional cards. Red on black, always. */
function ExceptionalRibbon() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -right-6 -top-6 z-20 flex h-12 w-12 rotate-45 items-center justify-center border-2 border-[#0B0B0B] bg-[#FF4444] pixel-shadow"
    >
      <span className="-rotate-45 whitespace-nowrap font-mono text-[9px] font-black leading-none tracking-tight text-[#0B0B0B]">
        1 OF 1
      </span>
    </span>
  );
}
