/**
 * components/market/PrivyProviders.tsx
 *
 * Privy SDK root for embedded Solana wallets (Phase B). No-ops to plain
 * children when NEXT_PUBLIC_PRIVY_APP_ID is unset, so every consumer keeps
 * working Phantom-only — the buy and link flows check that same variable
 * before touching Privy hooks, and hooks never run without the provider.
 *
 * Deliberately NO solana.rpcs override: that config only feeds Privy's own
 * embedded-wallet UI flows, which we don't use (we call the wallet methods
 * directly with our unsigned transactions). Wiring it would need
 * createSolanaRpc from @solana/kit — a second install for zero benefit.
 * Broadcasts go out over the wallet's own connection, same as Phantom.
 */
"use client";

import { PrivyProvider } from "@privy-io/react-auth";

export function PrivyProviders({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <>{children}</>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        embeddedWallets: {
          solana: {
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
