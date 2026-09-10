/**
 * app/(market)/list/new/page.tsx
 *
 * Intake entry from the product page (?modelId=&sizeUs=). Resolves the size
 * variant — ensuring it when the size isn't catalogued yet — then hands the
 * existing wizard a preselected SKU so it opens at Photos. Direct visits
 * without valid params fall back to the search landing.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ensureSkuVariant, getSkuModel, getPayoutMethodForUser, getUser } from "@/lib/api/contract";
import { currentUserId, getCashPayoutCountryCodes } from "@/app/(market)/queries";
import { IntakeWizard } from "@/components/market/intake/IntakeWizard";
import type { UUID } from "@/lib/db/types";

export const metadata: Metadata = {
  title: "Submit your pair — FlexSoar Market",
};

function invalidSize(raw: string | undefined): boolean {
  if (raw == null) return true;
  const n = Number(raw);
  return !Number.isFinite(n) || n < 3 || n > 20 || n * 2 !== Math.floor(n * 2);
}

export default async function ListNewPage({
  searchParams,
}: {
  searchParams: Promise<{ modelId?: string; sizeUs?: string }>;
}) {
  const params = await searchParams;
  const modelId = params.modelId ?? "";
  const sizeRaw = params.sizeUs ?? "";

  if (!/^[0-9a-f-]{36}$/i.test(modelId) || invalidSize(sizeRaw)) {
    redirect("/list");
  }
  const sizeUs = Number(sizeRaw);

  const model = await getSkuModel(modelId as UUID).catch(() => null);
  if (!model) redirect("/list");

  // Existing variant, or ensured on the spot (sellers may ensure variants —
  // the finder flow already does exactly this as the session user).
  let variant = model.variants.find((v) => v.size_us === sizeUs) ?? null;
  if (!variant) {
    try {
      const variantId = await ensureSkuVariant(model.id, sizeUs);
      const refreshed = await getSkuModel(model.id).catch(() => null);
      variant = refreshed?.variants.find((v) => v.id === variantId) ?? null;
    } catch {
      variant = null;
    }
  }
  if (!variant) redirect(`/list/${model.id}`);

  const me = await currentUserId();
  const [sellerPayoutMethod, existingCountryCode, cashPayoutCountryCodes] = await Promise.all([
    me ? getPayoutMethodForUser(me).catch(() => null) : Promise.resolve(null),
    me ? getUser({ id: me }).then((u) => u?.country_code ?? null) : Promise.resolve(null),
    getCashPayoutCountryCodes().catch(() => [] as string[]),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">
          Submit your pair
        </h1>
        <p className="text-sm text-muted">
          {model.brand} {model.model} · {model.colorway} · US {variant.size_us}
          {" · "}
          <Link href={`/list/${model.id}`} className="text-accent hover:underline">
            change size
          </Link>
        </p>
      </div>

      <IntakeWizard
        skus={[]}
        signedIn={me != null}
        sellerPayoutMethod={sellerPayoutMethod}
        initialCountryCode={existingCountryCode}
        cashPayoutCountryCodes={cashPayoutCountryCodes}
        preselected={{ sku: variant, unpriced: model.base_price_cents == null }}
      />
    </div>
  );
}
