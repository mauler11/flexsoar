import type { Metadata } from "next";
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

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <article className="prose prose-invert max-w-none font-mono text-base leading-relaxed">
          <div
            className="markdown-content"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        </article>
      </main>

      <footer className="border-t border-line py-8 text-center">
        <nav className="flex flex-col sm:flex-row items-center justify-center gap-4 font-mono text-[11px] uppercase tracking-tight text-muted">
          <Link href="/" className="hover:text-foreground">
            Home
          </Link>
          <Link href="/market" className="hover:text-foreground">
            Market
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
        </nav>
      </footer>
    </div>
  );
}