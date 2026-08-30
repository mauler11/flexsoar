import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "FlexSoar — Authenticated Secondhand Sneakers",
  description:
    "Buy, sell, and trade authenticated sneakers. Every card represents a real pair in our vault. List your shoes — we cover authentication, grading, and shipping.",
};

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-overlay">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link
            href="/"
            className="font-mono text-sm font-black uppercase tracking-tight text-accent"
          >
            FlexSoar
          </Link>
          <nav className="flex items-center gap-2">
            <Button href="/market" size="sm" variant="secondary">
              Enter the market
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12">
        <section className="flex flex-col gap-12 max-w-3xl">
          <div className="flex flex-col gap-4 text-center">
            <h1 className="font-mono text-4xl font-black uppercase tracking-tight sm:text-5xl">
              Authenticated secondhand sneakers
            </h1>
            <p className="font-mono text-lg text-muted max-w-2xl mx-auto">
              Every pair is a card you can buy, sell, and trade — and redeem at any
              time to have the actual shoes shipped to you.
            </p>
          </div>

          <div className="space-y-10">
            <article className="border border-line rounded-lg p-6">
              <h2 className="font-mono text-xl font-black uppercase tracking-tight mb-4">
                What is this?
              </h2>
              <div className="prose prose-invert max-w-none font-mono text-base leading-relaxed">
                <p>
                  FlexSoar is a marketplace for authenticated secondhand sneakers.
                  Every pair listed on FlexSoar is represented by a Card. A Card is
                  a digital record of ownership of one specific physical pair of
                  shoes. Cards can be bought, sold, and traded on FlexSoar. The
                  holder of a Card may at any time redeem it — meaning the Card is
                  destroyed and we ship the physical shoes to them.
                </p>
                <p>
                  A Card is a claim on a specific, identified pair of shoes. It is
                  not a security, not a cryptocurrency, not a token, not an NFT,
                  not money, and not a fractional interest — one Card, one pair,
                  always.
                </p>
                <p>
                  There is no chance, randomisation, loot box, pack, crate, or
                  wager mechanic anywhere on FlexSoar. Every transaction is a
                  purchase or exchange of an identified item at a known price.
                </p>
              </div>
            </article>

            <article className="border border-line rounded-lg p-6">
              <h2 className="font-mono text-xl font-black uppercase tracking-tight mb-4">
                Can I sell here?
              </h2>
              <div className="prose prose-invert max-w-none font-mono text-base leading-relaxed">
                <p className="font-bold text-accent mb-4">
                  YES. Listing is open.
                </p>
                <p>
                  If you have shoes to sell, you can list them on FlexSoar.
                  Malaysian consignors keep the shoes until they sell — you only
                  ship after a sale, using the instructions we send you. We cover
                  authentication, grading, photography, vault storage, and shipping
                  to the buyer. There are no upfront costs to list.
                </p>
                <p>
                  You set the asking price. When it sells, you ship within 48
                  hours with tracking. We deduct our commission and any accrued
                  storage fee, then pay you the remainder.
                </p>
              </div>
            </article>

            <article className="border border-line rounded-lg p-6">
              <h2 className="font-mono text-xl font-black uppercase tracking-tight mb-4">
                Is this real?
              </h2>
              <div className="prose prose-invert max-w-none font-mono text-base leading-relaxed">
                <p>
                  Yes. The Card is a claim on one specific physical pair we hold in
                  a vault. Not a token, not an NFT, not a game.
                </p>
                <p>
                  When shoes reach our vault, we inspect them, record them, and
                  store them in a secure, dry, climate-appropriate space. The Card
                  holder is the owner; we are the custodian. Shoes held for
                  FlexSoar users are not our property and are not available to our
                  creditors.
                </p>
                <p>
                  You can redeem any active Card you hold at any time. Redemption
                  destroys the Card permanently and we ship you the shoes. You pay
                  shipping at cost plus a handling fee. International shipping from
                  Malaysia is typically USD 40–80 and we do not mark it up.
                </p>
              </div>
            </article>
          </div>

          <div className="text-center pt-8">
            <Button href="/market" size="lg" className="w-full sm:w-auto">
              Enter the market
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-8 text-center">
        <nav className="flex flex-col sm:flex-row items-center justify-center gap-4 font-mono text-[11px] uppercase tracking-tight text-muted">
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <span className="flex-1 sm:flex-none text-center">
            FlexSoar · Authenticated secondhand sneakers
          </span>
        </nav>
      </footer>
    </div>
  );
}