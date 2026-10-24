import { describe, expect, it } from 'vitest';
import { createIssuerDatabase } from './database';
import type { PaymentRpc } from '@/lib/db/payment-v2';

describe('issuer dedicated database adapter',()=>{
  it('maps only P2c database calls and encodes binary values as PostgreSQL bytea',async()=>{
    const calls:Array<{name:string;args:Record<string,unknown>}>=[];
    const transport:PaymentRpc={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='fn_payment_v2_prepare_sale'?'11111111-1111-4111-8111-111111111111':name==='fn_payment_v2_issuer_subject_context'?{found:false}:{saleId:'11111111-1111-4111-8111-111111111111',listingId:'22222222-2222-4222-8222-222222222222',totalUnits:'9',expiresAt:'1800000600',validFrom:'1800000000',state:'opening'},error:null};}};
    const db=createIssuerDatabase(transport);
    await db.consumeIssuerNonce('active-kid',new Uint8Array([0,1,255]));
    await db.subjectContext('listing','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333');
    await db.enrollWalletChecked('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',new Uint8Array([1,2]),new Uint8Array([3]),new Uint8Array([4,5]));
    await db.prepareSale('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',{id:'11111111-1111-4111-8111-111111111111',saleAddress:'x',escrowAddress:'y',totalUnits:'9',fxSnapshot:{},validFrom:'1',expiresAt:'2'});
    await db.saleSigningContext('11111111-1111-4111-8111-111111111111');
    await db.recordListing('11111111-1111-4111-8111-111111111111',new Uint8Array([6]),new Uint8Array([7]));
    expect(calls.map(c=>c.name)).toEqual([
      'fn_payment_v2_consume_issuer_nonce','fn_payment_v2_issuer_subject_context','fn_payment_v2_issuer_enroll_wallet_checked',
      'fn_payment_v2_prepare_sale','fn_payment_v2_issuer_context','fn_payment_v2_record_listing',
    ]);
    expect(calls[0]!.args).toEqual({p_kid:'active-kid',p_nonce:'\\x0001ff'});
    expect(calls[2]!.args).toMatchObject({p_wallet:'\\x0102',p_token_account:'\\x03',p_proof_digest:'\\x0405'});
    expect(calls[5]!.args).toMatchObject({p_message:'\\x06',p_signature:'\\x07'});
  });
  it('preserves errors instead of converting rejected database calls into success',async()=>{
    const db=createIssuerDatabase({rpc:async()=>({data:null,error:{code:'PAYMENT_DB_OUTCOME_UNKNOWN',message:'unknown commit'}})});
    await expect(db.prepareSale('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',{id:'11111111-1111-4111-8111-111111111111',saleAddress:'x',escrowAddress:'y',totalUnits:'9',fxSnapshot:{},validFrom:'1',expiresAt:'2'})).rejects.toThrow('PAYMENT_DB_OUTCOME_UNKNOWN');
  });
});
