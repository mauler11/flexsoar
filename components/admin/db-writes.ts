/**
 * components/admin/db-writes.ts
 *
 * LOCAL WRITE ADAPTERS — TEMPORARY, AND A NAMED EXCEPTION.
 *
 * AGENT_RULES says every write goes through `lib/api/contract.ts`. These three
 * do not, and that is a deliberate, task-scoped decision taken with the
 * operator rather than a workaround invented here. The reasoning, in full, so
 * whoever finds this file can judge it:
 *
 *   1. Migrations 010-013 are applied to the live project. Their `.sql` files
 *      are not in this worktree and `lib/api/contract.ts` — frozen, and
 *      writable only by track/data — wraps none of the RPCs they added.
 *      Checked on track/admin, track/data and main: 25 exports, none of them
 *      these.
 *   2. The three operations below cannot be composed from anything the
 *      contract does export. Approving a submission mints a card AND publishes
 *      a listing inside one transaction; there is no pair of contract calls
 *      that is equivalent, and doing it in two would leave a minted-but-
 *      unlisted card behind on a failure. Marking a default has no analogue at
 *      all.
 *   3. So the choice was: ship an admin console that cannot approve or default
 *      anything, or call the RPCs directly for now. The operator chose the
 *      latter, with this file quarantined and a handoff item filed.
 *
 * WHAT KEEPS THIS HONEST:
 *
 *   - They are RPC calls, not table writes. `supabase.from(...).insert()` never
 *     appears here — that line in AGENT_RULES is untouched. This file cannot
 *     grant anyone anything: it calls the same RPCs any client could, under the
 *     caller's own session.
 *   - `fn_approve_submission` and `fn_mark_default` are `fn_require_admin()`-
 *     guarded inside the transaction — verified live, both refuse anon AND
 *     service-role with "admin privileges required". `fn_confirm_shipment` is
 *     NOT, and that is a hole in 013 rather than in this file: see the warning
 *     on that function below and docs/handoff/admin.md item 13.
 *   - They run on the SESSION client, exactly as the contract's own mutations
 *     do. Service-role would make `auth.uid()` null and the guard would refuse.
 *   - Errors are mapped through the same `lib/db/errors.ts` the contract uses
 *     and thrown as real `ContractError`s, so `failure()` and every screen that
 *     branches on `result.code` behave identically to a contract call.
 *   - Where the contract CAN already do the job, this file stays out of it:
 *     rejecting a submission goes through the contract's `rejectItem()`, not
 *     through a local `fn_reject_submission` wrapper. See the note on
 *     `approveSubmission` for the one guard difference that costs.
 *
 * THE RETIREMENT PLAN: docs/handoff/admin.md item 12 asks track/data for
 * `approveSubmission`, `rejectSubmission`, `markDefault` and `confirmShipment`
 * on the contract. The day they land, this file is deleted and the three call
 * sites change import line only. Same lifecycle `getAdminItem()` and
 * `getItemOwners()` already went through.
 *
 * NOT HERE, ON PURPOSE: `fn_record_proof(p_item_id, p_photos)` is holder-only —
 * the seller proves possession, an admin cannot do it for them, and an admin
 * button wired to it would fail every time it was pressed. The proof screen in
 * this track reads the overdue view and stops there. The RPC is still in the
 * handoff item, for the seller-facing app.
 *
 * SERVER ONLY, the same way the contract is: lib/supabase/server.ts reads
 * `next/headers`, so importing this from a client component is a build error.
 */

import { ContractError } from "@/lib/api/contract";
import { contractErrorCode, type PostgresErrorLike } from "@/lib/db/errors";
import type { Cents, UUID } from "@/lib/db/types";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * The contract's own `fail()`/`unwrap()` pair, reproduced because both are
 * private to that module. Same contract: the server's text rides through
 * verbatim as `message`, the code is an addition on top, and the call-site
 * context goes in `detail` where it cannot overwrite anything.
 */
function unwrapRpc(
  result: { error: PostgresErrorLike | null },
  context: string,
): void {
  const error = result.error;
  if (!error) return;

  const message =
    (error.message ?? "").trim() || "the database returned an error";
  throw new ContractError(contractErrorCode(error), message, {
    context,
    error,
    adapter: "components/admin/db-writes.ts",
  });
}

/**
 * fn_approve_submission(p_item_id, p_price_cents) -> void
 *
 * Accepts a seller's submission in one transaction: moves the item to
 * in_custody and stamps it authenticated, mints the card off the DECLARED
 * grade, and inserts the public listing at `priceCents`.
 *
 * ONE CALL, DELIBERATELY. Mint-then-list as two round trips can fail between
 * them and strand a minted card with no listing, which is not a state any
 * screen in this console can repair. The database does all three or none.
 *
 * The float minted here comes from the SELLER'S six component scores
 * (`grade_source = 'seller_declared'`), not from a grader on the bench. That
 * is the whole weight of the approve button: the review screen shows the
 * declared scores, the float they imply and the photos they were claimed
 * against, because pressing this makes them permanent — float is immutable
 * after mint.
 *
 * `priceCents` is the LISTING price the marketplace shows. It is seeded from
 * the seller's `asking_price_cents` but is the reviewer's decision.
 *
 * @throws FORBIDDEN ("admin privileges required"), NOT_FOUND, WRONG_STATUS
 *         (the row left pending_review since the page loaded), and whatever
 *         fn_mint_card raises — NOT_GRADED, MINT_CAP_REACHED, NO_ORACLE_PRICE.
 */
export async function approveSubmission(
  itemId: UUID,
  priceCents: Cents,
  fairPriceCents: Cents | null = null,
): Promise<void> {
  const supabase = await createServerSupabase();
  unwrapRpc(
    await supabase.rpc("fn_approve_submission", {
      p_item_id: itemId,
      p_price_cents: priceCents,
      p_fair_price_cents: fairPriceCents,
    }),
    "fn_approve_submission",
  );
}

/**
 * fn_mark_default(p_redemption_id, p_note) -> void
 *
 * Records that a seller did not ship what they owed. Stamps `defaulted_at` and
 * increments the holder's `defaults_count` — the number the review bench shows
 * next to every future submission from that seller.
 *
 * IRREVERSIBLE and it marks a person, not a row: nothing in this console
 * clears `defaulted_at` or decrements the count, and the count feeds
 * `is_restricted`. So the note is required by the caller (`markDefaultAction`)
 * even though the database would take an empty string — a default with no
 * written reason is an accusation nobody can answer later.
 *
 * @throws FORBIDDEN, NOT_FOUND, WRONG_STATUS (already shipped, or already
 *         defaulted).
 */
export async function markDefault(
  redemptionId: UUID,
  note: string,
): Promise<void> {
  const supabase = await createServerSupabase();
  unwrapRpc(
    await supabase.rpc("fn_mark_default", {
      p_redemption_id: redemptionId,
      p_note: note,
    }),
    "fn_mark_default",
  );
}

/**
 * fn_confirm_shipment(p_redemption_id, p_carrier, p_tracking) -> void
 *
 * Ships a SELLER-HELD redemption. Everything `fn_mark_shipped` does, plus one
 * thing it does not: it increments the seller's `fulfilments_completed`.
 *
 * WHY NOT THE CONTRACT'S markShipped(). It would work — the parcel would be
 * recorded, the redemption would close — and the seller's fulfilment count
 * would silently not move. That count gates cash payout
 * (`cash_payout_min_fulfilments`, currently 2), so shipping a seller's parcel
 * through the wrong function quietly holds their money back. The warehouse
 * queue on the same page still uses `markShipped()`, which is correct for a
 * warehouse parcel: nobody earns fulfilment credit for the house shipping its
 * own stock.
 *
 * !! THIS RPC HAS NO ADMIN GUARD. Verified live: called with the ANON key on a
 * real redemption it reached the status check and answered "is already
 * shipped" — the row survived only because it was already in a terminal state.
 * `fn_approve_submission` and `fn_mark_default` refuse the same caller with
 * "admin privileges required"; this one does not. So an unauthenticated caller
 * can mark a `requested` redemption shipped and credit a seller's fulfilment
 * count, straight through PostgREST, with no admin session anywhere.
 *
 * That is a hole in 013, not in this wrapper, and calling it from here changes
 * nothing about it — this console reaches it behind requireAdminAction() like
 * every other action. It is filed as docs/handoff/admin.md item 13 and needs a
 * `perform fn_require_admin();` as the first statement in the function. Do not
 * treat the database as the backstop for this one until that lands.
 *
 * @throws NOT_FOUND, WRONG_STATUS (already shipped or defaulted). Not
 *         FORBIDDEN — see above; nothing in the function raises it.
 */
export async function confirmShipment(
  redemptionId: UUID,
  carrier: string,
  tracking: string,
): Promise<void> {
  const supabase = await createServerSupabase();
  unwrapRpc(
    await supabase.rpc("fn_confirm_shipment", {
      p_redemption_id: redemptionId,
      p_carrier: carrier,
      p_tracking: tracking,
    }),
    "fn_confirm_shipment",
  );
}
