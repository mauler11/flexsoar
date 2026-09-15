'use server';

/**
 * app/(auth)/welcome/actions.ts
 *
 * Region save for the post-confirmation /welcome step. Calls setCountry()
 * (fn_set_country, session client) — the same export the listing flow uses,
 * so the value lands under identical validation. Returns a result instead
 * of redirecting so the welcome form can claim handle + region in one
 * submit and surface either failure inline.
 *
 * Honest scope note: this RECORDS the region. Payout consequences (MY =
 * Stripe cash, elsewhere = FSC credit) are enforced by
 * fn_payout_method_for_user off cash_payout_countries — no UI gate here
 * pretends the ledger blocks non-MY listing, because it doesn't.
 */

import { setCountry } from '@/lib/api/contract';
import { isValidCountryCode } from '@/components/market/intake/intake-config';

export async function saveSignupRegionAction(
  countryCode: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isValidCountryCode(countryCode)) {
    return { ok: false, message: 'Select your region from the list.' };
  }
  try {
    await setCountry(countryCode.toUpperCase());
    return { ok: true };
  } catch (thrown) {
    return {
      ok: false,
      message: thrown instanceof Error ? thrown.message : 'Could not save region.',
    };
  }
}
