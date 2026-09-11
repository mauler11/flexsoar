import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import fs from "fs";
import path from "path";
import { remark } from "remark";
import html from "remark-html";

export const metadata: Metadata = {
  title: "Terms of Service — FlexSoar",
};

function getTermsContent(): string {
  const filePath = path.join(process.cwd(), "docs", "TERMS.md");
  return fs.readFileSync(filePath, "utf-8");
}

function markdownToHtml(markdown: string): string {
  const processed = remark().use(html).processSync(markdown);
  return processed.toString();
}

export default function TermsPage() {
  const content = getTermsContent();
  const htmlContent = markdownToHtml(content);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-overlay">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" aria-label="FlexSoar home" className="shrink-0">
            <Image
              src="/logo-white-big.png"
              alt="FlexSoar"
              width={150}
              height={50}
              priority
            />
          </Link>
          <nav className="flex items-center gap-2">
            <Button href="/market" size="md" variant="secondary" className="rounded-lg">
              Enter the Market
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <article className="max-w-none text-[15px] leading-relaxed text-foreground/90 [&>h1]:mb-4 [&>h1]:text-3xl [&>h1]:font-extrabold [&>h1]:tracking-tight [&>h2]:mb-2 [&>h2]:mt-8 [&>h2]:text-xl [&>h2]:font-extrabold [&>h2]:tracking-tight [&>h3]:mb-1 [&>h3]:mt-6 [&>h3]:text-base [&>h3]:font-bold [&>p]:mb-4 [&_a]:text-accent [&_a]:hover:underline [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_strong]:text-foreground [&_hr]:my-8 [&_hr]:border-line">
          <div
            className="markdown-content"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        </article>
      </main>

      <footer className="border-t border-line py-8 text-center">
        <nav className="flex flex-col sm:flex-row items-center justify-center gap-4 text-[13px] text-muted">
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
    </div>
  );
}