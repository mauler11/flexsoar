import { describe, expect, it } from 'vitest';
import { createHash, createHmac, createPrivateKey, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { AddressLookupTableProgram, Keypair, Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js';
import { calculateFx } from './fx';
import { handleIssuerRequest } from './service';
import type { IssuerContext, IssuerDeps, IssuerJwk } from './types';
import { associatedTokenAddress } from '@/lib/solana/sdk';
import { base58Encode, decodeAddress } from '@/lib/solana/base58';
import { encodeListing, listingForSale } from '@/lib/solana/listing-v2';
import { encodePermit, type PermitV2 } from '@/lib/solana/protocol-v2';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@/lib/solana/sdk';
import { v2Addresses, buyV2Instruction } from '@/lib/solana/v2-sdk';
import type { SignerPins } from '@/workers/signer/types';
import { signValidatedTransaction, validateSignerRequest } from '@/workers/signer/validator';
import { createIssuerRateLimiter } from './rate-limit';

const now = 1_800_000_000;
const user = '11111111-1111-4111-8111-111111111111';
const hmacKey = Buffer.from('unit-test-hmac-key-not-a-real-credential');
const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const exported = pair.publicKey.export({ format: 'jwk' });
const jwk: IssuerJwk = { ...exported, kid: 'e3ee4930-ea76-4189-8036-8fa384097de1', alg: 'ES256', use: 'sig', key_ops: ['verify'] };

function jwt(claims: Record<string, unknown>, alg = 'ES256', kid = jwk.kid, extraHeader:Record<string,unknown>={}): string {
  const enc = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const head = enc({ alg, kid, typ: 'JWT',...extraHeader }), body = enc(claims), input = `${head}.${body}`;
  return `${input}.${cryptoSign('sha256', Buffer.from(input), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
function rawJwt(header:string,payload:string):string{const head=Buffer.from(header).toString('base64url'),body=Buffer.from(payload).toString('base64url'),input=`${head}.${body}`;return `${input}.${cryptoSign('sha256',Buffer.from(input),{key:pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')}`;}
function claims(overrides: Record<string, unknown> = {}) { return { iss:'https://issuer.example/auth/v1', aud:'authenticated', role:'authenticated', sub:user, iat:now-10, exp:now+300, ...overrides }; }
function request(token: string, options: { path?: string; userId?: string; nonce?: string; badMac?: boolean; body?: string } = {}) {
  const body = Buffer.from(options.body??'{}'), path=options.path??'/v1/authorize-attempt', stamp=String(now), nonce=options.nonce??Buffer.alloc(16, 1).toString('base64url'), uid=options.userId??user, kid='hmac-v1';
  const canonical=`flexsoar-issuer-v1\nPOST\n${path}\n${stamp}\n${nonce}\n${uid}\n${createHash('sha256').update(body).digest('hex')}`;
  const mac=createHmac('sha256',hmacKey).update(canonical).digest('hex');
  return { method:'POST',path,secure:true,rawBody:body,headers:{'content-type':'application/json; charset=utf-8','x-flexsoar-kid':kid,'x-flexsoar-timestamp':stamp,'x-flexsoar-nonce':nonce,'x-flexsoar-user':uid,'x-flexsoar-signature':options.badMac?'0'.repeat(64):mac,authorization:`Bearer ${token}`} };
}
function deps() {
  const counters={nonce:0,nonceRows:0,reads:0,writes:0,signer:0,sender:0,signerError:''};
  const nonces=new Set<string>();
  const db: IssuerDeps['db']={
    consumeIssuerNonce:async(_kid,nonce)=>{counters.nonce++;const n=Buffer.from(nonce).toString('hex');if(nonces.has(n))throw Error('PAYMENT_V2_ISSUER_NONCE_REPLAY');nonces.add(n);counters.nonceRows=nonces.size}, subjectContext:async()=>{counters.reads++;return {found:true}}, saleSigningContext:async()=>{counters.reads++;return {found:true}},
    enrollWalletChecked:async()=>{counters.writes++}, prepareSale:async()=>{counters.writes++;return '22222222-2222-4222-8222-222222222222'},recordListing:async()=>{counters.writes++},
    authorizeAttempt:async()=>{counters.writes++;return ''},listingForOpen:async()=>({found:true}),openSaleQueue:async()=>[],claimOpenSale:async()=>[],renewOpenSaleLease:async()=>{},finishOpenSale:async()=>{},
  };
  const d:IssuerDeps={db,rpc:[{genesis:async()=>'',finalizedSlot:async()=>BigInt('1'),account:async()=>null},{genesis:async()=>'',finalizedSlot:async()=>BigInt('1'),account:async()=>null}],fx:[{quote:async()=>{throw Error()}},{quote:async()=>{throw Error()}}],jwks:{get:async()=>[jwk]},rateLimiter:createIssuerRateLimiter(),nowSeconds:()=>now,
    config:{hmacKeys:new Map([['hmac-v1',hmacKey]]),activeHmacKid:'hmac-v1',issuer:'https://issuer.example/auth/v1',audience:'authenticated',jwksUrl:'https://issuer.example/jwks',jwtKid:jwk.kid!,allowList:new Set([user]),networkId:'33333333-3333-4333-8333-333333333333',networkGenesis:'11111111111111111111111111111111',mint:'11111111111111111111111111111111',tokenProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',associatedTokenProgram:'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',tokenDecimals:6,program:'11111111111111111111111111111111',networkConfig:'11111111111111111111111111111111',saleAddress:()=>'',escrowAddress:()=>''}};
  return { d, counters };
}
async function authorizeFixture(options:{wrongBuyer?:boolean;expiredListing?:boolean;belowFloor?:boolean;wrongListingSale?:boolean;wrongListingSeller?:boolean;wrongGeneration?:boolean;wrongBinding?:boolean;dbError?:string}={}){
  const {d,counters}=deps(),buyerId=user,sellerId='44444444-4444-4444-8444-444444444444',attemptId='55555555-5555-4555-8555-555555555555',saleId='66666666-6666-4666-8666-666666666666',seller=Keypair.generate(),buyer=Keypair.generate(),treasury=Keypair.generate(),issuer=Keypair.generate(),programKey=Keypair.generate().publicKey,genesisKey=Keypair.generate().publicKey,mintKey=Keypair.generate().publicKey;
  d.config.program=programKey.toBase58();d.config.networkGenesis=genesisKey.toBase58();d.config.mint=mintKey.toBase58();
  const genesis=genesisKey.toBytes(),program=programKey.toBytes(),mint=mintKey.toBytes(),card=Keypair.generate().publicKey.toBytes(),saleCommitment=Keypair.generate().publicKey.toBytes(),config=v2Addresses(d.config.program,card,saleCommitment).config.toBytes();d.config.networkConfig=base58Encode(config);
  const buyerToken=decodeAddress(associatedTokenAddress(buyer.publicKey.toBase58(),d.config.mint)),sellerToken=decodeAddress(associatedTokenAddress(seller.publicKey.toBase58(),d.config.mint)),treasuryToken=decodeAddress(associatedTokenAddress(treasury.publicKey.toBase58(),d.config.mint));
  const total=BigInt('1000000'),validFrom=BigInt(Math.floor(Date.now()/1000)-10),expiresAt=BigInt(now+300);
  const permit:PermitV2={mode:1,domain:genesis,program,config,saleId:saleCommitment,card,pair:Keypair.generate().publicKey.toBytes(),attempt:new Uint8Array(createHash('sha256').update(Buffer.from(attemptId.replaceAll('-',''),'hex')).digest()),beneficiary:new Uint8Array(createHash('sha256').update(Buffer.from(buyerId.replaceAll('-',''),'hex')).digest()),policy:new Uint8Array(createHash('sha256').update('local-policy').digest()),buyer:buyer.publicKey.toBytes(),seller:seller.publicKey.toBytes(),treasury:treasury.publicKey.toBytes(),mint,tokenProgram:decodeAddress(d.config.tokenProgram),buyerToken,sellerToken,treasuryToken,refundToken:buyerToken,issuer:issuer.publicKey.toBytes(),generation:BigInt('1'),revision:BigInt('1'),custodyVersion:BigInt('1'),authorityEpoch:BigInt('1'),total,net:BigInt('950000'),fee:BigInt('50000'),validFrom,expiresAt};
  const signing=await encodeListing({domain:genesis,program,card,saleId:saleCommitment,generation:BigInt('1'),minTotal:options.belowFloor?BigInt('1000001'):BigInt('980000'),expiresAt:BigInt(options.expiredListing?now-1:now+600)});
  const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(seller.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'}),sellerSignature=cryptoSign(null,Buffer.from(signing),privateKey);
  const templateHex=Buffer.from(await encodePermit(permit)).toString('hex'),attempt:IssuerContext={found:true,attemptId,ownerId:options.wrongBuyer?sellerId:buyerId,ownerAuthId:options.wrongBuyer?sellerId:buyerId,saleId,networkId:d.config.networkId,state:'initiated',expiresAt:String(expiresAt),permitHex:null};
  const saleOwner={found:true,saleId,listingId:'77777777-7777-4777-8777-777777777777',ownerId:sellerId,ownerAuthId:sellerId,networkId:d.config.networkId,state:'open',sellerWallet:seller.publicKey.toBase58(),genesis:d.config.networkGenesis,program:d.config.program,saleCommitment:base58Encode(saleCommitment),cardCommitment:base58Encode(card),generation:'1',preparedAt:new Date((now-20)*1000).toISOString()};
  const sale={...saleOwner,actor:issuer.publicKey.toBase58(),sellerWallet:seller.publicKey.toBase58(),sellerToken:base58Encode(sellerToken),quoteTotalUnits:'1000000',quoteValidFrom:String(validFrom),quoteExpiresAt:String(expiresAt),templateHex};
  const listing={found:true,saleId,messageHex:Buffer.from(signing).toString('hex'),signatureHex:sellerSignature.toString('hex'),signer:seller.publicKey.toBase58(),minTotalUnits:options.belowFloor?'1000001':'980000',expiresAt:String(options.expiredListing?now-1:now+600)};
  if(options.wrongListingSale)listing.saleId='88888888-8888-4888-8888-888888888888';
  if(options.wrongListingSeller)listing.signer=Keypair.generate().publicKey.toBase58();
  if(options.wrongGeneration)sale.generation='2';
  if(options.wrongBinding){const bytes=Buffer.from(listing.messageHex,'hex');bytes[20]^=1;listing.messageHex=bytes.toString('hex');}
  d.config.allowList=new Set([buyerId,sellerId]);
  d.db.subjectContext=async(kind,id)=>{counters.reads++;if(kind==='attempt')return attempt;if(kind==='sale')return saleOwner;throw new Error(`unexpected subject kind ${kind} ${id??''}`)};
  d.db.saleSigningContext=async()=>{counters.reads++;return sale};d.db.listingForOpen=async()=>{counters.reads++;return listing};
  d.db.authorizeAttempt=async()=>{if(options.dbError)throw new Error(options.dbError);counters.writes++;attempt.state='authorized';attempt.permitHex=templateHex;return templateHex};
  const instruction=await buyV2Instruction(permit),addresses=[...new Set(instruction.keys.filter(meta=>!meta.isSigner).map(meta=>meta.pubkey.toBase58()))],lookupAddress=Keypair.generate().publicKey.toBase58(),addressesSha256=createHash('sha256').update(Buffer.concat(addresses.map(address=>Buffer.from(decodeAddress(address))))).digest('hex');
  const pins:SignerPins={issuer:issuer.publicKey.toBase58(),program:d.config.program,genesis:d.config.networkGenesis,mint:d.config.mint,tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId.toBase58(),rentSysvar:SYSVAR_RENT_PUBKEY.toBase58(),instructionsSysvar:SYSVAR_INSTRUCTIONS_PUBKEY.toBase58(),ed25519Program:Ed25519Program.programId.toBase58(),lookupTables:[{address:lookupAddress,owner:AddressLookupTableProgram.programId.toBase58(),addresses,addressesSha256,lastExtendedSlot:'1',deactivationSlot:'18446744073709551615'}],maxBlockhashAge:150,maxFloorToleranceBps:200};
  d.authorization={signer:{publicKey:pins.issuer,signValidated:async(request)=>{counters.signer++;try{const tx=await validateSignerRequest(request,pins);return {signedTransactionBase64url:signValidatedTransaction(tx,issuer,pins.issuer)}}catch(error){counters.signerError=(error as Error).message;throw error}}},signerPins:pins,rpc:[{latestBlockhash:async()=>({genesis:pins.genesis,blockhash:'11111111111111111111111111111111',blockhashBlockHeight:'100',currentBlockHeight:'100',currentSlot:'100',lastValidBlockHeight:'150'})},{latestBlockhash:async()=>({genesis:pins.genesis,blockhash:'11111111111111111111111111111111',blockhashBlockHeight:'100',currentBlockHeight:'101',currentSlot:'101',lastValidBlockHeight:'150'})}]};
  return {d,counters,attemptId,templateHex};
}
async function reject(token:string,opts:Parameters<typeof request>[1]={}){
  const {d,counters}=deps();const response=await handleIssuerRequest(request(token,opts),d);
  expect(response.status).not.toBe(200);expect(counters.nonceRows).toBe(opts?.badMac?0:1);expect(counters.reads).toBe(0);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);return counters;
}

describe('issuer authentication boundary',()=>{
  it('rejects HS256 confusion and anon/service role style JWTs',async()=>{
    await reject(jwt(claims(),'HS256'));
    await reject(jwt(claims({role:'anon'})));
    await reject(jwt(claims({role:'service_role'})));
  });
  it('rejects expired, future-issued, wrong-kid, wrong-user, and non-allow-listed JWTs',async()=>{
    await reject(jwt(claims({exp:now-1})));
    await reject(jwt(claims({iat:now+31,exp:now+300})));
    await reject(jwt(claims(), 'ES256', 'wrong'));
    await reject(jwt(claims({sub:'44444444-4444-4444-8444-444444444444'})),{userId:'44444444-4444-4444-8444-444444444444'});
    const {d,counters}=deps();d.config.allowList=new Set();const response=await handleIssuerRequest(request(jwt(claims())),d);
    expect(response).toMatchObject({status:403});expect(counters.nonceRows).toBe(1);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
  });
  it('rejects a replayed nonce and bad HMAC before endpoint work',async()=>{
    const {d,counters}=deps(),token=jwt(claims()),req=request(token);
    await handleIssuerRequest(req,d);const replay=await handleIssuerRequest(req,d);
    expect(replay).toMatchObject({status:401});expect(counters.nonceRows).toBe(1);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
    const bad=await reject(token,{badMac:true});expect(bad.nonce).toBe(0);
  });
  it('rejects malformed HTTP and strict JSON requests before endpoint work',async()=>{
    const token=jwt(claims());
    for(const req of [
      {...request(token),secure:false}, {...request(token),method:'GET'}, {...request(token),path:'/v1/authorize-attempt?x=1'},
      {...request(token),headers:{...request(token).headers,'content-type':'application/json'}},
      {...request(token),headers:{...request(token).headers,'x-flexsoar-kid':['hmac-v1','hmac-v1']}},
      {...request(token),rawBody:Buffer.alloc(32769)},
      {...request(token),rawBody:Buffer.from([0xff])},
      request(token,{body:'{"phase":"x","phase":"y"}',nonce:Buffer.alloc(16,8).toString('base64url')}),
    ]){
      const {d,counters}=deps();const response=await handleIssuerRequest(req,d);
      expect(response.status).not.toBe(200);expect(counters.nonceRows).toBe(req.rawBody.toString().includes('"phase":"x"')?1:0);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
    }
  });
  it('rejects malformed HMAC headers, inactive kid, and timestamps outside ±60 seconds',async()=>{
    const token=jwt(claims());
    for(const [i,mutate] of [
      (r:ReturnType<typeof request>)=>({...r,headers:{...r.headers,'x-flexsoar-kid':'retired'}}),
      (r:ReturnType<typeof request>)=>({...r,headers:{...r.headers,'x-flexsoar-nonce':'AA'}}),
      (r:ReturnType<typeof request>)=>({...r,headers:{...r.headers,'x-flexsoar-user':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}}),
      (r:ReturnType<typeof request>)=>({...r,headers:{...r.headers,'x-flexsoar-timestamp':String(now+61)}}),
    ].entries()){const {d,counters}=deps(),response=await handleIssuerRequest(mutate(request(token)),d);expect(response.status,`case ${i}`).not.toBe(200);expect(counters.nonce,`case ${i}`).toBe(0);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);}
  });
  it('rejects JWT algorithm, role, issuer, audience and subject confusion',async()=>{
    await reject(jwt(claims(),'none'));
    await reject(jwt(claims({iss:'https://wrong.example'})));
    await reject(jwt(claims({aud:'wrong'})));
    await reject(jwt(claims({sub:''})));
  });
  it('rejects invalid JWT time claims',async()=>{
    const {iat:_iat,...missingIat}=claims();await reject(jwt(missingIat));
    await reject(jwt(claims({nbf:now+1})));
    await reject(jwt(claims({exp:now+3601,iat:now})));
    await reject(jwt(claims({exp:now-1,iat:now})));
  });
  it('refuses JWKS and nonce-store failures before endpoint work',async()=>{
    const j=deps();j.d.jwks={get:async()=>{throw Error('offline')}};
    const denied=await handleIssuerRequest(request(jwt(claims())),j.d);
    expect(denied.status).not.toBe(200);expect(j.counters.writes).toBe(0);expect(j.counters.signer).toBe(0);expect(j.counters.sender).toBe(0);
    const n=deps();n.d.db.consumeIssuerNonce=async()=>{throw Error('database unavailable')};
    const failed=await handleIssuerRequest(request(jwt(claims())),n.d);
    expect(failed.status).not.toBe(200);expect(n.counters.reads).toBe(0);expect(n.counters.writes).toBe(0);expect(n.counters.signer).toBe(0);expect(n.counters.sender).toBe(0);
    const uncertain=deps();uncertain.d.db.consumeIssuerNonce=async()=>{uncertain.counters.nonce++;throw Error('PAYMENT_DB_OUTCOME_UNKNOWN')};
    const unknown=await handleIssuerRequest(request(jwt(claims())),uncertain.d);
    expect(unknown).toMatchObject({status:503,body:{error:{code:'ISSUER_DB_OUTCOME_UNKNOWN',retryable:true,requestId:expect.any(String)}}});expect(uncertain.counters.reads).toBe(0);expect(uncertain.counters.writes).toBe(0);expect(uncertain.counters.signer).toBe(0);expect(uncertain.counters.sender).toBe(0);
  });
  it('rejects malformed JOSE headers, duplicate kids and invalid pinned JWKS keys',async()=>{
    const badTokens=[jwt(claims(),'ES256',jwk.kid,{crit:['b64']}),jwt(claims(),'ES256',jwk.kid,{b64:false}),jwt(claims(),'ES256',jwk.kid,{x5u:'https://invalid'}),rawJwt(`{"alg":"ES256","kid":"${jwk.kid}","kid":"${jwk.kid}"}`,JSON.stringify(claims())),rawJwt(JSON.stringify({alg:'ES256',kid:jwk.kid}),`{"iss":"https://issuer.example/auth/v1","iss":"https://issuer.example/auth/v1","aud":"authenticated","role":"authenticated","sub":"${user}","iat":${now-1},"exp":${now+300}}`)];
    for(const [index,badToken] of badTokens.entries())await reject(badToken,{nonce:Buffer.alloc(16,index+50).toString('base64url')});
    const badKeys:IssuerJwk[]=[{...jwk,kty:'OKP'},{...jwk,crv:'P-384'},{...jwk,use:'enc'},{...jwk,alg:'ES384'},{...jwk,key_ops:['sign']},{...jwk,x:'AA'},{...jwk,y:'AA'}];
    for(const [index,key] of badKeys.entries()){const {d,counters}=deps();d.jwks={get:async()=>[key]};const response=await handleIssuerRequest(request(jwt(claims()),{nonce:Buffer.alloc(16,index+60).toString('base64url')}),d);expect(response.status).not.toBe(200);expect(counters.nonceRows).toBe(1);expect(counters.reads).toBe(0);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);}
    const {d,counters}=deps();d.jwks={get:async()=>[jwk,jwk]};const response=await handleIssuerRequest(request(jwt(claims())),d);
    expect(response.status).not.toBe(200);expect(counters.nonceRows).toBe(1);expect(counters.reads).toBe(0);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
    const noKey=deps();noKey.d.jwks={get:async()=>[]};const refused=await handleIssuerRequest(request(jwt(claims())),noKey.d);
    expect(refused.status).not.toBe(200);expect(noKey.counters.nonceRows).toBe(1);expect(noKey.counters.writes).toBe(0);expect(noKey.counters.signer).toBe(0);expect(noKey.counters.sender).toBe(0);
  });
  it('enforces endpoint rate windows and returns Retry-After without business effects',async()=>{
    const {d,counters}=deps(),tokenValue=jwt(claims());let last;
    for(let i=0;i<11;i++)last=await handleIssuerRequest(request(tokenValue,{path:'/v1/authorize-attempt',nonce:Buffer.alloc(16,80+i).toString('base64url')}),d);
    expect(last).toMatchObject({status:429,headers:{'Retry-After':'60'},body:{error:{code:'ISSUER_RATE_LIMITED',retryable:true}}});
    expect(counters.nonceRows).toBe(11);expect(counters.reads).toBe(0);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
  });
  it('refuses authorize attempts below the listing floor, after listing expiry, for the wrong buyer, without an enrolled wallet and after epoch rotation before signer or sender work',async()=>{
    const vectors:[Parameters<typeof authorizeFixture>[0],string][]=[
      [{belowFloor:true},'ISSUER_PERMIT_INVALID'],[{expiredListing:true},'ISSUER_ATTEMPT_EXPIRED'],[{wrongBuyer:true},'ISSUER_ATTEMPT_NOT_OWNED'],
      [{wrongListingSale:true},'ISSUER_SALE_STALE'],[{wrongListingSeller:true},'ISSUER_SALE_STALE'],[{wrongGeneration:true},'ISSUER_LISTING_BINDING_INVALID'],[{wrongBinding:true},'ISSUER_LISTING_BINDING_INVALID'],
      [{dbError:'PAYMENT_V2_BUYER_WALLET_REQUIRED'},'ISSUER_ATTEMPT_UNAVAILABLE'],[{dbError:'PAYMENT_V2_AUTHORITY_ROTATED'},'ISSUER_AUTHORITY_ROTATED'],
    ];
    for(const [index,[options,code]] of vectors.entries()){
      const fixture=await authorizeFixture(options),response=await handleIssuerRequest(request(jwt(claims()),{body:JSON.stringify({attemptId:fixture.attemptId}),nonce:Buffer.alloc(16,index+100).toString('base64url')}),fixture.d);
      expect(response).toMatchObject({status:expect.any(Number),body:{error:{code}}});expect(fixture.counters.nonceRows).toBe(1);expect(fixture.counters.signer).toBe(0);expect(fixture.counters.sender).toBe(0);
    }
  });
  it('builds and issuer-co-signs the buy transaction from the DB permit and pinned lookup table',async()=>{
    const fixture=await authorizeFixture(),response=await handleIssuerRequest(request(jwt(claims()),{body:JSON.stringify({attemptId:fixture.attemptId})}),fixture.d);
    expect(response.status,JSON.stringify(response.body)+` signer=${fixture.counters.signerError}`).toBe(200);expect(response.body).toMatchObject({attemptId:fixture.attemptId,signer:'issuer-partial',recentBlockhash:'11111111111111111111111111111111'});
    const tx=(await import('@solana/web3.js')).VersionedTransaction.deserialize(Buffer.from(String(response.body.transactionBase64url),'base64url'));
    expect(tx.signatures[0]!.some(byte=>byte!==0)).toBe(true);expect(tx.signatures[1]!.every(byte=>byte===0)).toBe(true);expect(fixture.counters.signer).toBe(1);expect(fixture.counters.sender).toBe(0);expect(fixture.counters.writes).toBe(1);
  });
  it('refuses extra client transaction or ALT fields before issuer reads',async()=>{
    const {d,counters}=deps(),response=await handleIssuerRequest(request(jwt(claims()),{body:JSON.stringify({attemptId:'55555555-5555-4555-8555-555555555555',transactionBase64url:'forbidden',alt:'forbidden'})}),d);
    expect(response).toMatchObject({status:400,body:{error:{code:'ISSUER_BAD_REQUEST'}}});expect(counters.nonceRows).toBe(1);expect(counters.reads).toBe(0);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
  });
  it('keeps only the background open-sale HTTP path refused before database or signer work',async()=>{
    const {d,counters}=deps(),response=await handleIssuerRequest(request(jwt(claims()),{path:'/internal/open-sale-submit'}),d);
    expect(response).toMatchObject({status:409,body:{error:{code:'ISSUER_BARE_OPEN_REFUSED'}}});expect(counters.nonceRows).toBe(1);expect(counters.reads).toBe(0);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
  });
});

describe('issuer FX arithmetic',()=>{
  const quote=(providerId:string,numerator:string,observedAt=new Date(now*1000).toISOString(),denominator='1')=>({providerId,quoteId:`q-${providerId}`,numerator,denominator,observedAt});
  it('accepts the 50 bps boundary and rejects disagreement beyond it',()=>{
    expect(()=>calculateFx([quote('a','199'),quote('b','201')],'1',now)).not.toThrow();
    expect(()=>calculateFx([quote('a','199'),quote('b','202')],'1',now)).toThrow('ISSUER_FX_DISAGREEMENT');
  });
  it('rounds upward and rejects stale and overflowing values',()=>{
    expect(calculateFx([quote('a','5',undefined,'2'),quote('b','5',undefined,'2')],'3',now).total).toBe(BigInt('8'));
    expect(calculateFx([quote('a','5',undefined,'2'),quote('b','5',undefined,'2')],'4',now).total).toBe(BigInt('10'));
    expect(()=>calculateFx([quote('a','1',new Date((now-3601)*1000).toISOString()),quote('b','1')],'1',now)).toThrow('ISSUER_FX_STALE');
    expect(()=>calculateFx([quote('a','18446744073709551615'),quote('b','18446744073709551615')],'18446744073709551615',now)).toThrow('ISSUER_FX_OVERFLOW');
  });
  it('accepts exact FX age limits and rejects invalid provider identity, rates and timestamps',()=>{
    expect(()=>calculateFx([quote('a','1',new Date((now-3600)*1000).toISOString()),quote('b','1',new Date((now+30)*1000).toISOString())],'1',now)).not.toThrow();
    expect(()=>calculateFx([quote('a','1'),quote('a','1')],'1',now)).toThrow('ISSUER_FX_INVALID');
    expect(()=>calculateFx([quote('a','0'),quote('b','1')],'1',now)).toThrow('ISSUER_FX_INVALID');
    expect(()=>calculateFx([quote('a','01'),quote('b','1')],'1',now)).toThrow('ISSUER_FX_INVALID');
    expect(()=>calculateFx([quote('a','1',new Date(now*1000).toISOString().replace('Z','+00:00')),quote('b','1')],'1',now)).toThrow('ISSUER_FX_INVALID');
    expect(()=>calculateFx([quote('a','1',new Date((now-3601)*1000).toISOString()),quote('b','1')],'1',now)).toThrow('ISSUER_FX_STALE');
    expect(()=>calculateFx([quote('a','1',new Date((now+31)*1000).toISOString()),quote('b','1')],'1',now)).toThrow('ISSUER_FX_STALE');
  });
  it('checks every unsigned 256-bit intermediate before multiplication or addition',()=>{
    const max=((BigInt('1')<<BigInt('256'))-BigInt('1')).toString();
    const vector=(id:string,n:string,d='1')=>quote(id,n,new Date(now*1000).toISOString(),d);
    expect(()=>calculateFx([vector('a',max),vector('b','1','2')],'1',now)).toThrow('ISSUER_FX_OVERFLOW'); // A cross product
    expect(()=>calculateFx([vector('a','1','2'),vector('b',max)],'1',now)).toThrow('ISSUER_FX_OVERFLOW'); // B cross product
    expect(()=>calculateFx([vector('a',(BigInt(max)/BigInt('2')).toString()),vector('b','1')],'1',now)).toThrow('ISSUER_FX_OVERFLOW'); // tolerance product
    expect(()=>calculateFx([vector('a',(BigInt(max)/BigInt('2')+BigInt('1')).toString(),(BigInt(max)/BigInt('2')+BigInt('1')).toString()),vector('b','1')],'1',now)).toThrow('ISSUER_FX_OVERFLOW'); // denominator product
    expect(()=>calculateFx([vector('a',(BigInt(max)/BigInt('2')).toString()),vector('b',(BigInt(max)/BigInt('2')).toString())],'2',now)).toThrow('ISSUER_FX_OVERFLOW'); // amount product
  });
});

describe('issuer endpoint refusal boundaries',()=>{
  const listingId='22222222-2222-4222-8222-222222222222';
  const listingContext={found:true,ownerId:user,ownerAuthId:user,networkId:'33333333-3333-4333-8333-333333333333',genesis:'11111111111111111111111111111111',program:'11111111111111111111111111111111',config:'11111111111111111111111111111111',mint:'11111111111111111111111111111111',tokenProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',listingStatus:'public',cardStatus:'active',priceCents:'3',inventoryRegistered:true,saleFenced:false,fundingEnabled:true};
  const quote=(providerId:string,numerator:string,denominator='1',observedAt=new Date(now*1000).toISOString())=>({providerId,quoteId:`q-${providerId}`,numerator,denominator,observedAt});
  it('refuses malformed prepare schemas and identifiers without business effects',async()=>{
    for(const body of ['{}',JSON.stringify({listingId:'UPPER',requestId:'not-a-uuid'}),JSON.stringify({listingId,requestId:'44444444-4444-4444-8444-444444444444',extra:true})]){
      const {d,counters}=deps();const response=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/prepare-sale',nonce:Buffer.alloc(16,body.length%251).toString('base64url'),body}),d);
      expect(response.status).not.toBe(200);expect(counters.nonceRows).toBe(1);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
    }
  });
  async function prepareRefusal(q1:ReturnType<typeof quote>,q2:ReturnType<typeof quote>,ctx:IssuerContext=listingContext,allowed=true){
    const {d,counters}=deps();d.db.subjectContext=async(kind):Promise<IssuerContext>=>{counters.reads++;return kind==='prepare_recovery'?{found:false}:ctx};
    if(!allowed)d.config.allowList=new Set();
    d.fx=[{quote:async()=>q1},{quote:async()=>q2}];
    const response=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/prepare-sale',nonce:Buffer.alloc(16,2).toString('base64url'),body:JSON.stringify({listingId,requestId:'44444444-4444-4444-8444-444444444444'})}),d);
    expect(response.status).not.toBe(200);expect(counters.nonceRows).toBe(1);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);return response;
  }
  it('refuses FX disagreement, staleness, overflow, and a foreign listing before writes',async()=>{
    expect((await prepareRefusal(quote('a','199'),quote('b','202'))).body.error).toMatchObject({code:'ISSUER_FX_DISAGREEMENT'});
    expect((await prepareRefusal(quote('a','1','1',new Date((now-3601)*1000).toISOString()),quote('b','1'))).body.error).toMatchObject({code:'ISSUER_FX_STALE'});
    expect((await prepareRefusal(quote('a','18446744073709551615'),quote('b','18446744073709551615'),{...listingContext,priceCents:'18446744073709551615'})).body.error).toMatchObject({code:'ISSUER_FX_OVERFLOW'});
    expect((await prepareRefusal(quote('a','1'),quote('b','1'),{...listingContext,ownerId:'55555555-5555-4555-8555-555555555555'})).body.error).toMatchObject({code:'ISSUER_LISTING_NOT_OWNED'});
  });
  it('refuses each prepare ownership, network, listing, inventory, fence and funding validation before writes',async()=>{
    const valid=[quote('a','1'),quote('b','1')];
    const cases:Array<[IssuerContext,string]>= [
      [{...listingContext,found:false},'ISSUER_LISTING_NOT_FOUND'],
      [{...listingContext,ownerAuthId:'55555555-5555-4555-8555-555555555555'},'ISSUER_LISTING_NOT_OWNED'],
      [{...listingContext,networkId:'55555555-5555-4555-8555-555555555555'},'ISSUER_NETWORK_MISMATCH'],
      [{...listingContext,genesis:'22222222222222222222222222222222'},'ISSUER_NETWORK_MISMATCH'],
      [{...listingContext,program:'22222222222222222222222222222222'},'ISSUER_NETWORK_MISMATCH'],
      [{...listingContext,config:'22222222222222222222222222222222'},'ISSUER_NETWORK_MISMATCH'],
      [{...listingContext,mint:'22222222222222222222222222222222'},'ISSUER_NETWORK_MISMATCH'],
      [{...listingContext,tokenProgram:'11111111111111111111111111111111'},'ISSUER_NETWORK_MISMATCH'],
      [{...listingContext,listingStatus:'private'},'ISSUER_LISTING_UNAVAILABLE'],
      [{...listingContext,cardStatus:'quarantined'},'ISSUER_LISTING_UNAVAILABLE'],
      [{...listingContext,inventoryRegistered:false},'ISSUER_LISTING_UNAVAILABLE'],
      [{...listingContext,saleFenced:true},'ISSUER_LISTING_UNAVAILABLE'],
      [{...listingContext,fundingEnabled:false},'ISSUER_FUNDING_DISABLED'],
    ];
    for(const [ctx,code] of cases)expect((await prepareRefusal(valid[0]!,valid[1]!,ctx)).body.error).toMatchObject({code});
    expect((await prepareRefusal(valid[0]!,valid[1]!,listingContext,false)).body.error).toMatchObject({code:'ISSUER_USER_NOT_ALLOWED'});
  });
  it('refuses malformed, duplicate-provider and unavailable FX quote vectors before prepare writes',async()=>{
    expect((await prepareRefusal(quote('a','0'),quote('b','1'))).body.error).toMatchObject({code:'ISSUER_FX_INVALID'});
    expect((await prepareRefusal(quote('a','1'),quote('a','1'))).body.error).toMatchObject({code:'ISSUER_FX_INVALID'});
    expect((await prepareRefusal(quote('a','1','1','bad-date'),quote('b','1'))).body.error).toMatchObject({code:'ISSUER_FX_INVALID'});
    const {d,counters}=deps();d.db.subjectContext=async(kind):Promise<IssuerContext>=>kind==='prepare_recovery'?{found:false}:listingContext;d.fx=[{quote:async()=>{throw Error('offline')}},{quote:async()=>quote('b','1')}];
    const response=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/prepare-sale',nonce:Buffer.alloc(16,72).toString('base64url'),body:JSON.stringify({listingId,requestId:'44444444-4444-4444-8444-444444444444'})}),d);
    expect(response.body.error).toMatchObject({code:'ISSUER_FX_UNAVAILABLE'});expect(counters.nonceRows).toBe(1);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
  });
  it('recovers the immutable FX snapshot without provider reads and refuses changed identity or expired quote',async()=>{
    const saleId='88888888-8888-4888-8888-888888888888',requestId='44444444-4444-4444-8444-444444444444',snapshot={schemaVersion:1,sources:[{providerId:'persisted'}]},base={found:true,ownerId:user,ownerAuthId:user,listingId,saleId,quoteTotalUnits:'10',quoteValidFrom:String(now-10),quoteExpiresAt:String(now+300),fxSnapshot:snapshot,state:'opening',preparedAt:new Date((now-10)*1000).toISOString(),toleranceBps:200,genesis:'11111111111111111111111111111111',program:'11111111111111111111111111111111',cardCommitment:'11111111111111111111111111111111',saleCommitment:'11111111111111111111111111111111',generation:'1',cardId:'77777777-7777-4777-8777-777777777777'};
    const {d,counters}=deps();d.db.subjectContext=async(kind):Promise<IssuerContext>=>kind==='prepare_recovery'?base:kind==='sale'?base:{found:true};d.db.saleSigningContext=async()=>({...base,sellerWallet:'11111111111111111111111111111111',totalUnits:'10',validFrom:String(now-10),expiresAt:String(now+300)});
    d.fx=[{quote:async()=>{throw Error('must not refresh')}},{quote:async()=>{throw Error('must not refresh')}}];
    const run=async(id=listingId)=>handleIssuerRequest(request(jwt(claims()),{path:'/v1/prepare-sale',nonce:Buffer.alloc(16,id===listingId?73:74).toString('base64url'),body:JSON.stringify({listingId:id,requestId})}),d);
    const recovered=await run();expect(recovered.status,JSON.stringify(recovered.body)).toBe(200);expect((recovered.body.quote as Record<string,unknown>).fxSnapshot).toEqual(snapshot);expect(recovered.body.saleId).toBe(saleId);
    const conflict=await run('55555555-5555-4555-8555-555555555555');expect(conflict.body.error).toMatchObject({code:'ISSUER_SALE_IDEMPOTENCY_CONFLICT'});
    d.db.subjectContext=async(kind):Promise<IssuerContext>=>kind==='prepare_recovery'?{...base,quoteExpiresAt:String(now-1)}:base;
    const expired=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/prepare-sale',nonce:Buffer.alloc(16,75).toString('base64url'),body:JSON.stringify({listingId,requestId})}),d);
    expect(expired.body.error).toMatchObject({code:'ISSUER_QUOTE_EXPIRED'});expect(counters.nonceRows).toBe(3);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
  });
  it('refuses enrollment proof replay across network, user, wallet, and mint',async()=>{
    const keys=generateKeyPairSync('ed25519'),pubJwk=keys.publicKey.export({format:'jwk'}),walletBytes=Buffer.from(pubJwk.x!,'base64url'),wallet=base58Encode(walletBytes),mint='11111111111111111111111111111111',genesis='11111111111111111111111111111111',ata=associatedTokenAddress(wallet,mint),issuedAt=String(now);
    const networkContext={found:true,networkId:'33333333-3333-4333-8333-333333333333',genesis,mint,tokenProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',associatedTokenProgram:'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'};
    const message=`FlexSoar wallet enrollment v1\nnetwork:${genesis}\nuser:${user}\nwallet:${wallet}\nmint:${mint}\ntoken-account:${ata}\nissued-at:${issuedAt}`;
    const signature=cryptoSign(null,Buffer.from(message),keys.privateKey).toString('base64url');
    const base={phase:'complete',networkGenesis:genesis,wallet,mint,tokenAccount:ata,issuedAt,signature};
    const cases=[
      {body:{...base,networkGenesis:'22222222222222222222222222222222'},token:jwt(claims()),expected:'ISSUER_NETWORK_MISMATCH',userId:user},
      {body:base,token:jwt(claims({sub:'55555555-5555-4555-8555-555555555555'})),expected:'ISSUER_PROOF_INVALID',userId:'55555555-5555-4555-8555-555555555555'},
      {body:{...base,wallet:base58Encode(new Uint8Array(32).fill(7)),tokenAccount:associatedTokenAddress(base58Encode(new Uint8Array(32).fill(7)),mint)},token:jwt(claims()),expected:'ISSUER_PROOF_INVALID',userId:user},
      {body:{...base,mint:base58Encode(new Uint8Array(32).fill(8))},token:jwt(claims()),expected:'ISSUER_ATA_MISMATCH',userId:user},
    ];
    for(const [i,c] of cases.entries()){
      const {d,counters}=deps();d.config.allowList=new Set([user,'55555555-5555-4555-8555-555555555555']);d.db.subjectContext=async()=>{counters.reads++;return networkContext};
      const response=await handleIssuerRequest(request(c.token,{path:'/v1/enroll-wallet',userId:c.userId,nonce:Buffer.alloc(16,i+3).toString('base64url'),body:JSON.stringify(c.body)}),d);
      expect(response.body.error).toMatchObject({code:c.expected});expect(counters.nonceRows).toBe(1);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
    }
  });
  it('returns a read-only canonical challenge and checks both genesis providers',async()=>{
    const walletKeys=generateKeyPairSync('ed25519'),publicJwk=walletKeys.publicKey.export({format:'jwk'}),wallet=base58Encode(Buffer.from(publicJwk.x!,'base64url'));
    const networkContext={found:true,networkId:'33333333-3333-4333-8333-333333333333',genesis:'11111111111111111111111111111111',mint:'11111111111111111111111111111111',tokenProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',associatedTokenProgram:'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'};
    const {d,counters}=deps();let accounts=0;d.db.subjectContext=async()=>networkContext;d.rpc=[{genesis:async()=>networkContext.genesis,finalizedSlot:async()=>BigInt('10'),account:async()=>{accounts++;return null}},{genesis:async()=>networkContext.genesis,finalizedSlot:async()=>BigInt('10'),account:async()=>{accounts++;return null}}];
    const response=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/enroll-wallet',nonce:Buffer.alloc(16,101).toString('base64url'),body:JSON.stringify({phase:'challenge',networkGenesis:networkContext.genesis,wallet})}),d);
    expect(response.status).toBe(200);expect(response.body).toMatchObject({networkGenesis:networkContext.genesis,wallet,mint:networkContext.mint,tokenAccount:associatedTokenAddress(wallet,networkContext.mint),issuedAt:String(now)});
    expect(response.body.message).toBe(`FlexSoar wallet enrollment v1\nnetwork:${networkContext.genesis}\nuser:${user}\nwallet:${wallet}\nmint:${networkContext.mint}\ntoken-account:${associatedTokenAddress(wallet,networkContext.mint)}\nissued-at:${now}`);
    expect(accounts).toBe(0);expect(counters.nonceRows).toBe(1);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
  });
  it('refuses enrollment proof age, encoding, network, RPC, finalized-slot and account vectors before wallet writes',async()=>{
    const keyPair=generateKeyPairSync('ed25519'),publicJwk=keyPair.publicKey.export({format:'jwk'}),walletBytes=Buffer.from(publicJwk.x!,'base64url'),wallet=base58Encode(walletBytes),mint='11111111111111111111111111111111',genesis='11111111111111111111111111111111',ata=associatedTokenAddress(wallet,mint),networkId='33333333-3333-4333-8333-333333333333';
    const networkContext={found:true,networkId,genesis,mint,tokenProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',associatedTokenProgram:'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'};
    const tokenMint=new Uint8Array(82);tokenMint[44]=6;tokenMint[45]=1;const tokenAccount=new Uint8Array(165);tokenAccount.set(decodeAddress(mint),0);tokenAccount.set(walletBytes,32);tokenAccount[108]=1;
    const issuedAt=String(now),message=`FlexSoar wallet enrollment v1\nnetwork:${genesis}\nuser:${user}\nwallet:${wallet}\nmint:${mint}\ntoken-account:${ata}\nissued-at:${issuedAt}`,signature=cryptoSign(null,Buffer.from(message),keyPair.privateKey).toString('base64url');
    const base={phase:'complete',networkGenesis:genesis,wallet,mint,tokenAccount:ata,issuedAt,signature};
    const makeAccount=(address:string)=>({owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',data:address===mint?tokenMint:tokenAccount,contextSlot:BigInt('100')});
    const cases:Array<{code:string;body?:Record<string,unknown>;network?:IssuerContext;rpc?:string}>=[];
    cases.push({code:'ISSUER_PROOF_EXPIRED',body:{...base,issuedAt:String(now-301)}});
    cases.push({code:'ISSUER_PROOF_EXPIRED',body:{...base,issuedAt:String(now+31)}});
    cases.push({code:'ISSUER_PROOF_MALFORMED',body:{...base,signature:'not_base64url!'}});
    cases.push({code:'ISSUER_PROOF_INVALID',body:{...base,signature:Buffer.alloc(64).toString('base64url')}});
    cases.push({code:'ISSUER_ATA_MISMATCH',body:{...base,mint:base58Encode(new Uint8Array(32).fill(9))}});
    cases.push({code:'ISSUER_ATA_MISMATCH',body:{...base,tokenAccount:base58Encode(new Uint8Array(32).fill(8))}});
    cases.push({code:'ISSUER_NETWORK_MISMATCH',network:{...networkContext,mint:base58Encode(new Uint8Array(32).fill(5))}});
    cases.push({code:'ISSUER_RPC_UNAVAILABLE',rpc:'unavailable'});
    cases.push({code:'ISSUER_RPC_DISAGREEMENT',rpc:'genesis'});
    cases.push({code:'ISSUER_RPC_DISAGREEMENT',rpc:'slots'});
    cases.push({code:'ISSUER_RPC_DISAGREEMENT',rpc:'old-slot'});
    cases.push({code:'ISSUER_RPC_DISAGREEMENT',rpc:'future-slot'});
    cases.push({code:'ISSUER_RPC_DISAGREEMENT',rpc:'missing'});
    cases.push({code:'ISSUER_RPC_DISAGREEMENT',rpc:'split'});
    cases.push({code:'ISSUER_MINT_INVALID',rpc:'mint-owner'});
    cases.push({code:'ISSUER_MINT_INVALID',rpc:'mint-layout'});
    cases.push({code:'ISSUER_MINT_INVALID',rpc:'mint-decimals'});
    cases.push({code:'ISSUER_MINT_INVALID',rpc:'mint-uninitialized'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-owner'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-layout'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-mint'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-authority'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-frozen'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-active-delegate'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-delegate-some'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-delegate-set-zero-amount'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-delegated-amount-without-delegate'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-close-authority'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-native-some'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-invalid-delegate-option'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-invalid-native-option'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-invalid-close-option'});
    cases.push({code:'ISSUER_TOKEN_ACCOUNT_INVALID',rpc:'ata-uninitialized'});
    for(const [index,c] of cases.entries()){
      const {d,counters}=deps();d.db.subjectContext=async()=>c.network??networkContext;
      const rpcMode=c.rpc;
      const provider=(slot:number)=>({genesis:async()=>{if(rpcMode==='unavailable')throw Error('local fake outage');return rpcMode==='genesis'&&slot===1?'wrong':genesis;},finalizedSlot:async()=>BigInt(rpcMode==='slots'&&slot===1?'133':'100'),account:async(address:string)=>{
        if(rpcMode==='missing'&&slot===1&&address===ata)return null;
        const baseAccount=makeAccount(address);let result={...baseAccount,contextSlot:BigInt(rpcMode==='old-slot'&&slot===1?'99':rpcMode==='future-slot'&&slot===1?'133':'100')};
        if(rpcMode==='split'&&slot===1&&address===ata)result={...result,data:new Uint8Array(165)};
        if(rpcMode==='mint-owner'&&address===mint)result={...result,owner:'11111111111111111111111111111111'};
        if(rpcMode==='mint-layout'&&address===mint)result={...result,data:new Uint8Array(81)};
        if(rpcMode==='mint-decimals'&&address===mint){const data=new Uint8Array(82);data[44]=7;data[45]=1;result={...result,data};}
        if(rpcMode==='mint-uninitialized'&&address===mint)result={...result,data:new Uint8Array(82)};
        if(rpcMode==='ata-owner'&&address===ata)result={...result,owner:'11111111111111111111111111111111'};
        if(rpcMode==='ata-layout'&&address===ata)result={...result,data:new Uint8Array(164)};
        if(rpcMode==='ata-mint'&&address===ata){const data=new Uint8Array(165);data.set(new Uint8Array(32).fill(2),0);data.set(walletBytes,32);data[108]=1;result={...result,data};}
        if(rpcMode==='ata-authority'&&address===ata){const data=new Uint8Array(165);data.set(decodeAddress(mint),0);data.set(new Uint8Array(32).fill(2),32);data[108]=1;result={...result,data};}
        if(rpcMode==='ata-frozen'&&address===ata){const data=tokenAccount.slice();data[108]=2;result={...result,data};}
        if(rpcMode==='ata-active-delegate'&&address===ata){const data=tokenAccount.slice();data[72]=1;data[76]=9;data[108]=1;data[121]=1;result={...result,data};}
        if(rpcMode==='ata-delegate-some'&&address===ata){const data=tokenAccount.slice();data[72]=1;data[76]=9;data[108]=1;result={...result,data};}
        if(rpcMode==='ata-delegate-set-zero-amount'&&address===ata){const data=tokenAccount.slice();data[72]=1;data[76]=9;data[108]=1;result={...result,data};}
        if(rpcMode==='ata-delegated-amount-without-delegate'&&address===ata){const data=tokenAccount.slice();data[108]=1;data[121]=1;result={...result,data};}
        if(rpcMode==='ata-close-authority'&&address===ata){const data=tokenAccount.slice();data[108]=1;data[129]=1;data[133]=9;result={...result,data};}
        if(rpcMode==='ata-native-some'&&address===ata){const data=tokenAccount.slice();data[108]=1;data[109]=1;data[113]=9;result={...result,data};}
        if(rpcMode==='ata-invalid-delegate-option'&&address===ata){const data=tokenAccount.slice();data[72]=2;data[108]=1;result={...result,data};}
        if(rpcMode==='ata-invalid-native-option'&&address===ata){const data=tokenAccount.slice();data[108]=1;data[109]=2;result={...result,data};}
        if(rpcMode==='ata-invalid-close-option'&&address===ata){const data=tokenAccount.slice();data[108]=1;data[129]=2;result={...result,data};}
        if(rpcMode==='ata-uninitialized'&&address===ata){const data=tokenAccount.slice();data[108]=0;result={...result,data};}
        return result;
      }});
      d.rpc=[provider(0),provider(1)];
      const body=c.body??base,response=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/enroll-wallet',nonce:Buffer.alloc(16,index+110).toString('base64url'),body:JSON.stringify(body)}),d);
      expect(response.body.error,`case ${index}`).toMatchObject({code:c.code});expect(counters.nonceRows).toBe(1);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
    }
  });
  it('enrolls only after matching finalized RPC snapshots from both providers',async()=>{
    const keys=generateKeyPairSync('ed25519'),pubJwk=keys.publicKey.export({format:'jwk'}),walletBytes=Buffer.from(pubJwk.x!,'base64url'),wallet=base58Encode(walletBytes),mint='11111111111111111111111111111111',genesis='11111111111111111111111111111111',decodedMint=decodeAddress(mint),ata=associatedTokenAddress(wallet,mint),issuedAt=String(now);
    const networkContext={found:true,networkId:'33333333-3333-4333-8333-333333333333',genesis,mint,tokenProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',associatedTokenProgram:'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'};
    const tokenMint=new Uint8Array(82);tokenMint[44]=6;tokenMint[45]=1;
    const tokenAccount=new Uint8Array(165);tokenAccount.set(decodedMint,0);tokenAccount.set(walletBytes,32);tokenAccount[108]=1;
    const message=`FlexSoar wallet enrollment v1\nnetwork:${genesis}\nuser:${user}\nwallet:${wallet}\nmint:${mint}\ntoken-account:${ata}\nissued-at:${issuedAt}`;
    const signature=cryptoSign(null,Buffer.from(message),keys.privateKey).toString('base64url');
    const body=JSON.stringify({phase:'complete',networkGenesis:genesis,wallet,mint,tokenAccount:ata,issuedAt,signature});
    const account=(address:string)=>({owner:d.config.tokenProgram,data:address===mint?tokenMint:tokenAccount,contextSlot:BigInt('100')});
    const {d,counters}=deps();d.db.subjectContext=async()=>networkContext;
    d.rpc=[{genesis:async()=>genesis,finalizedSlot:async()=>BigInt('100'),account:async(address)=>account(address)},{genesis:async()=>genesis,finalizedSlot:async()=>BigInt('100'),account:async(address)=>account(address)}];
    const response=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/enroll-wallet',nonce:Buffer.alloc(16,9).toString('base64url'),body}),d);
    expect(response.status,JSON.stringify(response.body)).toBe(200);expect(response.body).toMatchObject({enrolled:true});expect(counters.writes).toBe(1);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
    const mismatch=deps();mismatch.d.db.subjectContext=async()=>networkContext;mismatch.d.rpc=[d.rpc[0],{genesis:async()=>genesis,finalizedSlot:async()=>BigInt('100'),account:async(address)=>{const acct=account(address);return address===ata?{...acct,data:new Uint8Array(165)}:acct}}];
    const refused=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/enroll-wallet',nonce:Buffer.alloc(16,10).toString('base64url'),body}),mismatch.d);
    expect(refused.body.error).toMatchObject({code:'ISSUER_RPC_DISAGREEMENT'});expect(mismatch.counters.writes).toBe(0);expect(mismatch.counters.signer).toBe(0);expect(mismatch.counters.sender).toBe(0);
  });
  it('refuses stale and incorrectly signed listing records before the 083 writer',async()=>{
    const saleId='66666666-6666-4666-8666-666666666666';const owner={ownerId:user,ownerAuthId:user};
    const signing={found:true,...owner,saleId,listingId,cardId:'77777777-7777-4777-8777-777777777777',state:'opening',genesis:'11111111111111111111111111111111',program:'11111111111111111111111111111111',cardCommitment:'11111111111111111111111111111111',saleCommitment:'11111111111111111111111111111111',generation:'1',sellerWallet:'11111111111111111111111111111111',quoteTotalUnits:'10',quoteExpiresAt:String(now+10),preparedAt:new Date((now-10)*1000).toISOString(),toleranceBps:200};
    const bytes=await encodeListing({domain:decodeAddress(String(signing.genesis)),program:decodeAddress(String(signing.program)),card:decodeAddress(String(signing.cardCommitment)),saleId:decodeAddress(String(signing.saleCommitment)),generation:BigInt('1'),minTotal:BigInt('10'),expiresAt:BigInt(now+60)});
    const body={saleId,messageBase64url:Buffer.from(bytes).toString('base64url'),signatureBase64url:Buffer.alloc(64).toString('base64url')};
    const run=async(state:string,ownerId=user)=>{const {d,counters}=deps();d.db.subjectContext=async()=>({found:true,ownerId,ownerAuthId:ownerId,state,quoteTotalUnits:'10',quoteExpiresAt:String(now+10)});d.db.saleSigningContext=async()=>({...signing,ownerId,ownerAuthId:ownerId,state});
      const response=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/record-listing',nonce:Buffer.alloc(16,state==='opening'?11:12).toString('base64url'),body:JSON.stringify(body)}),d);
      expect(response.status).not.toBe(200);expect(counters.nonceRows).toBe(1);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);return response;};
    expect((await run('closed')).body.error).toMatchObject({code:'ISSUER_SALE_NOT_OPENING'});
    expect((await run('opening','55555555-5555-4555-8555-555555555555')).body.error).toMatchObject({code:'ISSUER_SALE_NOT_OWNED'});
    expect((await run('opening')).body.error).toMatchObject({code:'ISSUER_LISTING_SIGNATURE_INVALID'});
  });
  it('covers record-listing binding, floor, expiry, state, ownership and stale DB race refusals',async()=>{
    const saleId='88888888-8888-4888-8888-888888888888',keys=generateKeyPairSync('ed25519'),pub=keys.publicKey.export({format:'jwk'}),sellerWallet=base58Encode(Buffer.from(pub.x!,'base64url'));
    const fields={domain:new Uint8Array(32).fill(1),program:new Uint8Array(32).fill(2),card:new Uint8Array(32).fill(3),saleId:new Uint8Array(32).fill(4),generation:BigInt('2')};
    const signing={found:true,saleId,listingId,cardId:'77777777-7777-4777-8777-777777777777',state:'opening',genesis:base58Encode(fields.domain),program:base58Encode(fields.program),cardCommitment:base58Encode(fields.card),saleCommitment:base58Encode(fields.saleId),generation:'2',sellerWallet,quoteTotalUnits:'10',quoteExpiresAt:String(now+10),preparedAt:new Date((now-10)*1000).toISOString(),toleranceBps:200};
    const validMessage=await encodeListing(listingForSale(fields,BigInt('10'),BigInt(now+60),BigInt('200'))),validSignature=cryptoSign(null,Buffer.from(validMessage),keys.privateKey);
    const baseBody={saleId,messageBase64url:Buffer.from(validMessage).toString('base64url'),signatureBase64url:validSignature.toString('base64url')};
    const run=async(options:{ctx?:IssuerContext;signing?:IssuerContext;body?:Record<string,unknown>;writerError?:string}={})=>{
      const {d,counters}=deps(),ctx=options.ctx??{found:true,ownerId:user,ownerAuthId:user,state:'opening',quoteTotalUnits:'10',quoteExpiresAt:String(now+10),toleranceBps:200,preparedAt:signing.preparedAt};
      d.db.subjectContext=async()=>ctx;d.db.saleSigningContext=async()=>options.signing??signing;
      if(options.writerError)d.db.recordListing=async()=>{throw Error(options.writerError)};
      const response=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/record-listing',nonce:Buffer.alloc(16,100+Math.floor(Math.random()*100)).toString('base64url'),body:JSON.stringify(options.body??baseBody)}),d);
      expect(counters.nonceRows).toBe(1);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);return response;
    };
    expect((await run({ctx:{found:false}})).body.error).toMatchObject({code:'ISSUER_SALE_NOT_FOUND'});
    expect((await run({ctx:{found:true,ownerId:'55555555-5555-4555-8555-555555555555',ownerAuthId:'55555555-5555-4555-8555-555555555555',state:'opening'}})).body.error).toMatchObject({code:'ISSUER_SALE_NOT_OWNED'});
    expect((await run({ctx:{found:true,ownerId:user,ownerAuthId:user,state:'closed',quoteTotalUnits:'10',quoteExpiresAt:String(now+10)},signing:{...signing,state:'closed'}})).body.error).toMatchObject({code:'ISSUER_SALE_NOT_OPENING'});
    expect((await run({signing:{...signing,state:'closed'}})).body.error).toMatchObject({code:'ISSUER_LISTING_STALE'});
    expect((await run({signing:{...signing,quoteTotalUnits:'11'}})).body.error).toMatchObject({code:'ISSUER_LISTING_STALE'});
    const wrongBinding=validMessage.slice();wrongBinding[20]^=1;const wrongBindingSig=cryptoSign(null,Buffer.from(wrongBinding),keys.privateKey).toString('base64url');
    expect((await run({body:{...baseBody,messageBase64url:Buffer.from(wrongBinding).toString('base64url'),signatureBase64url:wrongBindingSig}})).body.error).toMatchObject({code:'ISSUER_LISTING_BINDING_INVALID'});
    expect((await run({body:{...baseBody,signatureBase64url:Buffer.alloc(64).toString('base64url')}})).body.error).toMatchObject({code:'ISSUER_LISTING_SIGNATURE_INVALID'});
    const vector=(minTotal:bigint,expiresAt=BigInt(now+60))=>encodeListing({...fields,minTotal,expiresAt});
    for(const min of [BigInt('9'),BigInt('11')]){const msg=await vector(min),sig=cryptoSign(null,Buffer.from(msg),keys.privateKey);expect((await run({body:{...baseBody,messageBase64url:Buffer.from(msg).toString('base64url'),signatureBase64url:sig.toString('base64url')}})).body.error).toMatchObject({code:'ISSUER_LISTING_FLOOR_OUT_OF_TOLERANCE'});}
    for(const expires of [BigInt(now-1),BigInt(now+5),BigInt(now+86400)]){const msg=await vector(BigInt('10'),expires),sig=cryptoSign(null,Buffer.from(msg),keys.privateKey);expect((await run({body:{...baseBody,messageBase64url:Buffer.from(msg).toString('base64url'),signatureBase64url:sig.toString('base64url')}})).body.error).toMatchObject({code:'ISSUER_LISTING_EXPIRED'});}
    expect((await run({signing:{...signing,preparedAt:'invalid'}})).body.error).toMatchObject({code:'ISSUER_LISTING_STALE'});
    expect((await run({ctx:{found:true,ownerId:user,ownerAuthId:user,state:'opening',quoteTotalUnits:'10',quoteExpiresAt:String(now+10),toleranceBps:10000,preparedAt:signing.preparedAt}})).body.error).toMatchObject({code:'ISSUER_LISTING_FLOOR_OUT_OF_TOLERANCE'});
    expect((await run({writerError:'PAYMENT_V2_LISTING_CONFLICT'})).body.error).toMatchObject({code:'ISSUER_LISTING_CONFLICT'});
  });
});
