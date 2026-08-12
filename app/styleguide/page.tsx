/**
 * app/styleguide/page.tsx
 *
 * The review surface: every primitive and every card state, rendered purely
 * from lib/mock/fixtures. No fetching anywhere.
 *
 *   - all 5 tiers + exceptional (frame ornament, greyscale-proof)
 *   - all 5 float bands
 *   - all three sprite silhouettes across the fixture colourways
 *   - every ui primitive in every state
 */
import type { ReactNode } from "react";
import type { Card } from "@/lib/db/types";
import {
  cards,
  skuById,
  userById,
  activeListingForCard,
} from "@/lib/mock/fixtures";
import { borderColorFor, tierName } from "@/lib/domain/rarity";
import { HIGH_TOP, LOW_TOP, MID_TOP, PALETTES } from "@/lib/sprites";
import type { SpriteMap } from "@/lib/sprites";
import { CardArt } from "@/components/card/CardArt";
import { CardFrame } from "@/components/card/CardFrame";
import { CardDetail } from "@/components/card/CardDetail";
import { CardTile } from "@/components/card/CardTile";
import { FloatBar } from "@/components/card/FloatBar";
import { Sprite } from "@/components/card/Sprite";
import { TierBadge } from "@/components/card/TierBadge";
import { formatFsc, formatMyr } from "@/components/card/format";
import { oracleValueCents } from "@/components/card/value";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  Table,
  TBody,
  THead,
  Td,
  Th,
  Tr,
} from "@/components/ui/Table";
import { ToastProvider } from "@/components/ui/Toast";
import { InteractionsDemo } from "./interactions";

const SWATCHES: { name: string; value: string }[] = [
  { name: "background", value: "#0B0B0B" },
  { name: "raised", value: "#141414" },
  { name: "overlay", value: "#000000" },
  { name: "line", value: "#262626" },
  { name: "line-strong", value: "#3A3A3A" },
  { name: "muted", value: "#9A9A9A" },
  { name: "foreground", value: "#EDECE7" },
  { name: "accent", value: "#35F07A" },
];

/** Representative fixture cards, one per tier plus the exceptional flag. */
const TIER_DEMO: Card[] = [
  cards.find((c) => c.tier === 1)!,
  cards.find((c) => c.tier === 2)!,
  cards.find((c) => c.tier === 3)!,
  cards.find((c) => c.tier === 4)!,
  cards.find((c) => c.tier === 5 && !c.is_exceptional)!,
  cards.find((c) => c.is_exceptional)!,
];

/** One fixture float per condition band, for the FloatBar section. */
const BAND_DEMO = [
  { label: "FN · card #01", float: cards[0].float_value },
  { label: "MW · card #06", float: cards[5].float_value },
  { label: "FT · card #05", float: cards[4].float_value },
  { label: "WW · card #07", float: cards[6].float_value },
  { label: "BS · card #11", float: cards[10].float_value },
] as const;

const EMPTY_ICON = (
  <div aria-hidden className="grid grid-cols-4 gap-0.5">
    {Array.from({ length: 12 }).map((_, i) => (
      <span key={i} className="h-1.5 w-1.5 bg-line-strong" />
    ))}
  </div>
);

/** The Sprites section: all three silhouettes, one block per shipped palette. */
const SPRITE_ROWS: { label: string; map: SpriteMap }[] = [
  { label: "High-top", map: HIGH_TOP },
  { label: "Mid-top", map: MID_TOP },
  { label: "Low-top", map: LOW_TOP },
];

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line pb-2 pt-8">
      <h2 className="font-mono text-sm font-bold uppercase tracking-tight">
        {title}
      </h2>
      {subtitle != null && (
        <p className="mt-1 max-w-2xl font-mono text-[11px] leading-snug tracking-tight text-muted">
          {subtitle}
        </p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** A frame in isolation: art + tier label, to review the ornament alone. */
function FrameDemo({ card }: { card: Card }) {
  const sku = skuById(card.sku_id);
  if (!sku) return null;
  const color = borderColorFor(card.tier, card.is_exceptional);
  return (
    <div className="flex flex-col items-center gap-2">
      <CardFrame
        tier={card.tier}
        isExceptional={card.is_exceptional}
        className="w-44 bg-raised"
      >
        <div className="flex flex-col items-center gap-1.5 p-2">
          <CardArt sku={sku} />
          <span
            className="font-mono text-[10px] font-bold uppercase tracking-tight"
            style={{ color }}
          >
            {card.is_exceptional ? "1 OF 1" : tierName(card.tier)}
          </span>
        </div>
      </CardFrame>
      <span className="font-mono text-[9px] uppercase tracking-tight text-muted">
        {card.is_exceptional ? `exceptional · ${tierName(card.tier)}` : tierName(card.tier)}
      </span>
    </div>
  );
}

export default function StyleguidePage() {
  return (
    <ToastProvider>
      <main className="mx-auto w-full max-w-6xl px-4 py-10">
        <header className="flex flex-col gap-2 pb-8">
          <span className="font-mono text-[10px] uppercase tracking-tight text-accent">
            flexsoar · design system
          </span>
          <h1 className="text-2xl font-bold uppercase tracking-tight">
            Styleguide
          </h1>
          <p className="max-w-3xl font-mono text-[12px] leading-relaxed tracking-tight text-muted">
            Near-black surfaces, monospace type, chunky pixel art. Rarity is
            signalled by border colour <em>and</em> escalating frame ornament —
            colour alone is never the only signal. The greyscale strip below
            proves it. Everything on this page renders from fixtures; nothing
            is fetched.
          </p>
        </header>

        {/* ------------------------------------------------------------ */}
        <Section
          title="Tokens"
          subtitle="The palette. Cards add tier colours (#7A7A7A / #35F07A / #3B9EFF / #A855F7 / #E8B33A) and the exceptional red (#FF4444), always paired with an ornament."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {SWATCHES.map((swatch) => (
              <div key={swatch.name} className="border border-line bg-raised p-2">
                <div
                  className="h-10 w-full border border-line-strong"
                  style={{ background: swatch.value }}
                />
                <div className="mt-1.5 font-mono text-[9px] uppercase tracking-tight text-muted">
                  {swatch.name}
                </div>
                <div className="font-mono text-[9px] tracking-tight">
                  {swatch.value}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          title="Type"
          subtitle="Monospace everywhere. Uppercase + tracking-tight for labels; the price figure is the loudest thing on a card."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div className="text-2xl font-bold uppercase tracking-tight">
                Air Jordan 1 Retro High OG
              </div>
              <div className="text-lg font-bold tracking-tight">1280.00 FSC</div>
              <div className="text-[12px] tracking-tight text-muted">
                Chicago Lost and Found · US 10.5
              </div>
              <div className="text-[10px] uppercase tracking-tight text-muted">
                label · muted · uppercase
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="font-bold">0.071</div>
              <div className="text-muted">FN MW FT WW BS — condition bands</div>
              <div className="text-[11px] leading-relaxed tracking-tight text-muted">
                Float is condition, tier is value. A pristine float on a cheap
                shoe is a mint-condition Common, never a Legendary.
              </div>
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          title="Sprites"
          subtitle="All three silhouettes across all four shipped palettes. One map, many colourways — swap skus.palette, keep the silhouette. px=2 is the thumbnail size, px=7 the hero."
        >
          <div className="flex flex-col gap-8">
            {SPRITE_ROWS.map(({ label, map }) => (
              <div key={label}>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-tight text-muted">
                  {label}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(PALETTES).map(([name, palette]) => (
                    <div key={name} className="border border-line bg-raised p-4">
                      <div className="mb-3 font-mono text-[9px] uppercase tracking-tight text-muted">
                        {name.replace("_", " ")}
                      </div>
                      <div className="flex flex-wrap items-end gap-6">
                        {[2, 4, 7].map((px) => (
                          <Sprite key={px} map={map} palette={palette} px={px} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          title="Rarity frames"
          subtitle="Common gets a 1px border; ornament stacks from there — corner studs, top bar, inner hairline, edge marks. Exceptional keeps its tier's ornament but goes red with a 1 OF 1 ribbon. Below the full set, the same frames in greyscale: the ornament carries the signal alone."
        >
          <div className="flex flex-wrap gap-6">
            {TIER_DEMO.map((card) => (
              <FrameDemo key={card.id} card={card} />
            ))}
          </div>
          <div className="mt-6">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-tight text-muted">
              Greyscale proof — filter: grayscale(1)
            </div>
            <div className="[filter:grayscale(1)] flex flex-wrap gap-6">
              {TIER_DEMO.map((card) => (
                <FrameDemo key={card.id} card={card} />
              ))}
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          title="Float bar"
          subtitle="0.000–1.000, marker at position, band read out above. Colour shifts green → olive → brown; label + marker do the work in greyscale."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {BAND_DEMO.map((demo) => (
              <div key={demo.label} className="border border-line bg-raised p-3">
                <div className="mb-2 font-mono text-[9px] uppercase tracking-tight text-muted">
                  {demo.label}
                </div>
                <FloatBar float={demo.float} />
              </div>
            ))}
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          title="Card tiles"
          subtitle="All 12 fixture cards in a grid. Live listings show the ask price and a LISTED chip; everything else shows its oracle value. 1 OF 1 red on card #12."
        >
          <div className="flex flex-wrap justify-center gap-6">
            {cards.map((card) => {
              const sku = skuById(card.sku_id);
              if (!sku) return null;
              const listing = activeListingForCard(card.id);
              return (
                <CardTile
                  key={card.id}
                  card={card}
                  sku={sku}
                  listing={listing}
                  priceCents={listing?.price_cents ?? null}
                />
              );
            })}
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          title="Card detail (hero)"
          subtitle="Full-width frame, sprite at scale, percentile badge, mint number, price in FSC with the ringgit conversion beneath. Oracle fair value is always shown beside an ask."
        >
          <div className="flex flex-col gap-6">
            <CardDetail
              card={cards[11]}
              sku={skuById(cards[11].sku_id)!}
              listing={activeListingForCard(cards[11].id)}
            />
            <CardDetail
              card={cards[3]}
              sku={skuById(cards[3].sku_id)!}
              listing={activeListingForCard(cards[3].id)}
              priceCents={activeListingForCard(cards[3].id)?.price_cents ?? null}
            />
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          title="Buttons"
          subtitle="Chunky offset shadow, pressed state shifts the shadow onto the button. Href renders an anchor."
        >
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" size="sm">Small</Button>
            <Button variant="primary" size="md">Medium</Button>
            <Button variant="primary" size="lg">Large</Button>
            <Button variant="secondary" disabled>Disabled</Button>
            <Button variant="primary" href="#tokens">Link button</Button>
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          title="Input & select"
          subtitle="Label, hint, inline error, disabled. Errors tint the border and outline red."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="Float" placeholder="0.000" hint="Human-graded, 3 decimals." />
            <Input
              label="Reserve price"
              placeholder="30000"
              error="Must be greater than zero"
            />
            <Input label="Disabled" defaultValue="locked" disabled />
            <Select
              label="Condition band"
              options={[
                { value: "FN", label: "FN — Factory New" },
                { value: "MW", label: "MW — Minimal Wear" },
                { value: "FT", label: "FT — Field-Tested" },
              ]}
            />
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section title="Badges" subtitle="Tones map to the palette; the leading pixel square keeps tone readable in greyscale.">
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">Neutral</Badge>
            <Badge tone="accent">Accent</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="warn">Warn</Badge>
            <Badge tone="danger">Danger</Badge>
            <TierBadge tier={1} />
            <TierBadge tier={2} />
            <TierBadge tier={3} />
            <TierBadge tier={4} />
            <TierBadge tier={5} />
            <TierBadge tier={5} isExceptional />
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          title="Table"
          subtitle="Fixture cards joined to SKU + owner. Oracle value per fn_card_value_cents mirror."
        >
          <Table>
            <THead>
              <Tr>
                <Th>Mint</Th>
                <Th>Card</Th>
                <Th>Tier</Th>
                <Th className="text-right">Float</Th>
                <Th className="text-right">PCT</Th>
                <Th>Owner</Th>
                <Th className="text-right">Value</Th>
              </Tr>
            </THead>
            <TBody>
              {cards.map((card) => {
                const sku = skuById(card.sku_id);
                const owner = userById(card.owner_id);
                if (!sku || !owner) return null;
                const value = oracleValueCents(card, sku);
                return (
                  <Tr key={card.id}>
                    <Td className="text-muted">
                      #{String(card.mint_number).padStart(2, "0")}
                    </Td>
                    <Td>
                      {sku.brand} {sku.model}
                    </Td>
                    <Td>
                      <TierBadge tier={card.tier} isExceptional={card.is_exceptional} />
                    </Td>
                    <Td className="text-right">{card.float_value.toFixed(3)}</Td>
                    <Td className="text-right">
                      {card.float_percentile?.toFixed(2) ?? "—"}
                    </Td>
                    <Td className="text-muted">{owner.handle}</Td>
                    <Td className="text-right">
                      {value != null ? formatFsc(value) : "—"}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          title="Modal, toast & interactive controls"
          subtitle="Client-side primitives. Modal locks scroll and closes on Escape; toasts auto-dismiss."
        >
          <InteractionsDemo />
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          title="Empty state"
          subtitle="The 'nothing here' panel, with and without an action."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <EmptyState
              icon={EMPTY_ICON}
              title="No cards minted yet"
              description="Cards appear here once items are graded, authenticated, and minted out of a completed consignment."
            />
            <EmptyState
              icon={EMPTY_ICON}
              title="No watchlist alerts"
              description="Set a max float or max price on a SKU to get pinged."
              action={<Button variant="secondary" size="sm">Browse SKUs</Button>}
            />
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section title="Skeleton" subtitle="Placeholder while a card row loads.">
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="border border-line bg-raised p-3">
              <Skeleton className="h-24" />
              <div className="mt-2">
                <Skeleton lines={2} />
              </div>
            </div>
            <div className="border border-line bg-raised p-3">
              <Skeleton className="h-24" />
              <div className="mt-2">
                <Skeleton lines={3} />
              </div>
            </div>
          </div>
        </Section>

        <footer className="border-t border-line pt-6 pb-4 font-mono text-[10px] leading-relaxed tracking-tight text-muted">
          <div>
            Tier is value. Float is condition. Exceptional is a flag, not a
            tier — the red 1 OF 1 ribbon sits on top of tier 5, never instead of it.
          </div>
          <div className="mt-1">
            All prices are FSC (1 FSC = 1 USD). Ringgit conversions shown here use a fixed
            display rate of {formatMyr(10000)} to {formatFsc(10000)} and are display only.
          </div>
        </footer>
      </main>
    </ToastProvider>
  );
}
