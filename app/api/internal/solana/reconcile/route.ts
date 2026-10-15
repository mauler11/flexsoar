import { NextResponse } from 'next/server';
export const dynamic='force-dynamic';
export async function POST(request: Request): Promise<NextResponse> {
  const secret=process.env.PAYMENT_RECONCILE_SECRET;
  if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'unauthorized'},{status:401});
  if(process.env.PAYMENT_V2_ENABLE_LOCAL_RECONCILIATION!=='true')return NextResponse.json({error:'Local reconciliation is not configured; funding remains disabled.'},{status:503});
  // Dedicated DB-login adapters are not provisioned. Never fall back to service_role.
  return NextResponse.json({error:'Dedicated verifier and settler database connections must be provisioned and reviewed; recovery is unavailable through the shared service role.',recoveryRequired:true},{status:503});
}
