/**
 * app/(market)/socials/page.tsx
 *
 * Where the sidebar club card's Learn more lands: the community links.
 * Hrefs are placeholders until the real community URLs exist.
 */
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Community — FlexSoar",
};

const LINKS = [
  { label: "Join our Discord", href: "https://discord.gg/EQaHFzaRX" },
  { label: "Join our Telegram", href: "https://t.me/flexsoar" },
  { label: "Follow on X", href: "https://x.com/flexsoarnet" },
  { label: "Follow on Instagram", href: "https://www.instagram.com/flexsoarnet/" },
  { label: "Follow on TikTok", href: "https://www.tiktok.com/@flexsoar.net" },
];

export default function SocialsPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <Image
          src="/club-logo.png"
          alt="FlexSoar club"
          width={96}
          height={96}
          className="rounded-2xl"
          priority
        />
        <h1 className="text-2xl font-extrabold tracking-tight">
          Join the FlexSoar club
        </h1>
        <p className="text-sm text-muted">
          Don&apos;t miss hot drops. Early access, member-only heat, and
          collection updates — straight to you.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {LINKS.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-xl border border-line-strong bg-raised px-4 py-3 text-sm font-bold transition hover:border-accent hover:text-accent"
          >
            {link.label}
          </a>
        ))}
      </div>

      <p className="text-center text-xs text-muted">
        Five doors, one club. Pick yours.
      </p>
    </div>
  );
}
