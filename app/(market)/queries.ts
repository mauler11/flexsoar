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
import type { Timestamptz, UUID } from "@/lib/db/types";

/**
 * The redemption handling fee. fn_redeem_card takes the fee as an argument and
 * the schema records it, but nothing in the schema tells a UI what the fee IS.
 * Pinned here pending a levels.perks or platform_config source — see
 * docs/handoff/market.md item 4.
 */
export const REDEMPTION_HANDLING_FEE_CENTS = 1500;

/**
 * Cash on /list unlocks after this many fulfilled shipments. The payout ledger
 * is pending (handoff M4); until it lands, "fulfilled" means a redemption on
 * this account with status 'shipped', re-checked server-side at submit.
 */
export const CASH_FULFILMENT_THRESHOLD = 1;

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