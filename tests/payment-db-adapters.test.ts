import { describe,it,expect,vi } from 'vitest';
import { authorizePaymentAttempt,finishPaymentOperation,claimPaymentOutbox,finishPaymentOutbox } from '../lib/db/payment-v2-workers';
import { claimPaymentOperations } from '../lib/db/payment-v2';
const id='00000000-0000-0000-0000-000000000001',lease='00000000-0000-0000-0000-000000000002',signature='A'.repeat(88);
describe('production v2 worker adapters (no database guarantee claimed)',()=>{
 it('surfaces absent schema and never falls back to service/legacy settlement',async()=>{
  const rpc=vi.fn(async()=>({data:null,error:{code:'PGRST202',message:'missing RPC'}}));
  await expect(authorizePaymentAttempt({rpc},id)).rejects.toThrow('fn_payment_v2_authorize_attempt: PGRST202');expect(rpc).toHaveBeenCalledExactlyOnceWith('fn_payment_v2_authorize_attempt',{p_attempt_id:id});
 });
 it('retains lease and signed identity in actual operation adapter',async()=>{
  const rpc=vi.fn(async()=>({data:[{id,leaseId:lease,payloadDigest:'ab'.repeat(32),expectedRevision:'1',action:'release',payload:{},signature,recoveryOnly:true}],error:null}));
  const ops=await claimPaymentOperations({rpc},id);expect(ops[0]).toMatchObject({leaseId:lease,signature,recoveryOnly:true});
 });
 it('rejects recovery without the persisted signed identity',async()=>{
  const rpc=vi.fn(async()=>({data:[{id,leaseId:lease,payloadDigest:'ab'.repeat(32),expectedRevision:'1',action:'release',payload:{},signature:null,recoveryOnly:true}],error:null}));
  await expect(claimPaymentOperations({rpc},id)).rejects.toThrow('missing signed identity');
 });
 it('requires signature before submitted/unknown and passes exact CAS lease',async()=>{
  const rpc=vi.fn(async()=>({data:null,error:null}));
  await expect(finishPaymentOperation({rpc},{id,leaseId:lease},'unknown',null,'timeout')).rejects.toThrow('signed operation');expect(rpc).not.toHaveBeenCalled();
  await finishPaymentOperation({rpc},{id,leaseId:lease},'submitted',signature,null);
  expect(rpc).toHaveBeenCalledWith('fn_payment_v2_finish_operation',{p_operation_id:id,p_lease_id:lease,p_outcome:'submitted',p_signature:signature,p_error:null});
 });
 it('retains independent notification delivery identity and exact retry lease',async()=>{
  const rpc=vi.fn(async()=>({data:[{id,leaseId:lease,userId:id,kind:'payment_v2_funded',payload:{},deliveryKey:id}],error:null}));
  const jobs=await claimPaymentOutbox({rpc});expect(jobs[0].deliveryKey).toBe(id);
  await finishPaymentOutbox({rpc},jobs[0],false,'provider unavailable');expect(rpc).toHaveBeenLastCalledWith('fn_payment_v2_finish_outbox',{p_id:id,p_lease_id:lease,p_delivered:false,p_error:'provider unavailable'});
 });
 it('keeps the internal route closed instead of using the shared service credential',async()=>{
  vi.stubEnv('PAYMENT_RECONCILE_SECRET','isolated-test-only');vi.stubEnv('PAYMENT_V2_ENABLE_LOCAL_RECONCILIATION','true');
  const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('network forbidden in test'));
  try {
   const {POST}=await import('../app/api/internal/solana/reconcile/route');
   const response=await POST(new Request('http://127.0.0.1/api/internal/solana/reconcile',{method:'POST',headers:{authorization:'Bearer isolated-test-only'}}));
   expect(response.status).toBe(503);expect((await response.json()).error).toContain('Dedicated verifier and settler');expect(network).not.toHaveBeenCalled();
  } finally {network.mockRestore();vi.unstubAllEnvs();}
 });

});
