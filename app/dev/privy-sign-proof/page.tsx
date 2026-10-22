/**
 * app/dev/privy-sign-proof/page.tsx
 *
 * LOCAL-ONLY dev page: proves whether a Privy embedded Solana wallet's `signMessage` signs the exact bytes it is given
 * (docs/handoff/solana-p1b.md section 7, steps 1-5; run instructions in docs/handoff/privy-sign-proof.md).
 *
 * Not available outside development: any other NODE_ENV renders the standard 404. The runner is imported inside a branch on the
 * compile-time constant `process.env.NODE_ENV === "development"`, so a production build eliminates the branch and emits no runner
 * code at all; the runner also refuses to render outside development (second guard). It lives in a private `_runner` folder so it
 * is not itself a route. It uses the app's existing PrivyProviders, so it needs NEXT_PUBLIC_PRIVY_APP_ID in your own
 * environment; this page contains no credentials.
 */
import { notFound } from "next/navigation";
import { PrivyProviders } from "@/components/market/PrivyProviders";

export const metadata = { title: "Privy signMessage proof (dev only)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PrivySignProofPage() {
  if (process.env.NODE_ENV === "development") {
    const { ProofRunner } = await import("./_runner/ProofRunner");
    return (
      <PrivyProviders>
        <ProofRunner />
      </PrivyProviders>
    );
  }
  notFound();
}
