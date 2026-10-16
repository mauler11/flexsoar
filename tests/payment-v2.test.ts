import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js';
import { encodePermit, decodePermit, encodeAttestation, validatePermit, type PermitV2 } from '../lib/solana/protocol-v2';
import { buyV2Instruction, v2Addresses, recreateBoundAta, discriminator } from '../lib/solana/v2-sdk';
import { inspectV2Transaction, localRpc, decodeSale, LocalV2Observer, type SaleSnapshot, type V2Transaction, type OutcomeKind } from '../lib/solana/v2-observer';
import { TOKEN_PROGRAM_ID, associatedTokenAddress } from '../lib/solana/sdk';
import { base58Encode } from '../lib/solana/base58';
import { dispatchReview, PAYMENT_POLICY_V1, paymentPolicyDigest } from '../lib/solana/payment-policy';
import { ownPaymentAttempts, recordPaymentDecision, initiatePaymentAttempt, FUNDING_AVAILABLE, type PaymentRpc } from '../lib/db/payment-v2';
import { reconcilePayments, type PaymentObserver } from '../lib/db/payment-reconciliation';
import { SolanaBuyPanel } from '../components/market/SolanaBuyPanel';
import type { VerifiedTransactionEvidence } from '../lib/solana/v2-evidence';

const b=(n:number)=>new Uint8Array(32).fill(n),key=(n:number)=>new PublicKey(b(n)).toBase58();
function vector(): PermitV2 {return {
  mode:0,domain:b(1),program:b(2),config:b(3),saleId:b(4),card:b(5),pair:b(6),attempt:b(7),beneficiary:b(8),policy:b(9),
  buyer:b(10),seller:b(11),treasury:b(12),mint:b(13),tokenProgram:b(14),buyerToken:b(15),sellerToken:b(16),treasuryToken:b(17),refundToken:b(18),issuer:b(19),
  generation:BigInt(1),revision:BigInt(2),custodyVersion:BigInt(3),authorityEpoch:BigInt(4),total:BigInt(5),net:BigInt(6),fee:BigInt(7),validFrom:BigInt(-8),expiresAt:BigInt(9),
};}
function permit(mode:0|1=0): PermitV2 {
  const p=vector();p.mode=mode;p.program=new PublicKey('CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF').toBytes();
  p.config=v2Addresses(new PublicKey(p.program).toBase58(),p.card,p.saleId).config.toBytes();
  p.tokenProgram=new PublicKey(TOKEN_PROGRAM_ID).toBytes();
  p.buyerToken=new PublicKey(associatedTokenAddress(key(10),key(13))).toBytes();p.refundToken=p.buyerToken;
  p.sellerToken=new PublicKey(associatedTokenAddress(key(11),key(13))).toBytes();p.treasuryToken=new PublicKey(associatedTokenAddress(key(12),key(13))).toBytes();
  p.total=BigInt(1_000_000);p.net=BigInt(950_000);p.fee=BigInt(50_000);p.validFrom=BigInt(100);p.expiresAt=BigInt(400);return p;
}
async function fixture(kind: OutcomeKind='funded') {
  const p=permit(kind==='direct'?1:0),program=new PublicKey(p.program).toBase58(),a=v2Addresses(program,p.card,p.saleId);
  const s:SaleSnapshot={address:a.sale.toBase58(),permit:p,state:kind==='released'?4:kind==='refunded'?5:kind==='direct'?3:2,fundedSlot:123,fundedAt:BigInt(200),outcomeSlot:125,decisionRevision:BigInt(1)};
  const isBuy=kind==='funded'||kind==='direct';const buy=await buyV2Instruction(p);
  const outcome=Buffer.alloc(16);outcome.set(await discriminator('global:execute_outcome'));outcome.writeBigUInt64LE(BigInt(1),8);
  const accounts=isBuy?buy.keys.map(k=>k.pubkey.toBase58()):[a.config.toBase58(),s.address,a.escrow.toBase58(),new PublicKey(p.sellerToken).toBase58(),new PublicKey(p.treasuryToken).toBase58(),new PublicKey(p.refundToken).toBase58(),TOKEN_PROGRAM_ID,SYSVAR_INSTRUCTIONS_PUBKEY.toBase58()];
  const keys=[key(31),...new Set(accounts)];const source=new PublicKey(p.buyerToken).toBase58(),seller=new PublicKey(p.sellerToken).toBase58(),treasury=new PublicKey(p.treasuryToken).toBase58(),escrow=a.escrow.toBase58();
  const moves: [string,string,string,string][]=kind==='funded'?[[source,escrow,key(10),'1000000']]:kind==='direct'?[[source,seller,key(10),'950000'],[source,treasury,key(10),'50000']]:kind==='released'?[[escrow,seller,s.address,'950000'],[escrow,treasury,s.address,'50000']]:[[escrow,source,s.address,'1000000']];
  const owners=new Map([[source,key(10)],[seller,key(11)],[treasury,key(12)],[escrow,s.address]]);
  const amounts=new Map<string,bigint>();for(const [from,to]of moves){amounts.set(from,isBuy?BigInt(2_000_000):BigInt(1_000_007));amounts.set(to,BigInt(0));}
  const balances=()=>[...amounts].map(([address,amount])=>({accountIndex:keys.indexOf(address),mint:key(13),owner:owners.get(address),programId:TOKEN_PROGRAM_ID,uiTokenAmount:{amount:String(amount),decimals:6}}));
  const pre=balances();for(const [from,to,,amount]of moves){amounts.set(from,amounts.get(from)!-BigInt(amount));amounts.set(to,amounts.get(to)!+BigInt(amount));}
  const signature=base58Encode(new Uint8Array(64).fill(9));
  const tx:V2Transaction={slot:isBuy?123:125,transaction:{signatures:[signature],message:{accountKeys:keys.map(pubkey=>({pubkey,signer:[key(31),key(10),key(19)].includes(pubkey),writable:true})),instructions:[{programId:program,accounts,data:base58Encode(isBuy?buy.data:outcome)}]}},meta:{err:null,preTokenBalances:pre,postTokenBalances:balances(),innerInstructions:[{index:0,instructions:moves.map(([from,to,authority,amount])=>({programId:TOKEN_PROGRAM_ID,parsed:{type:'transfer',info:{source:from,destination:to,authority,amount}}}))}]}};
  return {s,tx,signature};
}
describe('canonical production protocol',()=>{
  it('matches independent Rust byte vector (not production field-order mirror)',()=>{
    const chunks=[Buffer.from([70,83,79,65,82,86,50,0,2,0])];for(let n=1;n<=19;n++)chunks.push(Buffer.alloc(32,n));
    for(let n=1;n<=7;n++){const v=Buffer.alloc(8);v.writeBigUInt64LE(BigInt(n));chunks.push(v);}
    const signed=Buffer.alloc(16);signed.writeBigInt64LE(BigInt(-8));signed.writeBigInt64LE(BigInt(9),8);chunks.push(signed);
    const wire=Buffer.concat(chunks);expect(wire.length).toBe(690);expect(Buffer.from(encodePermit(vector()))).toEqual(wire);expect(decodePermit(wire)).toEqual(vector());
  });
  it('matches independent attestation vector',()=>{
    const rev=Buffer.alloc(8);rev.writeBigUInt64LE(BigInt(5));
    expect(Buffer.from(encodeAttestation({action:4,sale:b(1),attempt:b(2),pair:b(3),evidence:b(4),revision:BigInt(5)}))).toEqual(Buffer.concat([Buffer.from([70,83,79,65,82,86,50,0,4]),Buffer.alloc(32,1),Buffer.alloc(32,2),Buffer.alloc(32,3),Buffer.alloc(32,4),rev]));
  });
  it('checks execution interval, exact split and role separation',()=>{
    const p=permit();expect(()=>validatePermit(p,BigInt(100))).not.toThrow();expect(()=>validatePermit(p,BigInt(400))).toThrow();
    expect(()=>validatePermit({...p,fee:BigInt(1)},BigInt(200))).toThrow();expect(()=>validatePermit({...p,seller:p.buyer},BigInt(200))).toThrow();
  });
  it.each(['generation','revision','custodyVersion','authorityEpoch','total','net','fee'] as const)('rejects overflow %s',field=>expect(()=>encodePermit({...permit(),[field]:BigInt(1)<<BigInt(64)})).toThrow());
  it('rejects noncanonical version/length/mode',()=>{const wire=encodePermit(permit());wire[8]=1;expect(()=>decodePermit(wire)).toThrow();wire[8]=2;wire[9]=2;expect(()=>decodePermit(wire)).toThrow();expect(()=>decodePermit(wire.slice(1))).toThrow();});
});
describe('actual v2 instruction and outcome verifier',()=>{
  it.each(['funded','direct','released','refunded'] as const)('verifies %s, with sponsor and principal-only escrow dust handling',async kind=>{const {tx,s,signature}=await fixture(kind);await expect(inspectV2Transaction(tx,signature,s,kind)).resolves.toBeUndefined();});
  it.each(['program','signer','issuer','amount','recipient','mint','owner','unrelated','permit','slot','duplicate'] as const)('rejects wrong %s',async fault=>{
    const {tx,s,signature}=await fixture();
    if(fault==='program')tx.transaction.message.instructions[0].programId=key(29);
    if(fault==='signer')tx.transaction.message.accountKeys.find(k=>k.pubkey===key(10))!.signer=false;
    if(fault==='issuer')tx.transaction.message.accountKeys.find(k=>k.pubkey===key(19))!.signer=false;
    if(fault==='amount')tx.meta.innerInstructions![0].instructions[0].parsed!.info.amount='999999';
    if(fault==='recipient')tx.transaction.message.instructions[0].accounts![8]=key(29);
    if(fault==='mint')tx.meta.postTokenBalances![0].mint=key(29);
    if(fault==='owner')tx.meta.postTokenBalances![0].owner=key(29);
    if(fault==='unrelated'){tx.transaction.message.instructions.push({programId:key(29)});tx.meta.innerInstructions![0].index=1;}
    if(fault==='permit')s.permit={...s.permit,attempt:b(29)};
    if(fault==='slot')tx.slot++;
    if(fault==='duplicate')tx.transaction.message.instructions.push({...tx.transaction.message.instructions[0]});
    await expect(inspectV2Transaction(tx,signature,s,'funded')).rejects.toThrow();
  });
  it('rejects opposite outcome and stale revision; current quote expiry does not invalidate executed evidence',async()=>{
    const {tx,s,signature}=await fixture('released');await expect(inspectV2Transaction(tx,signature,s,'refunded')).rejects.toThrow();
    await expect(inspectV2Transaction(tx,signature,{...s,decisionRevision:BigInt(2)},'released')).rejects.toThrow();
    await expect(inspectV2Transaction(tx,signature,s,'released')).resolves.toBeUndefined();
  });
  it('recreates only original ATA after relinking, not a new destination',()=>{
    const p=permit(),owner=new PublicKey(p.buyer).toBase58(),mint=new PublicKey(p.mint).toBase58(),expected=new PublicKey(p.refundToken).toBase58();
    expect(recreateBoundAta(key(31),owner,mint,expected).data[0]).toBe(1);expect(()=>recreateBoundAta(key(31),key(30),mint,expected)).toThrow();
  });
  it.each(['https://api.devnet.solana.com','http://example.com','http://127.0.0.1:8899?key=x','http://u:p@127.0.0.1:8899'])('rejects nonlocal/credentialed observer target %s',url=>expect(()=>localRpc(url)).toThrow());
  it('accepts explicit loopback and validates retained account discriminator/PDA',async()=>{
    expect(localRpc('http://127.0.0.1:8899')).toBe('http://127.0.0.1:8899/');
    const {s}=await fixture();const data=Buffer.alloc(961);data.set(await discriminator('account:SaleV2'));data.set(encodePermit(s.permit),8);data[698]=2;data.writeBigUInt64LE(BigInt(123),700);data.writeBigInt64LE(BigInt(200),708);
    expect((await decodeSale(s.address,data,new PublicKey(s.permit.program).toBase58())).fundedSlot).toBe(123);
    await expect(decodeSale(key(29),data,new PublicKey(s.permit.program).toBase58())).rejects.toThrow();
  });
  it('runs actual finalized observer against isolated RPC fixtures and original slot-indexed history',async()=>{
    const {s,tx,signature}=await fixture();const data=Buffer.alloc(961);data.set(await discriminator('account:SaleV2'));data.set(encodePermit(s.permit),8);data[698]=2;data.writeBigUInt64LE(BigInt(123),700);data.writeBigInt64LE(BigInt(200),708);
    const program=new PublicKey(s.permit.program).toBase58(),genesis=base58Encode(s.permit.domain);
    const rpc=vi.fn<typeof fetch>().mockImplementation(async(_url,init)=>{
      expect(init?.redirect).toBe('error');const request=JSON.parse(String(init?.body));
      const result=request.method==='getGenesisHash'?genesis:request.method==='getProgramAccounts'?[{pubkey:s.address,account:{owner:program,executable:false,data:[data.toString('base64'),'base64']}}]:request.method==='getBlock'?{transactions:[{transaction:tx.transaction,meta:tx.meta}]}:null;
      return new Response(JSON.stringify({result}));
    });
    const observer=new LocalV2Observer('http://127.0.0.1:8899',program,genesis,rpc);
    const sales=await observer.scan();expect(sales).toHaveLength(1);expect(await observer.evidence(sales[0],'funded')).toEqual({signature,slot:123});
    expect(rpc.mock.calls.map(([,init])=>JSON.parse(String(init?.body)).method)).toEqual(['getGenesisHash','getProgramAccounts','getBlock']);
  });
  it('does not invent evidence when original archival block is unavailable',async()=>{
    const {s}=await fixture();const rpc=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({result:null})));
    const observer=new LocalV2Observer('http://127.0.0.1:8899',new PublicKey(s.permit.program).toBase58(),base58Encode(s.permit.domain),rpc);
    await expect(observer.evidence(s,'funded')).rejects.toThrow('history unavailable');
  });
});
describe('durable production recovery orchestration (RPC doubles are NOT Postgres proofs)',()=>{
  it('requires separately provisioned verifier and settler connections before observation',async()=>{
    const client={rpc:vi.fn()},observer:PaymentObserver={genesis:'g',program:'p',scan:vi.fn(),evidence:vi.fn(),captureEvidence:vi.fn(),validateRetainedEvidence:vi.fn()};
    await expect(reconcilePayments(client,observer)).rejects.toThrow('Dedicated verifier');
    await expect(reconcilePayments(client,observer,20,client)).rejects.toThrow('Dedicated verifier');
    expect(observer.scan).not.toHaveBeenCalled();expect(client.rpc).not.toHaveBeenCalled();
  });
  async function setup(kind:OutcomeKind='released'){
    const {s}=await fixture(kind);const applied:string[]=[],retained=new Map<string,Record<string,unknown>>();let eventKind='funded';const rpc=vi.fn<PaymentRpc['rpc']>().mockImplementation(async(name,args)=>{
      if(name==='fn_payment_v2_worker_identity')return {data:{login:String(args.p_required_role)+'-login',role:args.p_required_role,superuser:false},error:null};
      if(name==='fn_payment_v2_begin_scan')return {data:{leaseId:'lease',afterAddress:null},error:null};
      if(name==='fn_payment_v2_finish_scan')return {data:null,error:null};
      if(name==='fn_payment_v2_recovery_binding')return {data:{permitHex:Buffer.from(encodePermit(s.permit)).toString('hex'),appliedKinds:[...applied]},error:null};
      if(name==='fn_payment_v2_attempt_context')return {data:{attemptId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',networkId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',permitHex:Buffer.from(encodePermit(s.permit)).toString('hex'),genesis:base58Encode(s.permit.domain),program:new PublicKey(s.permit.program).toBase58(),sale:s.address},error:null};
      if(name==='fn_payment_v2_read_chain_evidence')return {data:retained.get(String(args.p_subject_action))??null,error:null};
      if(name==='fn_payment_v2_store_chain_evidence'){const evidence=args.p_evidence as Record<string,unknown>;eventKind=String(evidence.subjectAction);retained.set(eventKind,{...evidence,id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});return {data:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',error:null};}
      if(name==='fn_payment_v2_record_verified_event'){eventKind=String((args.p_event as {kind:string}).kind);return {data:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',error:null};}
      if(name==='fn_payment_v2_reconcile_event'){applied.push(eventKind);return {data:'order',error:null};}throw new Error('unexpected RPC');
    });
    const evidence=(k:OutcomeKind):VerifiedTransactionEvidence=>({formatVersion:1,subjectKind:'payment_event',subjectId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',subjectAction:k,networkId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',genesis:base58Encode(s.permit.domain),program:new PublicKey(s.permit.program).toBase58(),signature:k,slot:k==='funded'||k==='direct'?123:125,blockTime:1234,finality:'finalized',sourceKind:'primary',sourceLabel:'offline-test',transactionBase64:'AA==',transactionDigest:'a'.repeat(64),messageDigest:'b'.repeat(64),rpcResult:{transaction:['AA==','base64'],slot:123,blockTime:1234,meta:{err:null}},parsedRpcResult:{transaction:{signatures:[k],message:{accountKeys:[],instructions:[]}},slot:123,blockTime:1234,meta:{err:null}}});
    const observer:PaymentObserver={program:new PublicKey(s.permit.program).toBase58(),genesis:base58Encode(s.permit.domain),scan:async()=>[s],evidence:vi.fn(async(_s,k)=>({signature:k,slot:k==='funded'||k==='direct'?123:125})),captureEvidence:vi.fn(async(_s,k)=>evidence(k)),validateRetainedEvidence:vi.fn(async(value)=>value as unknown as VerifiedTransactionEvidence)};return {rpc,observer,applied,s};
  }
  it.each(['funded','released','refunded','direct'] as const)('restores %s after browser/process restart; retry consumes no new money',async kind=>{
    const {rpc,observer}=await setup(kind);const one=await reconcilePayments({rpc},observer,20,{rpc});expect(one.failed).toEqual([]);expect(one.processed).toBe(kind==='released'||kind==='refunded'?2:1);
    expect((await reconcilePayments({rpc},observer,20,{rpc})).processed).toBe(0);
    expect(rpc.mock.calls.every(([name])=>!name.includes('purchase_card'))).toBe(true);
  });
  it('rejects two wrappers sharing a credential even when their objects differ',async()=>{
    const {observer}=await setup();const scan=vi.spyOn(observer,'scan');const rpc=vi.fn(async()=>({data:{login:'same-login',role:'payment_v2_verifier',superuser:false},error:null}));
    await expect(reconcilePayments({rpc},observer,20,{rpc})).rejects.toThrow('identity mismatch');expect(scan).not.toHaveBeenCalled();
  });
  it('also rejects identical login names when two wrappers report different role labels',async()=>{
    const {observer}=await setup();const scan=vi.spyOn(observer,'scan');const rpc=vi.fn(async(_n:string,args:Record<string,unknown>)=>({data:{login:'one-credential',role:args.p_required_role,superuser:false},error:null}));
    await expect(reconcilePayments({rpc},observer,20,{rpc})).rejects.toThrow('distinct database logins');expect(scan).not.toHaveBeenCalled();
  });
  it('keeps funding receipt identity stable when later escrow decisions change revision',async()=>{
    const {rpc,observer}=await setup('released');await reconcilePayments({rpc},observer,20,{rpc});
    const events=rpc.mock.calls.filter(([name])=>name==='fn_payment_v2_record_verified_event').map(([,args])=>args.p_event as {kind:string;decisionRevision:string});
    expect(events).toEqual([expect.objectContaining({kind:'funded',decisionRevision:'0'}),expect.objectContaining({kind:'released',decisionRevision:'1'})]);
  });
  it('recovers a committed event after response loss instead of repeating payment',async()=>{
    const {rpc,observer}=await setup();const original=rpc.getMockImplementation()!;let lost=true;
    rpc.mockImplementation(async(name,args)=>{const result=await original(name,args);if(name==='fn_payment_v2_reconcile_event'&&lost){lost=false;throw new Error('lost response');}return result;});
    expect((await reconcilePayments({rpc},observer,20,{rpc})).failed).toHaveLength(1);expect((await reconcilePayments({rpc},observer,20,{rpc})).failed).toEqual([]);
  });
  it('preserves unresolved obligations on missing schema/history; never fabricates success',async()=>{
    const {observer}=await setup();const rpc=vi.fn(async()=>({data:null,error:{code:'PGRST202',message:'RPC not installed'}}));
    await expect(reconcilePayments({rpc},observer,20,{rpc})).rejects.toThrow('PGRST202');
    await expect(ownPaymentAttempts({rpc},'listing')).rejects.toThrow('RPC not installed');
  });
  it('rejects substituted immutable binding even when wallets later relink',async()=>{
    const {rpc,observer,s}=await setup();const original=rpc.getMockImplementation()!;
    rpc.mockImplementation(async(name,args)=>name==='fn_payment_v2_recovery_binding'?{data:{permitHex:Buffer.from(encodePermit({...s.permit,buyer:b(29)})).toString('hex'),appliedKinds:[]},error:null}:original(name,args));
    expect((await reconcilePayments({rpc},observer,20,{rpc})).failed[0].error).toContain('immutable');
  });
  it('rejects attempts for another listing and decisions without exact evidence',async()=>{
    const rpc=vi.fn(async()=>({data:[],error:null}));
    await expect(recordPaymentDecision({rpc},{escrowId:'x',commandId:'x',expectedRevision:'0',action:'release',pairCommitment:'',evidenceDigest:''})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();
    await expect(initiatePaymentAttempt({rpc},'bad','bad')).rejects.toThrow();
  });
});
describe('approved policy and paused customer flow',()=>{
  it('hashes an immutable versioned rule record, not only a label',async()=>{
    expect(await paymentPolicyDigest()).toBe('834ca943173d4db87622426e161eeb17afcdbac94e37368e6f697430961925c5');expect(Object.isFrozen(PAYMENT_POLICY_V1)).toBe(true);
  });
  it('dispatch grace leads only to review; transit is not default',()=>{
    expect(dispatchReview(0,73*3600*1000,'label')).toBe('review_required');expect(dispatchReview(0,500*3600*1000,'carrier_accepted')).toBe('in_transit');
    expect(dispatchReview(0,60*3600*1000,'unknown')).toBe('awaiting_dispatch');expect(PAYMENT_POLICY_V1.manualRefundApproval).toBe(true);
  });
  it('has no signing/new-payment control; restores status only; Stripe/Panda are not converted to escrow',()=>{
    expect(FUNDING_AVAILABLE).toBe(false);const html=renderToStaticMarkup(createElement(SolanaBuyPanel,{listingId:'listing',priceCents:2000}));
    expect(html).toContain('Recover payment status');expect(html).toContain('Do not pay again');expect(html).not.toContain('Confirm in wallet');
  });
});
