import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "FlexSoar — Trade Sneakers Instantly. Redeem Them Anytime.",
  description:
    "Buy, sell, and trade authenticated sneakers. Every card represents a real pair in our vault. List your shoes — we cover photography, vault storage, and shipping to the buyer.",
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
              Explore the Vault
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12">
        <section className="flex flex-col gap-12 max-w-3xl">
          {/* Hero Section with Card-to-Box Visualization */}
          <div className="flex flex-col gap-4 text-center">
            <h1 className="font-mono text-4xl font-black uppercase tracking-tight sm:text-5xl">
              Trade Sneakers Instantly. Redeem Them Anytime.
            </h1>
            <p className="font-mono text-lg text-muted max-w-2xl mx-auto">
              Every pair is a card you can buy, sell, and trade — and redeem at any
              time to have the actual shoes shipped to you.
            </p>

            {/* Card-to-Box Animation */}
            <div className="relative mt-8 flex justify-center">
              <div className="flex items-center gap-4">
                {/* Digital Card */}
                <div className="group relative">
                  <div className="absolute inset-0 bg-accent/10 rounded-xl pixel-shadow-lg transition-all duration-500 group-hover:scale-105 group-hover:bg-accent/20" />
                  <div className="relative bg-raised border border-line p-6 w-48 h-64 sm:w-56 sm:h-72 flex flex-col items-center justify-between pixel-shadow">
                    <div className="text-center">
                      <div className="font-mono text-[10px] uppercase tracking-tight text-muted mb-2">Digital Card</div>
                      <div className="font-mono text-xs text-accent font-bold">#0042</div>
                      <div className="font-mono text-[10px] text-muted mt-1">Jordan 1 Retro High</div>
                      <div className="font-mono text-[10px] text-muted">Chicago · US 10</div>
                    </div>
                    <div className="flex items-center justify-center gap-2 text-accent font-mono text-[10px] uppercase tracking-tight">
                      <span>PCT</span>
                      <span className="font-bold">06.2</span>
                    </div>
                    <div className="text-center">
                      <div className="font-mono text-[10px] text-muted">Factory New</div>
                      <div className="font-mono text-sm font-bold text-foreground mt-1">$215.00</div>
                    </div>
                  </div>
                </div>

                {/* Arrow with hover animation */}
                <div className="flex items-center justify-center group">
                  <svg
                    className="w-8 h-8 text-accent transition-transform duration-500 group-hover:translate-x-1 group-hover:scale-110"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4-4 4m-6-8l4 4-4 4" />
                  </svg>
                  <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 font-mono text-[9px] uppercase tracking-tight text-accent opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                    Click to redeem
                  </span>
                </div>

                {/* Physical Box */}
                <div className="group relative">
                  <div className="absolute inset-0 bg-accent/10 rounded-xl pixel-shadow-lg transition-all duration-500 group-hover:scale-105 group-hover:bg-accent/20" />
                  <div className="relative bg-raised border border-line p-6 w-48 h-64 sm:w-56 sm:h-72 flex flex-col items-center justify-between pixel-shadow">
                    <div className="text-center">
                      <div className="font-mono text-[10px] uppercase tracking-tight text-muted mb-2">Physical Box</div>
                      <div className="flex items-center justify-center gap-2 mb-2">
                        <span className="px-1.5 py-0.5 bg-accent text-[#0B0B0B] font-mono text-[9px] font-bold uppercase tracking-tight">FlexSoar Verified</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-center">
                      <svg className="w-16 h-16 text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                    <div className="text-center">
                      <div className="font-mono text-[10px] text-muted">Ships to your door</div>
                      <div className="font-mono text-sm font-bold text-foreground mt-1">Redeemed</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Trust Signals */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border border-line rounded-lg p-4">
            <div className="flex items-center gap-3 p-2">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center pixel-shadow-sm">
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <div className="font-mono text-sm font-bold uppercase tracking-tight">100% Authenticity Guaranteed</div>
                <div className="font-mono text-[10px] uppercase tracking-tight text-muted">Every pair verified</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-2 border-l border-r border-line sm:border-l-0 sm:border-r-0 sm:border-t sm:border-b">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center pixel-shadow-sm">
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div>
                <div className="font-mono text-sm font-bold uppercase tracking-tight">Climate-Controlled Vault Storage</div>
                <div className="font-mono text-[10px] uppercase tracking-tight text-muted">Secure, dry, insured</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-2">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center pixel-shadow-sm">
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <div className="font-mono text-sm font-bold uppercase tracking-tight">Zero Upfront Listing Fees</div>
                <div className="font-mono text-[10px] uppercase tracking-tight text-muted">Pay only after it sells — we cover photography, vault storage, and shipping to the buyer</div>
              </div>
            </div>
          </div>

          {/* Live Market Ticker */}
          <div className="border border-line rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-tight text-muted">Pairs Currently Vaulted</span>
                <span className="font-mono text-xl font-bold text-accent" id="vaulted-count">1,247</span>
              </div>
              <div className="w-px h-6 bg-line-strong" aria-hidden="true" />
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-tight text-muted">Cards Traded This Month</span>
                <span className="font-mono text-xl font-bold text-accent" id="traded-count">3,892</span>
              </div>
            </div>
          </div>

          {/* Split CTA */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Button href="/market" size="lg" className="w-full sm:w-auto">
              Explore the Vault
            </Button>
            <Button href="/list" size="lg" variant="secondary" className="w-full sm:w-auto">
              List Your Sneakers
            </Button>
          </div>

          {/* How It Works Timeline */}
          <div className="space-y-8">
            <h2 className="font-mono text-2xl font-black uppercase tracking-tight text-center">
              How It Works
            </h2>
            <div className="relative">
              {/* Vertical line connector */}
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-line -translate-x-1/2 hidden sm:block" aria-hidden="true" />
              <div className="space-y-8">
                {/* Step 1 */}
                <div className="flex flex-col sm:flex-row items-start gap-6 relative">
                  <div className="flex-shrink-0 w-12 h-12 sm:w-16 sm:h-16 rounded-xl border border-line flex items-center justify-center bg-overlay pixel-shadow relative z-10">
                    <span className="font-mono text-2xl sm:text-3xl font-black text-accent">1</span>
                  </div>
                  <div className="flex-1 pt-2 sm:pt-0">
                    <h3 className="font-mono text-lg font-black uppercase tracking-tight">List or Buy</h3>
                    <p className="font-mono text-base text-muted mt-1 max-w-md">
                      Upload photos to list your sneakers, or browse vaulted Cards ready to trade.
                      No upfront fees — you only ship after a sale.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex flex-col sm:flex-row items-start gap-6 relative">
                  <div className="flex-shrink-0 w-12 h-12 sm:w-16 sm:h-16 rounded-xl border border-line flex items-center justify-center bg-overlay pixel-shadow relative z-10">
                    <span className="font-mono text-2xl sm:text-3xl font-black text-accent">2</span>
                  </div>
                  <div className="flex-1 pt-2 sm:pt-0">
                    <h3 className="font-mono text-lg font-black uppercase tracking-tight">Authenticate & Vault</h3>
                    <p className="font-mono text-base text-muted mt-1 max-w-md">
                      We verify authenticity (documentary review first, physical grading at vault).
                      Shoes stored in climate-controlled, insured facility.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex flex-col sm:flex-row items-start gap-6 relative">
                  <div className="flex-shrink-0 w-12 h-12 sm:w-16 sm:h-16 rounded-xl border border-line flex items-center justify-center bg-overlay pixel-shadow relative z-10">
                    <span className="font-mono text-2xl sm:text-3xl font-black text-accent">3</span>
                  </div>
                  <div className="flex-1 pt-2 sm:pt-0">
                    <h3 className="font-mono text-lg font-black uppercase tracking-tight">Trade Freely</h3>
                    <p className="font-mono text-base text-muted mt-1 max-w-md">
                      Buy, sell, or trade Cards instantly. No shipping delays — ownership
                      transfers digitally until redemption.
                    </p>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="flex flex-col sm:flex-row items-start gap-6 relative">
                  <div className="flex-shrink-0 w-12 h-12 sm:w-16 sm:h-16 rounded-xl border border-line flex items-center justify-center bg-overlay pixel-shadow relative z-10">
                    <span className="font-mono text-2xl sm:text-3xl font-black text-accent">4</span>
                  </div>
                  <div className="flex-1 pt-2 sm:pt-0">
                    <h3 className="font-mono text-lg font-black uppercase tracking-tight">Redeem Anytime</h3>
                    <p className="font-mono text-base text-muted mt-1 max-w-md">
                      Click redeem and we ship the physical pair to your door. You pay
                      shipping at cost plus handling. International typically USD 40–80.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Legal Disclaimer - softened */}
          <details className="border border-line rounded-lg bg-overlay/50">
            <summary className="p-4 font-mono text-sm uppercase tracking-tight text-muted cursor-pointer flex items-center justify-between">
              Legal disclosures
              <svg className="w-4 h-4 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="px-4 pb-4 font-mono text-[11px] text-muted leading-relaxed space-y-2">
              <p>A Card is a claim on a specific, identified pair of shoes. It is not a security, not a cryptocurrency, not a token, not an NFT, not money, and not a fractional interest — one Card, one pair, always.</p>
              <p>There is no chance, randomisation, loot box, pack, crate, or wager mechanic anywhere on FlexSoar. Every transaction is a purchase or exchange of an identified item at a known price.</p>
              <p>Nothing on FlexSoar is investment advice. We do not guarantee liquidity, price appreciation, or investment returns. Market values shown are estimates, not offers to buy.</p>
              <p className="text-accent">Full terms at <Link href="/terms" className="underline hover:text-foreground">flexsoar.net/terms</Link></p>
            </div>
          </details>
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
            FlexSoar · Trade Sneakers Instantly. Redeem Them Anytime.
          </span>
        </nav>
      </footer>
    </div>
  );
}