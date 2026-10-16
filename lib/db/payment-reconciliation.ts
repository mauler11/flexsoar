import { decodePermit, encodePermit, equalBytes } from '@/lib/solana/protocol-v2';
import { base58Encode } from '@/lib/solana/base58';
import type { SaleSnapshot, OutcomeKind } from '@/lib/solana/v2-observer';
import { paymentRpc, type PaymentRpc } from './payment-v2';
import { paymentWorkerIdentity,paymentAttemptContext,persistVerifiedPaymentEvidence,readVerifiedPaymentEvidence } from './payment-v2-workers';
import type { VerifiedTransactionEvidence } from '@/lib/solana/v2-evidence';
export interface PaymentObserver {
  readonly genesis: string; readonly program: string;
  scan(): Promise<SaleSnapshot[]>;
  evidence(sale: SaleSnapshot, kind: OutcomeKind): Promise<{signature:string;slot:number}>;
  captureEvidence(sale:SaleSnapshot,kind:OutcomeKind,attemptId:string,networkId:string):Promise<VerifiedTransactionEvidence>;
  validateRetainedEvidence(value:Record<string,unknown>,sale:SaleSnapshot,kind:OutcomeKind,attemptId:string,networkId:string):Promise<VerifiedTransactionEvidence>;
}
/** Production orchestration with durable RPC receipts. No in-memory checkpoint,
 * signing, refund execution or notification delivery masquerades as recovery. */
export async function reconcilePayments(client: PaymentRpc, observer: PaymentObserver, budget=20, settler?: PaymentRpc) {
  if(!settler||settler===client)throw new Error('Dedicated verifier and settler connections required; shared service-role settlement is disabled');
  if(!Number.isInteger(budget)||budget<1||budget>20)throw new Error('invalid recovery budget');
  const verifierLogin=await paymentWorkerIdentity(client,'payment_v2_verifier');
  const settlerLogin=await paymentWorkerIdentity(settler,'payment_v2_settler');
  if(verifierLogin===settlerLogin)throw new Error('Dedicated verifier and settler must use distinct database logins');
  const sales=await observer.scan(); let processed=0;
  const lease=await paymentRpc(client,'fn_payment_v2_begin_scan',{p_genesis:observer.genesis,p_program:observer.program,p_limit:budget});
  if(!lease||typeof lease!=='object')throw new Error('missing durable scan lease');
  const cursor=lease as Record<string,unknown>;
  if(typeof cursor.leaseId!=='string'||!cursor.leaseId||(cursor.afterAddress!==null&&typeof cursor.afterAddress!=='string'))throw new Error('invalid durable scan cursor');
  const eligible=sales.filter(s=>[2,3,4,5].includes(s.state)).sort((a,b)=>a.address<b.address?-1:a.address>b.address?1:0)
    .filter(s=>cursor.afterAddress===null||s.address>String(cursor.afterAddress));
  const batch=eligible.slice(0,budget);
  const failed: {sale:string;error:string}[]=[];
  for(const sale of batch){
    try {
      const data=await paymentRpc(client,'fn_payment_v2_recovery_binding',{p_attempt:base58Encode(sale.permit.attempt),p_genesis:observer.genesis,p_program:observer.program});
      if(!data||typeof data!=='object')throw new Error('missing immutable attempt');
      const binding=data as Record<string,unknown>;
      if(typeof binding.permitHex!=='string'||!/^[a-f0-9]{1380}$/.test(binding.permitHex)||!Array.isArray(binding.appliedKinds)||binding.appliedKinds.some(k=>!['funded','direct','released','refunded'].includes(k)))throw new Error('invalid recovery binding');
      const expected=decodePermit(Buffer.from(binding.permitHex,'hex'));
      if(!equalBytes(encodePermit(expected),encodePermit(sale.permit))||base58Encode(expected.domain)!==observer.genesis||base58Encode(expected.program)!==observer.program)throw new Error('immutable attempt/chain mismatch');
      const attemptContext=await paymentAttemptContext(client,base58Encode(expected.attempt),observer.genesis,observer.program);
      if(typeof attemptContext.attemptId!=='string'||!/^[0-9a-f-]{36}$/i.test(attemptContext.attemptId)||typeof attemptContext.networkId!=='string'||attemptContext.permitHex!==binding.permitHex||attemptContext.genesis!==observer.genesis||attemptContext.program!==observer.program||attemptContext.sale!==sale.address)throw new Error('verifier attempt context mismatch');
      const kinds: OutcomeKind[]=sale.permit.mode===1?['direct']:sale.state===4?['funded','released']:sale.state===5?['funded','refunded']:['funded'];
      for(const kind of kinds){
        if(binding.appliedKinds.includes(kind))continue;
        const stored=await readVerifiedPaymentEvidence(client,'payment_event',attemptContext.attemptId,kind);
        const evidence=stored?await observer.validateRetainedEvidence(stored,sale,kind,attemptContext.attemptId,String(attemptContext.networkId)):
          await observer.captureEvidence(sale,kind,attemptContext.attemptId,String(attemptContext.networkId));
        const evidenceId=stored&&typeof stored.id==='string'?stored.id:await persistVerifiedPaymentEvidence(client,evidence);
        const expectedSlot=kind==='funded'||kind==='direct'?sale.fundedSlot:sale.outcomeSlot;
        if(evidence.slot!==expectedSlot||evidence.signature!==evidence.parsedRpcResult.transaction.signatures[0]||evidence.networkId!==String(attemptContext.networkId))throw new Error('verified evidence slot/identity mismatch');
        const event=await paymentRpc(client,'fn_payment_v2_record_verified_event',{
          p_event:{genesis:observer.genesis,program:observer.program,sale:sale.address,attempt:base58Encode(expected.attempt),kind,
            signature:evidence.signature,slot:evidence.slot,fundedAtSeconds:String(sale.fundedAt),permitHex:binding.permitHex,decisionRevision:String(kind==='funded'||kind==='direct'?0:sale.decisionRevision),finality:'finalized',evidenceId},
        });
        if(typeof event!=='string'||!event)throw new Error('missing verified event ID');
        await paymentRpc(settler,'fn_payment_v2_reconcile_event',{p_event_id:event});
        // RPC atomically enqueues notifications; no external email is sent here.
        processed++;
      }
    } catch(e){failed.push({sale:sale.address,error:e instanceof Error?e.message:'unresolved recovery'});}
  }
  await paymentRpc(client,'fn_payment_v2_finish_scan',{p_lease_id:cursor.leaseId,p_last_address:eligible.length<=budget?null:batch[batch.length-1]?.address??null,p_failures:failed});
  return {processed,failed};
}
