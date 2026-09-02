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
import { MarketNav, type MarketNavItem } from "@/components/market/MarketNav";
import { NotificationBell } from "@/components/market/NotificationBell";

export const metadata: Metadata = {
  title: "FlexSoar Market",
  description:
    "Level-gated, oracle-priced card market. Mint cards into claims, list them, and settle sales through Stripe.",
};

/** Placeholder for notification contract export — replace when listNotifications/markNotificationRead land. */
async function getNotifications(_userId: string): Promise<{
  notifications: Array<{
    id: string;
    type: "submission_approved" | "card_sold" | "card_redeemed" | "payout_sent";
    title: string;
    body: string;
    createdAt: string;
    read: boolean;
    link?: string;
    linkLabel?: string;
  }>;
  unreadCount: number;
}> {
  return { notifications: [], unreadCount: 0 };
}

export default async function MarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const meId = await currentUserId();
  const me = meId ? await getUser({ id: meId }).catch(() => null) : null;

  const navItems: MarketNavItem[] = [
    { href: "/market", label: "Market" },
    { href: "/list", label: "List" },
    ...(me
      ? [
          { href: "/dashboard", label: "Dashboard" },
          { href: `/u/${me.handle}`, label: "Profile" },
        ]
      : []),
  ];

  const { notifications, unreadCount } = meId
    ? await getNotifications(meId)
    : { notifications: [], unreadCount: 0 };

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
            <MarketNav items={navItems} />
            <div className="flex items-center gap-2">
              {me ? (
                <>
                  <NotificationBell
                    notifications={notifications}
                    onMarkRead={() => {}}
                    unreadCount={unreadCount}
                  />
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
          <nav className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <span>FlexSoar · Market — mint, list, settle</span>
          </nav>
        </footer>
      </ToastProvider>
    </div>
  );
}