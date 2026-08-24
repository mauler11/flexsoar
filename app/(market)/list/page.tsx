/**
 * app/(market)/list/page.tsx
 *
 * The self-serve listing flow. Server page: it resolves the live SKU catalog
 * and the caller's payout facts once, then hands the wizard all the data it
 * needs as props. The wizard stays client-side so steps survive back/next
 * without re-fetching.
 */
import type { Metadata } from "next";
import { getSkus, getPayoutMethodForUser, getUser } from "@/lib/api/contract";
import { currentUserId, getCashPayoutCountryCodes } from "@/app/(market)/queries";
import { IntakeWizard } from "@/components/market/intake/IntakeWizard";

export const metadata: Metadata = {
  title: "List a shoe — FlexSoar Market",
};

export default async function ListPage() {
  const skus = await getSkus({});

  // How THIS seller will actually be paid — geography-derived
  // (fn_payout_method_for_user), never a choice. Read before they commit to
  // a listing, not surfaced only after it sells.
  const me = await currentUserId();
  const [sellerPayoutMethod, existingCountryCode, cashPayoutCountryCodes] = await Promise.all([
    me ? getPayoutMethodForUser(me).catch(() => null) : Promise.resolve(null),
    me ? getUser({ id: me }).then((u) => u?.country_code ?? null) : Promise.resolve(null),
    getCashPayoutCountryCodes().catch(() => [] as string[]),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-mono text-xl font-black uppercase tracking-tight">
          List a shoe
        </h1>
        <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
          Four photos · honest condition · you set the reserve
        </p>
      </div>

      <IntakeWizard
        skus={skus}
        signedIn={me != null}
        sellerPayoutMethod={sellerPayoutMethod}
        initialCountryCode={existingCountryCode}
        cashPayoutCountryCodes={cashPayoutCountryCodes}
      />
    </div>
  );
}