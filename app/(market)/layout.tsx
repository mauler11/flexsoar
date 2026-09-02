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
import type { Notification as ContractNotification } from "@/lib/api/contract";
import type { Json } from "@/lib/db/types";
import { getUser, listNotifications } from "@/lib/api/contract";
import { signOut } from "@/app/(auth)/actions";
import { currentUserId } from "@/app/(market)/queries";
import { MarketNav, type MarketNavItem } from "@/components/market/MarketNav";
import { NotificationBell } from "@/components/market/NotificationBell";

interface NotificationPayload {
  sku?: { brand?: string; model?: string; colorway?: string; size_us?: number };
  card_id?: string;
  price_cents?: number;
  amount_cents?: number;
}

function notificationTitle(type: ContractNotification["type"], payload: Json): string {
  switch (type) {
    case "submission_approved":
      return "Submission approved";
    case "card_sold":
      return "Card sold";
    case "card_redeemed":
      return "Card redeemed";
    case "payout_sent":
      return "Payout sent";
  }
}

function notificationBody(type: ContractNotification["type"], payload: Json): string {
  const p = payload as NotificationPayload;
  switch (type) {
    case "submission_approved":
      return `Your submission for ${p.sku?.brand ?? "a shoe"} ${p.sku?.model ?? ""} was approved and minted.`;
    case "card_sold":
      return `Your ${p.sku?.brand ?? "card"} ${p.sku?.model ?? ""} sold for ${p.price_cents ? `$${(p.price_cents / 100).toFixed(2)}` : "an undisclosed amount"}.`;
    case "card_redeemed":
      return `Your ${p.sku?.brand ?? "card"} ${p.sku?.model ?? ""} was redeemed and is being shipped.`;
    case "payout_sent":
      return `A payout of ${p.amount_cents ? `$${(p.amount_cents / 100).toFixed(2)}` : "funds"} was sent to your account.`;
  }
}

function notificationLink(type: ContractNotification["type"], payload: Json): string | undefined {
  const p = payload as NotificationPayload;
  switch (type) {
    case "submission_approved":
      return p.card_id ? `/card/${p.card_id}` : undefined;
    case "card_sold":
      return p.card_id ? `/card/${p.card_id}` : undefined;
    case "card_redeemed":
      return p.card_id ? `/card/${p.card_id}` : undefined;
    case "payout_sent":
      return "/dashboard";
  }
}

function notificationLinkLabel(type: ContractNotification["type"]): string | undefined {
  switch (type) {
    case "submission_approved":
    case "card_sold":
    case "card_redeemed":
      return "View card";
    case "payout_sent":
      return "View dashboard";
  }
}

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

  const { notifications: rawNotifications, unreadCount } = meId
    ? await listNotifications({ userId: meId, limit: 10 })
    : { notifications: [], unreadCount: 0 };

  // Transform contract notifications to NotificationBell format
  const notifications = rawNotifications.map((n: ContractNotification) => ({
    id: n.id,
    type: n.type,
    title: notificationTitle(n.type, n.payload),
    body: notificationBody(n.type, n.payload),
    createdAt: n.created_at,
    read: n.read_at !== null,
    link: notificationLink(n.type, n.payload),
    linkLabel: notificationLinkLabel(n.type),
  }));

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