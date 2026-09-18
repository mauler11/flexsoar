/**
 * app/(market)/layout.tsx
 *
 * The market shell: brand header, the signed-in handle (or a sign-in link),
 * and the toast container for the whole track. The header is the only piece
 * shared by every market page.
 */
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { AuthButtons } from "@/components/market/AuthButtons";
import type { Notification as ContractNotification } from "@/lib/api/contract";
import type { Json } from "@/lib/db/types";
import { getUser, listNotifications } from "@/lib/api/contract";
import { createServerSupabase } from "@/lib/supabase/server";
import { currentUserId } from "@/app/(market)/queries";
import { SearchInput } from "@/components/market/SearchInput";
import { Sidebar, type SidebarItem } from "@/components/market/Sidebar";
import { MobileNav, MobileNavButton } from "@/components/market/Sidebar";
import { SiteFooter } from "@/components/market/SiteFooter";
import { OnboardingTour } from "@/components/market/OnboardingTour";
import { NotificationBell } from "@/components/market/NotificationBell";
import { WalletBalance } from "@/components/market/WalletBalance";
import { WalletMenu } from "@/components/market/WalletMenu";
import { FiatProvider, FiatSelect } from "@/components/market/Fiat";
import { PrivyProviders } from "@/components/market/PrivyProviders";
import { UserMenu } from "@/components/market/UserMenu";

interface NotificationPayload {
  sku?: { brand?: string; model?: string; colorway?: string; size_us?: number };
  card_id?: string;
  price_cents?: number;
  amount_cents?: number;
  net_cents?: number;
  first_sale?: boolean;
  must_ship?: boolean;
  brand?: string;
  model?: string;
  colorway?: string;
  model_id?: string;
  review_note?: string;
}

function formatRm(cents: number): string {
  return `RM ${(cents / 100).toFixed(2)}`;
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
    case "request_approved":
      return "Product request approved";
    case "request_rejected":
      return "Product request update";
  }
}

function notificationBody(type: ContractNotification["type"], payload: Json): string {
  const p = payload as NotificationPayload;
  switch (type) {
    case "submission_approved":
      return `Your submission for ${p.sku?.brand ?? "a shoe"} ${p.sku?.model ?? ""} was approved and minted.`;
    case "card_sold": {
      const what = `${p.sku?.brand ?? "Your card"} ${p.sku?.model ?? ""}`.trim();
      const price = p.price_cents ? formatRm(p.price_cents) : "an undisclosed amount";
      if (p.must_ship) {
        return `${what} sold for ${price}. Check your email for shipping instructions — the shoes must reach FlexSoar within 48 hours.`;
      }
      return `${what} sold for ${price}.`;
    }
    case "card_redeemed":
      return `Your ${p.sku?.brand ?? "card"} ${p.sku?.model ?? ""} was redeemed and is being shipped.`;
    case "payout_sent":
      return `A payout of ${p.amount_cents ? formatRm(p.amount_cents) : "funds"} was sent to your account.`;
    case "request_approved":
      return `Your request for ${p.brand ?? "the shoe"} ${p.model ?? ""} was approved — it's now in the catalog and ready to list.`;
    case "request_rejected":
      return `Your request for ${p.brand ?? "the shoe"} ${p.model ?? ""} wasn't added${p.review_note ? `: ${p.review_note}` : "."}`;
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
      return "/payouts";
    case "request_approved":
      return p.model_id ? `/list/${p.model_id}` : "/list";
    case "request_rejected":
      return "/list";
  }
}

function notificationLinkLabel(type: ContractNotification["type"]): string | undefined {
  switch (type) {
    case "submission_approved":
    case "card_sold":
    case "card_redeemed":
      return "View card";
    case "payout_sent":
      return "View payouts";
    case "request_approved":
      return "List it now";
    case "request_rejected":
      return "Back to list";
  }
}

export const metadata: Metadata = {
  title: "FlexSoar Market",
  description:
    "Fair-priced card market. Mint cards into claims, list them, and settle sales through Stripe.",
};

export default async function MarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const meId = await currentUserId();
  const me = meId ? await getUser({ id: meId }).catch(() => null) : null;

  // Per-account Terms state (047): null when signed out (device flag rules),
  // true/false when signed in (account rules, across devices).
  let accountAgreed: boolean | null = null;
  if (meId) {
    const supabase = await createServerSupabase();
    const { data } = await supabase
      .from("users")
      .select("tos_accepted_at")
      .eq("id", meId)
      .maybeSingle();
    if (data) {
      accountAgreed =
        (data as { tos_accepted_at: string | null }).tos_accepted_at != null;
    }
  }

  const sidebarItems: SidebarItem[] = [
    { href: "/market", label: "Market", icon: "market" },
    { href: "/list", label: "List", icon: "list" },
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/payouts", label: "Payouts", icon: "payouts" },
    ...(me
      ? [{ href: `/u/${me.handle}`, label: "Profile", icon: "profile" as const }]
      : [{ href: "/sign-in", label: "Profile", icon: "profile" as const }]),
    ...(me?.is_admin
      ? [{ href: "/admin", label: "Admin", icon: "admin" as const }]
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
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <ToastProvider>
        <OnboardingTour accountAgreed={accountAgreed} />
        <FiatProvider>
        <PrivyProviders>
        <header className="sticky top-0 z-40 border-b border-line bg-background/80 backdrop-blur">
          {/* Row 1: nav + brand + actions. Row 2 (mobile only): search. */}
          <div className="flex w-full flex-col px-3 sm:px-4">
            <div className="flex w-full items-center gap-2 py-3 sm:gap-3">
              <MobileNavButton />
              <Link
                href="/"
                aria-label="FlexSoar home"
                className="shrink-0"
              >
                <Image
                  src="/logo-white-big.png"
                  alt="FlexSoar"
                  width={150}
                  height={50}
                  priority
                  className="h-7 w-auto sm:h-11"
                />
              </Link>
              <div className="mx-auto hidden min-w-0 w-full max-w-xl flex-1 sm:block">
                <Suspense>
                  <SearchInput />
                </Suspense>
              </div>
              {/* Logged in: account cluster is sm+ only — on mobile the
                  header is logo + search, account lives in the drawer. */}
              <div className="hidden shrink-0 items-center gap-3 sm:flex">
                {me ? (
                  <>
                    <WalletBalance />
                    <WalletMenu />
                    <NotificationBell
                      notifications={notifications}
                      unreadCount={unreadCount}
                    />
                    <span className="hidden text-xs font-semibold text-muted sm:inline">
                      LV {me.level}
                    </span>
                    <UserMenu handle={me.handle} />
                    <FiatSelect />
                  </>
                ) : (
                  <>
                    <FiatSelect />
                    <AuthButtons />
                  </>
                )}
              </div>
              {/* Signed out on mobile: auth buttons only (no fiat). */}
              {!me && (
                <div className="ml-auto flex shrink-0 items-center sm:hidden">
                  <AuthButtons />
                </div>
              )}
            </div>
            <div className="w-full pb-3 sm:hidden">
              <Suspense>
                <SearchInput />
              </Suspense>
            </div>
          </div>
        </header>

        <div className="flex flex-1">
          <Sidebar items={sidebarItems} />
          <MobileNav
            items={sidebarItems}
            account={me ? <UserMenu handle={me.handle} /> : undefined}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <main className="mx-auto w-full max-w-6xl flex-1 px-0.5 py-6">
              {children}
            </main>

            <SiteFooter />
          </div>
        </div>
        </PrivyProviders>
        </FiatProvider>
      </ToastProvider>
    </div>
  );
}