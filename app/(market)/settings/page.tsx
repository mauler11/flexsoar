import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/api/contract";
import { currentUserId } from "@/app/(market)/queries";
import { UsernameEditor } from "@/components/market/UsernameEditor";
import { FiatSelect } from "@/components/market/Fiat";
import { ThemeToggle } from "@/components/market/ThemeToggle";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = {
  title: "Settings — FlexSoar Market",
};

export default async function SettingsPage() {
  const me = await currentUserId();
  if (!me) redirect("/sign-in?next=/settings");
  const user = await getUser({ id: me }).catch(() => null);
  if (!user) redirect("/sign-in?next=/settings");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>

      <section aria-label="Account" className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Email
          </span>
          <p className="truncate text-sm font-semibold">{user.email}</p>
          <p className="text-[11px] text-muted">
            Sign-in email — to change it, contact support.
          </p>
        </div>
        <UsernameEditor initial={user.handle} />
      </section>

      <section aria-label="Payment options" className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-4">
        <h2 className="text-sm font-extrabold tracking-tight">Payment options</h2>
        <p className="text-[13px] leading-snug text-muted">
          Card payments, Stripe Connect bank payouts, and your USDC wallet
          live here.
        </p>
        <Link
          href="/payouts"
          className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-[#0B0B0B] transition hover:brightness-110"
        >
          Manage in Payouts →
        </Link>
      </section>

      <section aria-label="Display currency" className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-4">
        <h2 className="text-sm font-extrabold tracking-tight">Display currency</h2>
        <p className="text-[13px] leading-snug text-muted">
          Prices across the site render in this currency. Checkout and the
          ledger always settle in MYR.
        </p>
        <div className="w-40">
          <FiatSelect className="w-full rounded-lg border border-line-strong bg-background px-3 py-2 text-sm text-foreground focus:outline-none" />
        </div>
      </section>

      <section aria-label="Appearance" className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-4">
        <h2 className="text-sm font-extrabold tracking-tight">Appearance</h2>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] leading-snug text-muted">
            Light theme preview. Dark stays the default.
          </p>
          <ThemeToggle />
        </div>
      </section>
    </div>
  );
}
