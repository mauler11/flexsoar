/**
 * app/api/consignor/connect/route.ts — POST /api/consignor/connect
 *
 * Creates (or reuses) the caller's Stripe Connect Express account and returns
 * a fresh onboarding link. Thin wrapper over createConnectAccount() in
 * lib/api/contract.ts — all business rules (consignor check, MY-only country
 * check) live there; this route only resolves the session to a users.id and
 * maps ContractError codes to HTTP statuses.
 */

import { NextResponse } from 'next/server';

import { currentUserId } from '@/app/(market)/queries';
import { ContractError, createConnectAccount } from '@/lib/api/contract';

export async function POST(): Promise<NextResponse> {
  const me = await currentUserId();
  if (!me) {
    return NextResponse.json(
      { error: 'Sign in to set up payouts.' },
      { status: 401 },
    );
  }

  try {
    const link = await createConnectAccount(me);
    return NextResponse.json(link, { status: 200 });
  } catch (err) {
    if (err instanceof ContractError) {
      const status =
        err.code === 'FORBIDDEN'
          ? 403
          : err.code === 'INVALID_COUNTRY_CODE'
            ? 400
            : err.code === 'NOT_FOUND'
              ? 404
              : 500;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
