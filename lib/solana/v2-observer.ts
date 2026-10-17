import { PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js';
import { decodePermit, equalBytes, encodePermit, validatePermit, type PermitV2 } from './protocol-v2';
import { base58Encode, base58Decode } from './base58';
import { discriminator, v2Addresses } from './v2-sdk';
import { TOKEN_PROGRAM_ID } from './sdk';
import { acquireFinalizedEvidence,LocalFinalizedRpcSource,validateRetainedFinalizedEvidence,type FinalizedTransactionSource,type VerifiedTransactionEvidence } from './v2-evidence';
export interface SaleSnapshot { address: string; permit: PermitV2; state: number; fundedSlot: number; fundedAt: bigint; outcomeSlot: number; decisionRevision: bigint }
export function localRpc(url: string): string {
  const u = new URL(url);
  if (u.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash) throw new Error('only explicit loopback RPC is supported');
  return u.href;
}
export async function decodeSale(address: string, bytes: Uint8Array, program: string): Promise<SaleSnapshot> {
  if (bytes.length !== 961 || !equalBytes(bytes.slice(0,8),await discriminator('account:SaleV2'))) throw new Error('invalid SaleV2 account');
  const permit = decodePermit(bytes.slice(8,698));
  const derived = v2Addresses(program,permit.card,permit.saleId);
  if (new PublicKey(permit.program).toBase58() !== program || derived.sale.toBase58() !== address || !derived.config.equals(new PublicKey(permit.config))) throw new Error('sale PDA/program mismatch');
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const fundedAt=view.getBigInt64(708,true);
  if(![1,2,3,4,5,6].includes(bytes[698]))throw new Error('invalid sale lifecycle');
  if([2,3,4,5].includes(bytes[698]))validatePermit(permit,fundedAt);
  const safeSlot = (offset: number) => { const v = view.getBigUint64(offset,true); if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('unsafe slot'); return Number(v); };
  return {address,permit,state:bytes[698],fundedSlot:safeSlot(700),fundedAt,outcomeSlot:safeSlot(716),decisionRevision:view.getBigUint64(921,true)};
}
export interface V2Transaction {
  slot: number; transaction: {signatures: string[]; message: {
    accountKeys: {pubkey:string;signer:boolean;writable:boolean}[];
    instructions: {programId:string;accounts?:string[];data?:string;program?:string;parsed?:{type:string;info:Record<string,unknown>}}[];
  }};
  meta: {err: unknown; [key:string]:unknown; innerInstructions?: {index:number;instructions:{programId:string;parsed?:{type:string;info:Record<string,string>}}[]}[];
    preTokenBalances?: Balance[];postTokenBalances?: Balance[]};
}
interface Balance {accountIndex:number;mint:string;owner?:string;programId?:string;uiTokenAmount:{amount:string;decimals:number}}
export type OutcomeKind = 'funded' | 'direct' | 'released' | 'refunded';
export async function inspectV2Transaction(tx: V2Transaction, signature: string, s: SaleSnapshot, kind: OutcomeKind): Promise<void> {
  const p=s.permit; const program=new PublicKey(p.program).toBase58(); const a=v2Addresses(program,p.card,p.saleId);
  validatePermit(p,s.fundedAt); // Program-recorded execution Clock, NOT current quote expiry.
  if(new PublicKey(p.tokenProgram).toBase58()!==TOKEN_PROGRAM_ID)throw new Error('wrong token program');
  const isPurchase=kind==='funded'||kind==='direct';
  const expectedSlot=isPurchase?s.fundedSlot:s.outcomeSlot;
  if (tx.meta?.err !== null || tx.slot!==expectedSlot || tx.transaction?.signatures[0]!==signature) throw new Error('transaction/finality evidence mismatch');
  if ((kind==='funded'&&p.mode!==0)||(kind==='direct'&&p.mode!==1)||(kind==='released'&&s.state!==4)||(kind==='refunded'&&s.state!==5)) throw new Error('wrong outcome mode/state');
  const message=tx.transaction.message; const matches=message.instructions.map((ix,index)=>({ix,index})).filter(({ix})=>ix.programId===program);
  if(matches.length!==1) throw new Error('ambiguous program invocation');
  const {ix,index}=matches[0]; const bytes=base58Decode(ix.data??'');
  const disc=await discriminator(isPurchase?'global:buy_sale':'global:execute_outcome');
  if(!equalBytes(bytes.slice(0,8),disc)) throw new Error('wrong payment instruction');
  const buyer=new PublicKey(p.buyer).toBase58(); const issuer=new PublicKey(p.issuer).toBase58();
  const source=new PublicKey(p.buyerToken).toBase58(), seller=new PublicKey(p.sellerToken).toBase58(), treasury=new PublicKey(p.treasuryToken).toBase58(), refund=new PublicKey(p.refundToken).toBase58();
  const accounts=isPurchase?[a.config.toBase58(),a.card.toBase58(),s.address,issuer,buyer,source,seller,treasury,a.escrow.toBase58(),TOKEN_PROGRAM_ID,SYSVAR_INSTRUCTIONS_PUBKEY.toBase58()]:[a.config.toBase58(),s.address,a.escrow.toBase58(),seller,treasury,refund,TOKEN_PROGRAM_ID,SYSVAR_INSTRUCTIONS_PUBKEY.toBase58()];
  if(ix.accounts?.length!==accounts.length||accounts.some((v,i)=>ix.accounts![i]!==v)) throw new Error('wrong instruction accounts');
  if(isPurchase) {
    if(!equalBytes(bytes.slice(8),encodePermit(p))) throw new Error('wrong immutable permit');
    for(const key of [buyer,issuer]) if(!message.accountKeys.some(k=>k.pubkey===key&&k.signer)) throw new Error('missing buyer/issuer signature');
  } else if(bytes.length!==16||new DataView(bytes.buffer,bytes.byteOffset).getBigUint64(8,true)!==s.decisionRevision) throw new Error('stale outcome revision');
  const moves: [string,string,string,bigint][] = kind==='funded'?[[source,a.escrow.toBase58(),buyer,p.total]]:
    kind==='direct'?[[source,seller,buyer,p.net],[source,treasury,buyer,p.fee]]:
    kind==='released'?[[a.escrow.toBase58(),seller,s.address,p.net],[a.escrow.toBase58(),treasury,s.address,p.fee]]:[[a.escrow.toBase58(),refund,s.address,p.total]];
  const transfers=(tx.meta.innerInstructions??[]).filter(g=>g.index===index).flatMap(g=>g.instructions).filter(t=>t.programId===TOKEN_PROGRAM_ID);
  if(transfers.length!==moves.length||moves.some(([from,to,authority,amount],i)=>{const t=transfers[i];return t.parsed?.type!=='transfer'||t.parsed.info.source!==from||t.parsed.info.destination!==to||t.parsed.info.authority!==authority||t.parsed.info.amount!==String(amount);})) throw new Error('instruction-scoped transfers mismatch');
  const deltas=new Map<string,bigint>(); for(const [from,to,,amount]of moves){deltas.set(from,(deltas.get(from)??BigInt(0))-amount);deltas.set(to,(deltas.get(to)??BigInt(0))+amount);}
  const owners=new Map([[source,buyer],[seller,new PublicKey(p.seller).toBase58()],[treasury,new PublicKey(p.treasury).toBase58()],[refund,buyer],[a.escrow.toBase58(),s.address]]);
  for(const [address,delta]of deltas){const idx=message.accountKeys.findIndex(k=>k.pubkey===address&&k.writable);if(idx<0)throw new Error('missing writable payment account');
    const pre=(tx.meta.preTokenBalances??[]).filter(b=>b.accountIndex===idx);const post=(tx.meta.postTokenBalances??[]).filter(b=>b.accountIndex===idx);
    if(pre.length>1||post.length>1||pre.length+post.length===0)throw new Error('missing token evidence');
    for(const b of [...pre,...post])if(b.mint!==new PublicKey(p.mint).toBase58()||b.owner!==owners.get(address)||b.programId!==TOKEN_PROGRAM_ID||b.uiTokenAmount.decimals!==6||!/^\d+$/.test(b.uiTokenAmount.amount))throw new Error('wrong token owner/mint');
    if(BigInt(post[0]?.uiTokenAmount.amount??'0')-BigInt(pre[0]?.uiTokenAmount.amount??'0')!==delta)throw new Error('wrong token delta');
  }
}
/** Read-only loopback observer. No signing, token creation, broadcasting or DB calls. */
export class LocalV2Observer {
  constructor(private url: string, readonly program: string, readonly genesis: string, private request: typeof fetch=fetch,private archive:FinalizedTransactionSource|null=null) {localRpc(url);new PublicKey(program);if(base58Decode(genesis).length!==32)throw new Error('invalid genesis identity');}
  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    const response=await this.request(localRpc(this.url),{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'v2-observe',method,params})});
    if(!response.ok)throw new Error(`RPC HTTP ${response.status}`);
    const body=await response.json();if(body.error)throw new Error(`RPC ${method}: ${JSON.stringify(body.error)}`);return body.result;
  }
  async scan(): Promise<SaleSnapshot[]> {
    if(await this.rpc('getGenesisHash',[])!==this.genesis)throw new Error('wrong genesis');
    const raw=await this.rpc('getProgramAccounts',[this.program,{encoding:'base64',commitment:'finalized',filters:[{memcmp:{offset:0,bytes:base58Encode(await discriminator('account:SaleV2'))}}]}]);
    if(!Array.isArray(raw)||raw.length>500)throw new Error('scan incomplete/too large; partitioned observer required');
    const rows: SaleSnapshot[]=[];
    for(const row of raw){if(row.account?.owner!==this.program||row.account?.executable||row.account?.data?.[1]!=='base64')throw new Error('invalid account evidence');rows.push(await decodeSale(row.pubkey,Buffer.from(row.account.data[0],'base64'),this.program));}return rows;
  }
  async evidence(s: SaleSnapshot, kind: OutcomeKind): Promise<{signature:string;slot:number}> {
    const slot=(kind==='funded'||kind==='direct')?s.fundedSlot:s.outcomeSlot;
    // Read primary history first, then the explicitly configured archive. Each
    // candidate is instruction/account checked; no absence is treated as proof.
    const blocks:Array<{source:string;value:unknown}>=[];
    try{blocks.push({source:'primary',value:await this.rpc('getBlock',[slot,{encoding:'jsonParsed',commitment:'finalized',transactionDetails:'full',rewards:false,maxSupportedTransactionVersion:0}])});}catch{}
    if(this.archive?.getBlock)try{blocks.push({source:'archive',value:await this.archive.getBlock(slot)});}catch{}
    const matches:Array<{signature:string;source:string}>=[];
    for(const block of blocks){const raw=block.value;if(!raw||typeof raw!=='object'||!('transactions' in raw)||!Array.isArray(raw.transactions)||raw.transactions.length>10000)continue;
      for(const row of raw.transactions){if(row.meta?.err!==null)continue;const signature=row.transaction?.signatures?.[0];if(typeof signature!=='string')continue;
        try{await inspectV2Transaction({...row,slot} as V2Transaction,signature,s,kind);matches.push({signature,source:block.source});}
        catch{ /* Other transactions in this slot are not evidence for this sale. */ }
      }
    }
    if(matches.length>1&&new Set(matches.map(m=>m.signature)).size>1)throw new Error('conflicting finalized primary/archive transaction matches');
    if(matches.length)return {signature:matches[0].signature,slot};
    throw new Error('payment history unavailable; retain unresolved obligation');
  }
  async captureEvidence(s:SaleSnapshot,kind:OutcomeKind,attemptId:string,networkId:string):Promise<VerifiedTransactionEvidence>{
    const found=await this.evidence(s,kind),primary=new LocalFinalizedRpcSource(this.url,'local-primary',this.request);
    return acquireFinalizedEvidence(primary,this.archive,{networkId,genesis:this.genesis,program:this.program,signature:found.signature,subjectKind:'payment_event',subjectId:attemptId,subjectAction:kind},(tx,signature)=>inspectV2Transaction(tx,signature,s,kind));
  }
  async validateRetainedEvidence(value:Record<string,unknown>,s:SaleSnapshot,kind:OutcomeKind,attemptId:string,networkId:string):Promise<VerifiedTransactionEvidence>{
    return validateRetainedFinalizedEvidence(value,{networkId,genesis:this.genesis,program:this.program,signature:String(value.signature??''),subjectKind:'payment_event',subjectId:attemptId,subjectAction:kind},(tx,signature)=>inspectV2Transaction(tx,signature,s,kind));
  }
}
