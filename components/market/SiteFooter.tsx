import Link from "next/link";

/**
 * components/market/SiteFooter.tsx
 *
 * The shared bottom-of-page: About Us, Terms, Privacy, Contact, Socials,
 * then the copyright line.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-line py-6 text-center">
      <nav className="flex flex-col items-center justify-center gap-3 text-[13px] text-muted sm:flex-row sm:gap-5">
        <Link href="/about" className="hover:text-foreground">
          About Us
        </Link>
        <Link href="/terms" className="hover:text-foreground">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <Link href="/contact" className="hover:text-foreground">
          Contact
        </Link>
        <Link href="/socials" className="hover:text-foreground">
          Socials
        </Link>
      </nav>
      <p className="mt-3 text-xs text-muted">
        © 2026 FlexSoar. All rights reserved.
      </p>
    </footer>
  );
}
