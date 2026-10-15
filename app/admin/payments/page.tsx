import { requireAdminPage } from '@/components/admin/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { paymentRpc } from '@/lib/api/contract';
import { submitEscrowDecision } from './actions';
export const dynamic = 'force-dynamic';
export default async function PaymentsPage() {
  await requireAdminPage('/admin/payments');
  let queue: unknown; let error: string | null = null;
  try { queue = await paymentRpc(await createServerSupabase(), 'fn_payment_v2_admin_queue', {}); }
  catch(e) { error = e instanceof Error ? e.message : 'Queue unavailable'; }
  return <main className="mx-auto max-w-4xl space-y-4 p-6">
    <h1>Escrow operations and unresolved payments</h1>
    <p>Receipt, examination and release are separate. Actions below record durable intent only.
      Enrolled roles and independent approvals are required; no operational signing provider is configured by this page.</p>
    {error ? <p role="alert">{error}. Funding and escrow actions remain unavailable.</p> : <>
      <pre className="overflow-auto">{JSON.stringify(queue, null, 2)}</pre>
      <form action={submitEscrowDecision} className="grid gap-3">
        <label>Escrow ID<input required name="escrowId" /></label>
        <label>Command ID (reuse for retries)<input required name="commandId" /></label>
        <label>Expected decision revision<input required name="expectedRevision" pattern="[0-9]+" /></label>
        <label>Exact pair commitment<input required name="pairCommitment" pattern="[a-f0-9]{64}" /></label>
        <label>Evidence digest<input required name="evidenceDigest" pattern="[a-f0-9]{64}" /></label>
        <label>Action<select name="action"><option value="receipt">Record physical receipt</option><option value="authentication_pass">Record authentication pass</option><option value="authentication_fail">Record authentication failure</option><option value="release">Request independent release approval</option><option value="refund">Request manual governance refund approval</option><option value="dispute">Request dispute hold</option></select></label>
        <button type="submit">Record intent for authorized review</button>
      </form>
    </>}
    <p>No seller-paid, refunded or Card-unlocked flag can be set here. Finalized chain outcomes must reconcile first.</p>
  </main>;
}
