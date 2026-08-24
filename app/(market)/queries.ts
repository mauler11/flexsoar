/**
 * app/(market)/queries.ts
 *
 * Server-only read helpers for the market surface. NOT a 'use server' module —
 * nothing here is a callable action; these run inside pages and actions.
 *
 * Everything that has a home in lib/api/contract.ts uses it. Three reads have
 * no contract function and are workarounds for that gap until track/data ships
 * `getPublicProfile(handle)` — filed in docs/handoff/market.md item 1:
 *
 *   - public_profiles         to turn a handle into a user id
 *   - levels                  for the rank name of a level
 *   - card_provenance         for a user's trade history
 *
 * All three are flagged below. All three are reads shared with the anon key
 * (public_profiles grants anon; levels and card_provenance have no RLS), and
 * none of them touch the `users` table — the profile page must never read
 * `users`, per AGENT_RULES.md.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { getUser } from "@/lib/api/contract";
import type { ItemStatus, Timestamptz, UUID } from "@/lib/db/types";

/**
 * The redemption handling fee. fn_redeem_card takes the fee as an argument and
 * the schema records it, but nothing in the schema tells a UI what the fee IS.
 * Pinned here pending a levels.perks or platform_config source — see
 * docs/handoff/market.md item 4.
 */
export const REDEMPTION_HANDLING_FEE_CENTS = 1500;

/**
 * The signed-in caller's `users.id`, or null when anonymous. `users.id` equals
 * the Supabase auth id (see lib/db/provision.ts), but reading it through
 * getUser() keeps the id resolution in one place.
 */
export async function currentUserId(): Promise<UUID | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const me = await getUser({ authId: user.id });
  return me?.id ?? null;
}

/** The signed-in caller's `users.level`, or null when anonymous. */
export async function currentUserLevel(): Promise<number | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const me = await getUser({ authId: user.id });
  return me?.level ?? null;
}

// ------------------------------------------------------------
// CASH-PAYOUT COUNTRIES — pending a contract export, filed in
// docs/handoff/market.md
// ------------------------------------------------------------

/**
 * Every country whose sellers are paid in cash — mirrors exactly the
 * membership check `fn_payout_method_for_user` runs against
 * `cash_payout_countries` (019b: `c.country_code = upper(btrim(u.country_code))`),
 * so a code returned here resolves 'cash' for real, not a guess. No contract
 * export exists for this table yet (grepped `contract.ts`: zero hits for
 * "cash_payout_countries"), so this is a direct, server-only, read-only
 * workaround in the established pattern of this file's other reads —
 * `cash_payout_countries` is granted `select` to `anon, authenticated` (019b),
 * so this is not a privilege escalation, and it never touches `users`.
 *
 * Used ONLY to preview payout method for a country the seller has just
 * picked in the listing wizard, before it is (or can be) saved — see
 * docs/handoff/market.md for why saving it is still blocked.
 */
export async function getCashPayoutCountryCodes(): Promise<string[]> {
  const supabase = await createServerSupabase();

  const rows = await supabase.from('cash_payout_countries').select('country_code');
  if (rows.error) {
    throw new Error(rows.error.message.trim() || 'cash_payout_countries read failed');
  }

  return ((rows.data as { country_code: string }[] | null) ?? []).map((row) =>
    row.country_code.toUpperCase(),
  );
}

// ------------------------------------------------------------
// SUBMITTED ITEMS — /dashboard's "Submissions" section, no contract export
// ------------------------------------------------------------

export interface SubmittedItem {
  id: UUID;
  status: ItemStatus;
  askingPriceCents: number | null;
  floatValue: number | null;
  createdAt: Timestamptz;
  sku: { brand: string; model: string; colorway: string; size_us: number };
}

interface SubmittedItemRow {
  id: UUID;
  status: ItemStatus;
  asking_price_cents: number | null;
  float_value: number | null;
  created_at: Timestamptz;
  sku: { brand: string; model: string; colorway: string; size_us: number } | null;
}

/**
 * Every item this user has ever submitted (consignor_id = them), newest
 * first — the self-serve `/list` wizard's `submitListing()` (013/019c) never
 * sets `items.consignment_id`, so `getConsignments({ consignorId })` (the
 * contract's own export, driving /dashboard's old "Submissions" section)
 * never returns them: nothing writes the `consignments` table at all
 * (grepped every migration for "insert into consignments": zero hits). A
 * seller who submits through /list had no way to see it was recorded.
 *
 * No contract export covers "my items" either — `getItems()`'s `ItemsQuery`
 * has no consignor/holder filter, only `status`/`consignmentId`/
 * `graded`/`authenticated` (lib/api/contract.ts), and it paginates
 * `created_at` ascending across every RLS-visible row (including every
 * other seller's public listings), so an unfiltered call could push a
 * seller's own newest submission off the first page entirely — not a
 * reliable "my submissions" read. This queries `items` directly instead,
 * scoped to `consignor_id = userId` so pagination never comes into it.
 * `items_consignor_read` (004_rls_and_grants.sql) already grants exactly
 * this — `consignor_id = fn_current_user_id()` — so a caller can only ever
 * read their own rows here, same guarantee the frozen contract's reads rely
 * on. Same established pattern as this file's other workaround reads:
 * server-only, session client, never `users`.
 */
export async function getMySubmittedItems(userId: UUID): Promise<SubmittedItem[]> {
  const supabase = await createServerSupabase();

  const rows = await supabase
    .from("items")
    .select(
      "id, status, asking_price_cents, float_value, created_at, " +
        "sku:skus(brand, model, colorway, size_us)",
    )
    .eq("consignor_id", userId)
    .order("created_at", { ascending: false });

  if (rows.error) throw new Error(rows.error.message.trim() || "items read failed");

  return ((rows.data as unknown as SubmittedItemRow[] | null) ?? [])
    .filter((row): row is SubmittedItemRow & { sku: NonNullable<SubmittedItemRow["sku"]> } =>
      row.sku != null,
    )
    .map((row) => ({
      id: row.id,
      status: row.status,
      askingPriceCents: row.asking_price_cents,
      floatValue: row.float_value,
      createdAt: row.created_at,
      sku: row.sku,
    }));
}

// ------------------------------------------------------------
// WORKAROUND READS — pending getPublicProfile (handoff item 1)
// ------------------------------------------------------------

export interface PublicProfile {
  id: UUID;
  handle: string;
  level: number;
  rankName: string;
  xp_total: number;
  portfolio_value_cents: number;
  created_at: Timestamptz;
}

/**
 * A profile by handle, from public_profiles + levels. Returns null when no
 * such user exists (or, since handles are citext, when the casing is wrong —
 * the view performs no case folding on lookup).
 *
 * Reads `public_profiles`, never `users`. The view is granted to anon, so this
 * works for anonymous visitors too.
 */
export async function getPublicProfileByHandle(
  handle: string,
): Promise<PublicProfile | null> {
  const supabase = await createServerSupabase();

  const profile = await supabase
    .from("public_profiles")
    .select("id, handle, level, xp_total, portfolio_value_cents, created_at")
    .eq("handle", handle)
    .maybeSingle();

  if (profile.error && profile.error.code !== "PGRST116") {
    throw new Error(profile.error.message.trim() || "public_profiles read failed");
  }
  if (!profile.data) return null;

  const row = profile.data as Omit<PublicProfile, "rankName">;

  const rank = await supabase
    .from("levels")
    .select("name")
    .eq("level", row.level)
    .maybeSingle();
  if (rank.error && rank.error.code !== "PGRST116") {
    throw new Error(rank.error.message.trim() || "levels read failed");
  }

  return {
    ...row,
    rankName: (rank.data as { name: string } | null)?.name ?? `Level ${row.level}`,
  };
}

export interface TradeEvent {
  cardId: UUID;
  /** "AIR JORDAN 1 RETRO HIGH OG — CHICAGO" style label. */
  cardLabel: string;
  mintNumber: number;
  ownerLevel: number;
  acquiredAt: Timestamptz;
  releasedAt: Timestamptz | null;
  priceCents: number | null;
}

interface ProvenanceRow {
  card_id: UUID;
  owner_level: number;
  acquired_at: Timestamptz;
  released_at: Timestamptz | null;
  price_cents: number | null;
  card: {
    id: UUID;
    mint_number: number;
    sku: { brand: string; model: string; colorway: string };
  } | null;
}

/**
 * Every hop of card_provenance this user was a party to, newest first. This is
 * "trade history": the card they acquired (bought or minted), when, for what,
 * and if they have since let it go. card_provenance has no RLS in 001 and the
 * embedded card/sku reads are public, so anonymous visitors see the same list.
 */
// ------------------------------------------------------------
// VAULT INTAKE — pending_vault disclosure (023c), no contract export yet
// ------------------------------------------------------------

export interface VaultIntakeStatus {
  status: 'awaiting_shipment' | 'in_transit' | 'received' | 'defaulted' | 'cancelled';
  dueBy: Timestamptz;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: Timestamptz | null;
}

/**
 * The open (or most recently closed) vault_intakes row for a card, if any.
 * 023c_vault_custody.sql added `vault_intakes` after this contract's frozen
 * surface was last extended — no `getVaultIntake` export exists in
 * lib/api/contract.ts (grepped: zero matches for "vault" there). Read
 * directly here, same pattern as getPublicProfileByHandle/getTradeHistory
 * above: server-only, through the session client, never `users`.
 *
 * vault_intakes' own RLS (023c) is `consignor_id = self OR buyer_id = self OR
 * admin` — this only ever returns a row for the card's own buyer (or its
 * consignor, or an admin), which is exactly who the card page's pending_vault
 * banner is for. A stranger gets null, same as "no intake" would.
 */
export async function getVaultIntakeForCard(cardId: UUID): Promise<VaultIntakeStatus | null> {
  const supabase = await createServerSupabase();

  const result = await supabase
    .from('vault_intakes')
    .select('status, due_by, carrier, tracking_number, shipped_at')
    .eq('card_id', cardId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error && result.error.code !== 'PGRST116') {
    throw new Error(result.error.message.trim() || 'vault_intakes read failed');
  }
  if (!result.data) return null;

  const row = result.data as {
    status: VaultIntakeStatus['status'];
    due_by: Timestamptz;
    carrier: string | null;
    tracking_number: string | null;
    shipped_at: Timestamptz | null;
  };

  return {
    status: row.status,
    dueBy: row.due_by,
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    shippedAt: row.shipped_at,
  };
}

export async function getTradeHistory(ownerId: UUID): Promise<TradeEvent[]> {
  const supabase = await createServerSupabase();

  const rows = await supabase
    .from("card_provenance")
    .select(
      "card_id, owner_level, acquired_at, released_at, price_cents, " +
        "card:cards(id, mint_number, sku:skus(brand, model, colorway))",
    )
    .eq("owner_id", ownerId)
    .order("acquired_at", { ascending: false });

  if (rows.error) throw new Error(rows.error.message.trim() || "card_provenance read failed");

  return ((rows.data as ProvenanceRow[] | null) ?? []).map((row) => {
    const sku = row.card?.sku ?? null;
    const cardLabel = sku
      ? `${sku.brand} ${sku.model} — ${sku.colorway}`
      : "card";
    return {
      cardId: row.card_id,
      cardLabel,
      mintNumber: row.card?.mint_number ?? 0,
      ownerLevel: row.owner_level,
      acquiredAt: row.acquired_at,
      releasedAt: row.released_at,
      priceCents: row.price_cents,
    };
  });
}