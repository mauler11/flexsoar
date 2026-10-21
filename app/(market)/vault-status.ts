/**
 * app/(market)/vault-status.ts
 *
 * The one rule for showing an item as "Vaulted" (founder decision,
 * 2026-10-20): only with a custody record proving FlexSoar physically holds
 * the pair AND has authenticated it — `items.custody === 'warehouse'` plus a
 * non-null `items.authenticated_at`.
 *
 * Custody alone is not enough: `items.custody` is NOT NULL DEFAULT
 * 'warehouse' (013_seller_custody.sql:54), so any row created without an
 * explicit custody reads as warehouse whether or not a shoe ever arrived.
 * Who listed the item (admin, mod, a handle) is deliberately not an input.
 *
 * Pure — no Supabase, no `next/headers` — so it is directly unit-testable.
 */
import type { CustodyModel, Timestamptz } from "@/lib/db/types";

export interface CustodyFacts {
  /** `items.custody`. Optional because the `Item` db type predates 013. */
  custody?: CustodyModel | null;
  /** `items.authenticated_at`. */
  authenticated_at: Timestamptz | null;
}

export type VaultState = "vaulted" | "awaiting_intake" | "held_by_seller";

export function vaultState(item: CustodyFacts): VaultState {
  if (item.custody === "seller") return "held_by_seller";
  if (item.custody === "warehouse" && item.authenticated_at != null) return "vaulted";
  return "awaiting_intake";
}

export function isVaulted(item: CustodyFacts): boolean {
  return vaultState(item) === "vaulted";
}

export const VAULT_STATE_LABEL: Record<VaultState, string> = {
  vaulted: "Vaulted",
  awaiting_intake: "Awaiting vault intake",
  held_by_seller: "Held by seller",
};
