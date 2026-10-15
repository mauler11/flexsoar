import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
export const dynamic='force-dynamic';
/** Existing order lookup only. No claim of retroactive chain verification or escrow. */
export async function GET(request: Request): Promise<NextResponse> {
  const session=await createServerSupabase();const {data}=await session.auth.getUser();
  if(!data.user)return NextResponse.json({error:'Sign in to read your receipts.'},{status:401});
  const listingId=new URL(request.url).searchParams.get('listingId')??'';
  if(!/^[0-9a-f-]{36}$/i.test(listingId))return NextResponse.json({error:'Invalid listing.'},{status:400});
  try {
    const result=await session.from('orders').select('id, listing_id, buyer_id, settlement_ref, status').eq('buyer_id',data.user.id).eq('listing_id',listingId);
    if(result.error)throw new Error(result.error.message);
    const receipts=(result.data??[]).map((value:unknown)=>{
      if(!value||typeof value!=='object')throw new Error('Invalid receipt');
      const row=value as Record<string,unknown>;
      if(typeof row.id!=='string'||typeof row.status!=='string'||(row.settlement_ref!==null&&typeof row.settlement_ref!=='string'))throw new Error('Invalid receipt fields');
      if(row.buyer_id!==data.user!.id||row.listing_id!==listingId)throw new Error('Receipt correspondence mismatch');
      return {orderId:row.id,status:row.status,reference:row.settlement_ref,classification:'legacy_record_only',paymentVerified:false};
    });
    return NextResponse.json({receipts},{headers:{'Cache-Control':'private, no-store'}});
  } catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Receipt lookup unavailable',retrySettlementOnly:true},{status:503});}
}
