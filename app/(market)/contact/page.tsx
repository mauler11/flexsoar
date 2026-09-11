/**
 * app/(market)/contact/page.tsx
 *
 * Where to reach a human: support inbox, phone/WhatsApp, and community.
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contact — FlexSoar",
};

export default function ContactPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Contact</h1>
        <p className="mt-1 text-sm text-muted">
          Support, authentication questions, and payout help.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-5 text-[15px]">
        <p>
          <span className="text-muted">Email — </span>
          <a
            href="mailto:info@flexsoar.net"
            className="font-semibold text-accent hover:underline"
          >
            info@flexsoar.net
          </a>
        </p>
        <p>
          <span className="text-muted">Phone / WhatsApp — </span>
          <a
            href="tel:+601128375246"
            className="font-semibold text-accent hover:underline"
          >
            +60 11-2837 5246
          </a>
        </p>
        <p>
          <span className="text-muted">Community — </span>
          <Link
            href="/socials"
            className="font-semibold text-accent hover:underline"
          >
            Discord, Telegram, X, Instagram, TikTok
          </Link>
        </p>
      </div>

      <p className="text-[13px] text-muted">
        For order issues, include your order reference (the 8 characters from
        your dashboard) so we can find it immediately.
      </p>
    </div>
  );
}
