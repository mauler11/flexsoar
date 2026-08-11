/**
 * app/(market)/layout.tsx
 *
 * The market shell: brand header, the signed-in handle (or a sign-in link),
 * and the toast container for the whole track. The header is the only piece
 * shared by every market page.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ToastProvider } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { getUser } from "@/lib/api/contract";
import { signOut } from "@/app/(auth)/actions";
import { currentUserId } from "@/app/(market)/queries";

export const metadata: Metadata = {
  title: "FlexSoar Market",
  description:
    "Level-gated, oracle-priced card market. Mint cards into claims, list them, and settle sales through Stripe.",
};

export default async function MarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const meId = await currentUserId();
  const me = meId ? await getUser({ id: meId }).catch(() => null) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <ToastProvider>
        <header className="border-b border-line bg-overlay">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link
              href="/"
              className="font-mono text-sm font-black uppercase tracking-tight text-accent"
            >
              FlexSoar
            </Link>
            <nav
              aria-label="Market"
              className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-tight"
            >
              <span className="border border-accent bg-accent px-1.5 py-0.5 font-bold text-[#0B0B0B]">
                Market
              </span>
              {me && (
                <a
                  href={`/u/${me.handle}`}
                  className="border border-line px-1.5 py-0.5 text-muted hover:text-foreground"
                >
                  Profile
                </a>
              )}
            </nav>
            <div className="flex items-center gap-2">
              {me ? (
                <>
                  <a
                    href={`/u/${me.handle}`}
                    className="font-mono text-[11px] tracking-tight text-muted hover:text-foreground"
                  >
                    @{me.handle} · LV {me.level}
                  </a>
                  <form action={signOut}>
                    <Button type="submit" variant="ghost" size="sm">
                      Sign out
                    </Button>
                  </form>
                </>
              ) : (
                <Button href="/sign-in" size="sm" variant="secondary">
                  Sign in
                </Button>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </main>

        <footer className="border-t border-line py-4 text-center font-mono text-[9px] uppercase tracking-tight text-muted">
          FlexSoar · Market — mint, list, settle
        </footer>
      </ToastProvider>
    </div>
  );
}