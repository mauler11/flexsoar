import { NextResponse } from 'next/server';
import { createServiceSupabase } from '@/lib/supabase/server';
import { reconcilePayments } from '@/lib/api/contract';
import { LocalV2Observer, localRpc } from '@/lib/solana/v2-observer';
export const dynamic='force-dynamic';
export async function POST(request: Request): Promise<NextResponse> {
  const secret=process.env.PAYMENT_RECONCILE_SECRET;
  if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'unauthorized'},{status:401});
  if(process.env.PAYMENT_V2_ENABLE_LOCAL_RECONCILIATION!=='true')return NextResponse.json({error:'Local reconciliation is not configured; funding remains disabled.'},{status:503});
  const rpc=process.env.PAYMENT_V2_LOCAL_RPC,program=process.env.PAYMENT_V2_PROGRAM_ID,genesis=process.env.PAYMENT_V2_GENESIS_HASH;
  if(!rpc||!program||!genesis)return NextResponse.json({error:'Explicit local RPC, program and genesis required.'},{status:503});
  try {
    // Local implementation cannot accidentally target localhost's shared cloud DB.
    localRpc(process.env.NEXT_PUBLIC_SUPABASE_URL??'');
    const observer=new LocalV2Observer(rpc,program,genesis);
    return NextResponse.json(await reconcilePayments(createServiceSupabase(),observer));
  }
  catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Recovery unavailable',recoveryRequired:true},{status:503});}
}
