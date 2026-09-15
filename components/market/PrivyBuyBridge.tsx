/**
 * components/market/PrivyBuyBridge.tsx
 *
 * Hook-rule bridge: useWallets() throws outside a configured provider, so
 * this wrapper only mounts the hook-aware panel when NEXT_PUBLIC_PRIVY_APP_ID
 * is set (exactly the condition PrivyProviders uses to install the
 * provider). Otherwise the plain Phantom-only panel renders — same props,
 * no behavior change.
 */
"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { SolanaBuyPanel } from "./SolanaBuyPanel";

export function SolanaBuyPanelRoot({
  listingId,
  priceCents,
}: {
  listingId: string;
  priceCents: number;
}) {
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return <SolanaBuyPanel listingId={listingId} priceCents={priceCents} />;
  }
  return <PrivyAwareBuyPanel listingId={listingId} priceCents={priceCents} />;
}

function PrivyAwareBuyPanel({
  listingId,
  priceCents,
}: {
  listingId: string;
  priceCents: number;
}) {
  const { ready } = usePrivy();
  const { wallets } = useWallets();
  return (
    <SolanaBuyPanel
      listingId={listingId}
      priceCents={priceCents}
      privyWallets={ready ? wallets : []}
    />
  );
}
