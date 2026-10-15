/** Legacy issuance is permanently disabled. Recovery remains available. */
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
export const dynamic = 'force-dynamic';
export async function GET(): Promise<NextResponse> {
 const session = await createServerSupabase();
 const { data } = await session.auth.getUser();
 if (!data.user) return NextResponse.json({error:'sign in to view payment status'}, {status:401});
 return NextResponse.json({error:'New payments are paused while escrow and recovery are prepared. If you already attempted payment, recover its status; do not pay again.', code:'FUNDING_DISABLED', retrySettlementOnly:true}, {status:503});
}
