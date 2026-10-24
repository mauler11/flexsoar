import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { associatedTokenAddress, TOKEN_PROGRAM_ID } from '@/lib/solana/sdk';
import { base58Decode, decodeAddress } from '@/lib/solana/base58';
import { decodeListingMessage, encodeListing, listingBinding, listingForSale, verifyListingSignature } from '@/lib/solana/listing-v2';
import { decodeB64Url, sha256, verifyHmac, verifySupabaseJwt } from './crypto';
import { calculateFx } from './fx';
import type { IssuerContext, IssuerDeps } from './types';

export interface IssuerRequest { method: string; path: string; headers: Record<string,string|undefined>; rawBody: Uint8Array }
export interface IssuerResponse { status: number; body: Record<string, unknown> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const U64 = (BigInt('1') << BigInt('64')) - BigInt('1');
function fail(code: string, status = code.startsWith('ISSUER_AUTH') ? 401 : 422): never { throw Object.assign(new Error(code), { code, status }); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ISSUER_BAD_REQUEST',400); return value as Record<string,unknown>; }
function exact(o: Record<string,unknown>, keys: string[]): void { if (Object.keys(o).sort().join(',') !== [...keys].sort().join(',')) fail('ISSUER_BAD_REQUEST',400); }
function strictJson(bytes: Uint8Array): Record<string,unknown> { try { const s = new TextDecoder('utf-8',{fatal:true}).decode(bytes); return object(JSON.parse(s)); } catch { return fail('ISSUER_BAD_REQUEST',400); } }
function canonicalDecimal(v: unknown): string { if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v)) fail('ISSUER_BAD_REQUEST',400); return v; }
function b58(value: unknown): Uint8Array { if (typeof value !== 'string') fail('ISSUER_BAD_REQUEST',400); try { const b=decodeAddress(value); if (Buffer.from(b).toString('base64') === '') fail('ISSUER_BAD_REQUEST',400); return b; } catch { return fail('ISSUER_BAD_REQUEST',400); } }
function accountEqual(a: Uint8Array,b:Uint8Array):boolean{return a.length===b.length&&a.every((v,i)=>v===b[i]);}
function context(deps: IssuerDeps, ctx: IssuerContext, userId: string, ownerFailure='ISSUER_LISTING_NOT_OWNED'): void { if (ctx.found !== true || ctx.ownerId !== userId || ctx.ownerAuthId !== userId) fail(ownerFailure,403); if(!deps.config.allowList.has(userId)) fail('ISSUER_USER_NOT_ALLOWED',403); }

async function pipeline(req: IssuerRequest, deps: IssuerDeps): Promise<string> {
  if(req.method!=='POST'||req.path.includes('?')||req.rawBody.length>32768||req.headers['content-type']!=='application/json; charset=utf-8')fail('ISSUER_BAD_REQUEST',400);
  const h=req.headers; const kid=h['x-flexsoar-kid']??'', stamp=h['x-flexsoar-timestamp']??'', nonceText=h['x-flexsoar-nonce']??'', userId=h['x-flexsoar-user']??'', mac=h['x-flexsoar-signature']??'';
  if(!UUID.test(userId))fail('ISSUER_AUTH_INVALID'); let nonce:Uint8Array;try{nonce=decodeB64Url(nonceText,16)}catch{fail('ISSUER_AUTH_INVALID')}
  try{verifyHmac({method:req.method,path:req.path,timestamp:stamp,nonce,userId,body:req.rawBody,kid,signature:mac},deps.config.hmacKeys,deps.config.activeHmacKid,deps.nowSeconds())}catch(e){const code=(e as Error).message;fail(code.startsWith('ISSUER_AUTH')?code:'ISSUER_AUTH_INVALID')}
  try{await deps.db.consumeIssuerNonce(kid,nonce)}catch(e){const code=(e as Error).message;if(code.includes('NONCE_REPLAY'))fail('ISSUER_AUTH_REPLAY');if(code.includes('KEY_INACTIVE')||code.includes('KEY_STATE_INVALID'))fail('ISSUER_AUTH_INVALID');fail('ISSUER_DB_UNAVAILABLE',503)}
  const auth=h.authorization??''; if(!auth.startsWith('Bearer ')||auth.length<16)fail('ISSUER_AUTH_REQUIRED');
  let sub:string;try{sub=await verifySupabaseJwt(auth.slice(7),await deps.jwks.get(deps.config.jwksUrl),{issuer:deps.config.issuer,audience:deps.config.audience,kid:deps.config.jwtKid,now:deps.nowSeconds()})}catch(e){const code=(e as Error).message;fail(code==='ISSUER_AUTH_EXPIRED'?code:'ISSUER_AUTH_INVALID')}
  if(sub!==userId)fail('ISSUER_AUTH_SUB_MISMATCH'); if(!deps.config.allowList.has(sub))fail('ISSUER_USER_NOT_ALLOWED',403);
  return sub;
}

async function enroll(body:Record<string,unknown>, userId:string, deps:IssuerDeps):Promise<Record<string,unknown>>{
  if(body.phase==='challenge'){
    exact(body,['phase','networkGenesis','wallet']); const wallet=String(body.wallet),genesis=String(body.networkGenesis);b58(wallet);
    if(genesis!==deps.config.networkGenesis)fail('ISSUER_NETWORK_MISMATCH',403);
    const network=await deps.db.subjectContext('network',null,deps.config.networkId); if(network.genesis!==genesis)fail('ISSUER_NETWORK_MISMATCH',403);
    const ata=associatedTokenAddress(wallet,deps.config.mint),issuedAt=String(deps.nowSeconds());
    const message=`FlexSoar wallet enrollment v1\nnetwork:${genesis}\nuser:${userId}\nwallet:${wallet}\nmint:${deps.config.mint}\ntoken-account:${ata}\nissued-at:${issuedAt}`;
    return {networkGenesis:genesis,wallet,mint:deps.config.mint,tokenAccount:ata,issuedAt,message};
  }
  exact(body,['phase','networkGenesis','wallet','mint','tokenAccount','issuedAt','signature']);
  const genesis=String(body.networkGenesis),wallet=String(body.wallet),mint=String(body.mint),tokenAccount=String(body.tokenAccount),issuedAt=canonicalDecimal(body.issuedAt);
  const walletBytes=b58(wallet),mintBytes=b58(mint),ata=associatedTokenAddress(wallet,mint);
  if(genesis!==deps.config.networkGenesis)fail('ISSUER_NETWORK_MISMATCH',403); if(mint!==deps.config.mint||tokenAccount!==ata)fail('ISSUER_ATA_MISMATCH');
  const network=await deps.db.subjectContext('network',null,deps.config.networkId);if(network.genesis!==genesis)fail('ISSUER_NETWORK_MISMATCH',403);
  const issued=Number(issuedAt),now=deps.nowSeconds(); if(!Number.isSafeInteger(issued)||issued<now-300||issued>now+30)fail('ISSUER_PROOF_EXPIRED');
  const message=new TextEncoder().encode(`FlexSoar wallet enrollment v1\nnetwork:${genesis}\nuser:${userId}\nwallet:${wallet}\nmint:${mint}\ntoken-account:${tokenAccount}\nissued-at:${issuedAt}`);
  let signature:Uint8Array;try{signature=decodeB64Url(String(body.signature),64)}catch{fail('ISSUER_PROOF_MALFORMED')}
  let proofValid=false;try{const publicKeyBytes=new Uint8Array(new ArrayBuffer(walletBytes.length));publicKeyBytes.set(walletBytes);const signatureBytes=new Uint8Array(new ArrayBuffer(signature.length));signatureBytes.set(signature);const messageBytes=new Uint8Array(new ArrayBuffer(message.length));messageBytes.set(message);const key=await crypto.subtle.importKey('raw',publicKeyBytes,{name:'Ed25519'},false,['verify']);proofValid=await crypto.subtle.verify({name:'Ed25519'},key,signatureBytes,messageBytes)}catch{}
  if(!proofValid)fail('ISSUER_PROOF_INVALID');
  if(!accountEqual(mintBytes,b58(deps.config.mint)))fail('ISSUER_MINT_INVALID');
  const [a,b]=deps.rpc; let g1:string,g2:string,s1:bigint,s2:bigint;try{[g1,g2,s1,s2]=await Promise.all([a.genesis(),b.genesis(),a.finalizedSlot(),b.finalizedSlot()])}catch{fail('ISSUER_RPC_UNAVAILABLE',503)}
  if(g1!==genesis||g2!==genesis||s1!>s2!+BigInt('32')||s2!>s1!+BigInt('32'))fail('ISSUER_RPC_DISAGREEMENT'); const target=s1!<s2!?s1!:s2!;
  const [m1,m2,t1,t2]=await Promise.all([a.account(mint,target),b.account(mint,target),a.account(ata,target),b.account(ata,target)]).catch(()=>fail('ISSUER_RPC_UNAVAILABLE',503));
  const accounts=[m1,m2,t1,t2];if(accounts.some(x=>!x||x.contextSlot<target||x.contextSlot>target+BigInt('32'))||!accountEqual(m1!.data,m2!.data)||!accountEqual(t1!.data,t2!.data))fail('ISSUER_RPC_DISAGREEMENT');
  const ma=m1!,ta=t1!;if(ma.owner!==deps.config.tokenProgram||ma.data.length!==82||ma.data[44]!==deps.config.tokenDecimals||ma.data[45]!==1)fail('ISSUER_MINT_INVALID');
  if(ta.owner!==deps.config.tokenProgram||ta.data.length!==165||!accountEqual(ta.data.subarray(0,32),mintBytes)||!accountEqual(ta.data.subarray(32,64),walletBytes)||ta.data[108]!==1)fail('ISSUER_TOKEN_ACCOUNT_INVALID');
  const digest=sha256(new Uint8Array([...message,...signature])); await deps.db.enrollWalletChecked(userId,deps.config.networkId,walletBytes,b58(ata),digest);
  return {enrolled:true,networkGenesis:genesis,wallet,mint,tokenAccount:ata,proofDigest:Buffer.from(digest).toString('hex')};
}

async function prepare(body:Record<string,unknown>, userId:string,deps:IssuerDeps):Promise<Record<string,unknown>>{
  exact(body,['listingId','requestId']);const listingId=String(body.listingId),requestId=String(body.requestId);if(!UUID.test(listingId)||!UUID.test(requestId))fail('ISSUER_BAD_REQUEST',400);
  const recovered=await deps.db.subjectContext('prepare_recovery',requestId,null);
  if(recovered.found===true){context(deps,recovered,userId);if(recovered.listingId!==listingId)fail('ISSUER_SALE_IDEMPOTENCY_CONFLICT',409);
    return saleResponse(String(recovered.saleId),listingId,String(recovered.quoteTotalUnits),String(recovered.quoteValidFrom),String(recovered.quoteExpiresAt),recovered.fxSnapshot as Record<string,unknown>,recovered,deps,userId);
  }
  const ctx=await deps.db.subjectContext('listing',listingId,deps.config.networkId);context(deps,ctx,userId);
  if(ctx.networkId!==deps.config.networkId||ctx.genesis!==deps.config.networkGenesis||ctx.program!==deps.config.program)fail('ISSUER_NETWORK_MISMATCH',403);
  if(ctx.listingStatus!=='active'||ctx.cardStatus!=='authenticated'||ctx.inventoryRegistered!==true||ctx.saleFenced===true)fail('ISSUER_LISTING_UNAVAILABLE',409);
  if(ctx.fundingEnabled!==true)fail('ISSUER_FUNDING_DISABLED',409);
  let q1,q2;try{[q1,q2]=await Promise.all([deps.fx[0].quote(),deps.fx[1].quote()])}catch{fail('ISSUER_FX_UNAVAILABLE',503)}
  let total:bigint,snapshot:Record<string,unknown>;try{({total,snapshot}=calculateFx([q1!,q2!],String(ctx.priceCents),deps.nowSeconds()))}catch(e){const code=(e as Error).message;if(['ISSUER_FX_STALE','ISSUER_FX_DISAGREEMENT','ISSUER_FX_INVALID','ISSUER_FX_OVERFLOW'].includes(code))fail(code);throw e;} const valid=deps.nowSeconds(),expires=valid+600;
  const terms={id:requestId,saleAddress:deps.config.saleAddress(ctx),escrowAddress:deps.config.escrowAddress(ctx),totalUnits:total.toString(),fxSnapshot:snapshot,validFrom:String(valid),expiresAt:String(expires)};
  const saleId=await deps.db.prepareSale(listingId,deps.config.networkId,terms);return saleResponse(saleId,listingId,total.toString(),String(valid),String(expires),snapshot,ctx,deps,userId);
}

async function saleResponse(saleId:string,listingId:string,total:string,validFrom:string,expiresAt:string,snapshot:Record<string,unknown>,ownerContext:IssuerContext,deps:IssuerDeps,userId:string):Promise<Record<string,unknown>>{
  const signing=await deps.db.saleSigningContext(saleId);context(deps,signing,userId);
  if(signing.saleId!==saleId||signing.listingId!==listingId||signing.ownerId!==ownerContext.ownerId||signing.ownerAuthId!==ownerContext.ownerAuthId)fail('ISSUER_LISTING_STALE',409);
  const preparedAtMs=Date.parse(String(signing.preparedAt));if(!Number.isFinite(preparedAtMs))fail('ISSUER_LISTING_STALE',409);
  const expiry=BigInt(Math.floor(preparedAtMs/1000))+BigInt('86400');
  const expiresAtListing=expiry>BigInt(expiresAt)?expiry:BigInt(expiresAt);
  const listing=listingForSale({domain:b58(signing.genesis),program:b58(signing.program),card:b58(signing.cardCommitment),saleId:b58(signing.saleCommitment),generation:BigInt(String(signing.generation))},BigInt(total),expiresAtListing,BigInt(String(signing.toleranceBps)));
  const message=await encodeListing(listing);
  return {saleId,listingId,cardId:String(signing.cardId),generation:String(signing.generation),networkGenesis:String(signing.genesis),program:String(signing.program),quote:{currency:'USDC',decimals:6,totalMicroUsdc:total,validFrom,expiresAt,fxSnapshot:snapshot},listing:{minTotalMicroUsdc:listing.minTotal.toString(),expiresAt:listing.expiresAt.toString(),messageBase64url:Buffer.from(message).toString('base64url')}};
}

async function record(body:Record<string,unknown>,userId:string,deps:IssuerDeps):Promise<Record<string,unknown>>{
  exact(body,['saleId','messageBase64url','signatureBase64url']);const saleId=String(body.saleId);if(!UUID.test(saleId))fail('ISSUER_BAD_REQUEST',400);
  let message:Uint8Array,signature:Uint8Array;try{message=decodeB64Url(String(body.messageBase64url),61);signature=decodeB64Url(String(body.signatureBase64url),64)}catch{fail('ISSUER_LISTING_MESSAGE_MALFORMED')}
  const ctx=await deps.db.subjectContext('sale',saleId,null);context(deps,ctx,userId,'ISSUER_SALE_NOT_OWNED');
  const signing=await deps.db.saleSigningContext(saleId);context(deps,signing,userId,'ISSUER_SALE_NOT_OWNED');
  if(signing.saleId!==saleId||signing.ownerId!==ctx.ownerId||signing.ownerAuthId!==ctx.ownerAuthId||signing.state!==ctx.state||signing.quoteTotalUnits!==ctx.quoteTotalUnits||signing.quoteExpiresAt!==ctx.quoteExpiresAt)fail('ISSUER_LISTING_STALE',409);
  const saleContext={...ctx,...signing};
  if(ctx.state!=='opening')fail('ISSUER_SALE_NOT_OPENING',409);
  const domain=b58(saleContext.genesis),program=b58(saleContext.program),card=b58(saleContext.cardCommitment),sale=b58(saleContext.saleCommitment),generation=BigInt(String(saleContext.generation));
  const decoded=decodeListingMessage(message);const binding=await listingBinding({domain,program,card,saleId:sale,generation});
  if(!accountEqual(decoded.binding,binding))fail('ISSUER_LISTING_BINDING_INVALID');
  const wallet=b58(saleContext.sellerWallet);if(!(await verifyListingSignature(wallet,message,signature)))fail('ISSUER_LISTING_SIGNATURE_INVALID');
  const total=BigInt(String(ctx.quoteTotalUnits)),tol=BigInt(String(ctx.toleranceBps));
  const minAllowed=(total*(BigInt('10000')-tol)+BigInt('9999'))/BigInt('10000');
  if(total<=BigInt('0')||total>U64||tol<BigInt('0')||tol>=BigInt('10000')||decoded.minTotal<minAllowed||decoded.minTotal>total)fail('ISSUER_LISTING_FLOOR_OUT_OF_TOLERANCE');
  const preparedAtMs=Date.parse(String(saleContext.preparedAt));if(!Number.isFinite(preparedAtMs))fail('ISSUER_LISTING_STALE',409);
  const preparedAt=BigInt(Math.floor(preparedAtMs/1000));const expiry=decoded.expiresAt;
  if(expiry<=BigInt(deps.nowSeconds())||expiry<BigInt(String(ctx.quoteExpiresAt))||expiry>preparedAt+BigInt('86400'))fail('ISSUER_LISTING_EXPIRED');
  await deps.db.recordListing(saleId,message,signature);return {saleId,recorded:true,listingExpiresAt:expiry.toString(),minTotalMicroUsdc:decoded.minTotal.toString()};
}

export async function handleIssuerRequest(req:IssuerRequest,deps:IssuerDeps):Promise<IssuerResponse>{
  try{const userId=await pipeline(req,deps),body=strictJson(req.rawBody);let result:Record<string,unknown>;
    if(req.path==='/v1/enroll-wallet')result=await enroll(body,userId,deps);else if(req.path==='/v1/prepare-sale')result=await prepare(body,userId,deps);else if(req.path==='/v1/record-listing')result=await record(body,userId,deps);else if(req.path==='/v1/authorize-attempt'||req.path==='/internal/open-sale-submit')fail('ISSUER_BARE_OPEN_REFUSED',409);else fail('ISSUER_BAD_REQUEST',404);
    return {status:200,body:result};
  }catch(e){const error=e as Error&{code?:string;status?:number};return {status:error.status??500,body:{error:{code:error.code??'ISSUER_INTERNAL',message:error.code??'Issuer request failed',retryable:error.status===503}}};}
}
