/** Read-only finalized context for the EXISTING execute_outcome recovery policy.
 * No replacement transaction, signing, sending or database write primitive. */
import {PublicKey} from '@solana/web3.js';
import type {ExitPlan, SignedOperationEnvelope, RecoveryObservation} from '@/lib/db/payment-signed-operation';
import {base58Encode} from './base58';
import {equalBytes} from './protocol-v2';
import {discriminator} from './v2-sdk';
import {decodeSale,localRpc} from './v2-observer';
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('invalid operation observation');return v as Record<string,unknown>;};
export async function observeSignedOutcome(url:string, plan:ExitPlan, envelope:SignedOperationEnvelope, request:typeof fetch=fetch):Promise<RecoveryObservation>{
 async function rpc(method:string,params:unknown[]):Promise<unknown>{
  const response=await request(localRpc(url),{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'outcome-recovery',method,params})});
  if(!response.ok)throw new Error('operation RPC unavailable');const body=object(await response.json());if(body.error)throw new Error('operation RPC: '+JSON.stringify(body.error));return body.result;
 }
 if(await rpc('getGenesisHash',[])!==plan.genesis)throw new Error('operation genesis mismatch');
 const accountResult=object(await rpc('getMultipleAccounts',[[plan.instruction.accounts[1].pubkey,plan.instruction.accounts[0].pubkey],{encoding:'base64',commitment:'finalized'}]));
 const context=object(accountResult.context);if(!Number.isSafeInteger(context.slot))throw new Error('invalid finalized context');
 if(!Array.isArray(accountResult.value)||accountResult.value.length!==2)throw new Error('missing operation accounts');
 const accounts=accountResult.value.map(v=>{const a=object(v);if(a.owner!==plan.program||a.executable!==false||!Array.isArray(a.data)||a.data[1]!=='base64'||typeof a.data[0]!=='string')throw new Error('operation account owner/encoding mismatch');return Buffer.from(a.data[0],'base64');});
 const sale=await decodeSale(plan.instruction.accounts[1].pubkey,accounts[0],plan.program),config=accounts[1];
 if(config.length!==586||!equalBytes(config.subarray(0,8),await discriminator('account:ConfigV2'))||base58Encode(config.subarray(8,40))!==plan.genesis||![0,1].includes(config[561])||new PublicKey(sale.permit.config).toBase58()!==plan.instruction.accounts[0].pubkey)throw new Error('operation config/domain mismatch');
 const statuses=object(await rpc('getSignatureStatuses',[[envelope.signature],{searchTransactionHistory:true}]));
 if(!Array.isArray(statuses.value)||statuses.value.length!==1)throw new Error('signature observation incomplete');
 const status=statuses.value[0]===null?null:object(statuses.value[0]);
 // A signature finalized beyond our account snapshot requires a new observation;
 // never infer a pre-outcome state from an older finalized bank.
 if(status&&(!Number.isSafeInteger(status.slot)||Number(status.slot)>Number(context.slot)))throw new Error('signature newer than observed account context; retry observation');
 const height=await rpc('getBlockHeight',[{commitment:'finalized',minContextSlot:context.slot}]);if(typeof height!=='number'||!Number.isSafeInteger(height)||height<0)throw new Error('invalid block height');
 const valid=object(await rpc('isBlockhashValid',[envelope.blockhash,{commitment:'finalized',minContextSlot:context.slot}]));if(typeof valid.value!=='boolean')throw new Error('blockhash observation incomplete');
 return {networkId:plan.networkId,genesis:plan.genesis,program:plan.program,saleAddress:sale.address,signature:envelope.signature,complete:true,
  signatureState:status===null?'not_found':status.confirmationStatus==='finalized'?(status.err===null?'finalized_success':'finalized_failure'):'pending',
  saleState:sale.state===2?'funded':sale.state===4?'released':sale.state===5?'refunded':'unknown',decisionRevision:String(sale.decisionRevision),outflowPaused:config[561]===1,
  blockHeight:String(height),blockhash:envelope.blockhash,blockhashValid:valid.value};
}
