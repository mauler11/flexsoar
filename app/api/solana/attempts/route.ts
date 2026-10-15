import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { ownPaymentAttempts } from '@/lib/api/contract';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<NextResponse> {
  const session = await createServerSupabase(); const { data } = await session.auth.getUser();
  if (!data.user) return NextResponse.json({error:'Sign in to recover your payment status.'}, {status:401});
  const listingId = new URL(request.url).searchParams.get('listingId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(listingId)) return NextResponse.json({error:'Invalid listing.'}, {status:400});
  try { return NextResponse.json({fundingAvailable:false, attempts:await ownPaymentAttempts(session, listingId)}, {headers:{'Cache-Control':'private, no-store'}}); }
  catch (e) { return NextResponse.json({error:e instanceof Error ? e.message : 'Recovery unavailable', recoveryRequired:true, retrySettlementOnly:true, fundingAvailable:false}, {status:503}); }
}
