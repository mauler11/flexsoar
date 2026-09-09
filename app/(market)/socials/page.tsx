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
  { label: "Join our Discord", href: "#" },
  { label: "Join our Telegram", href: "#" },
  { label: "Follow on X", href: "#" },
  { label: "Follow on Instagram", href: "#" },
  { label: "Follow on TikTok", href: "#" },
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
          <Link
            key={link.label}
            href={link.href}
            className="inline-flex items-center justify-center rounded-xl border border-line-strong bg-raised px-4 py-3 text-sm font-bold transition hover:border-accent hover:text-accent"
          >
            {link.label}
          </Link>
        ))}
      </div>

      <p className="text-center text-xs text-muted">
        Links go live soon — the club opens its doors at launch.
      </p>
    </div>
  );
}
