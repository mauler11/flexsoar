'use server';
import { requireAdminAction } from '@/components/admin/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { recordPaymentDecision } from '@/lib/api/contract';
import type { PaymentDecision } from '@/lib/db/payment-v2';
/** Records an intent only. RPC must verify enrolled role/independence; is_admin
 * is a UI gate, never a signing or withdrawal authority. No key/provider here. */
export async function submitEscrowDecision(form: FormData): Promise<void> {
  await requireAdminAction();
  const action = String(form.get('action'));
  if (!['receipt','authentication_pass','authentication_fail','release','refund','dispute'].includes(action)) throw new Error('Invalid escrow action');
  await recordPaymentDecision(await createServerSupabase(), {
    escrowId: String(form.get('escrowId') ?? ''), commandId: String(form.get('commandId') ?? ''),
    expectedRevision: String(form.get('expectedRevision') ?? ''), action: action as PaymentDecision['action'],
    evidenceDigest: String(form.get('evidenceDigest') ?? ''), pairCommitment: String(form.get('pairCommitment') ?? ''),
  });
}
