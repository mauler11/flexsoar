import { describe, expect, it } from 'vitest';
import { createHash, createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { calculateFx } from './fx';
import { handleIssuerRequest } from './service';
import type { IssuerContext, IssuerDeps, IssuerJwk } from './types';
import { associatedTokenAddress } from '@/lib/solana/sdk';
import { base58Encode, decodeAddress } from '@/lib/solana/base58';
import { encodeListing } from '@/lib/solana/listing-v2';

const now = 1_800_000_000;
const user = '11111111-1111-4111-8111-111111111111';
const hmacKey = Buffer.from('unit-test-hmac-key-not-a-real-credential');
const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const exported = pair.publicKey.export({ format: 'jwk' });
const jwk: IssuerJwk = { ...exported, kid: 'e3ee4930-ea76-4189-8036-8fa384097de1', alg: 'ES256', use: 'sig', key_ops: ['verify'] };

function jwt(claims: Record<string, unknown>, alg = 'ES256', kid = jwk.kid): string {
  const enc = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const head = enc({ alg, kid, typ: 'JWT' }), body = enc(claims), input = `${head}.${body}`;
  return `${input}.${cryptoSign('sha256', Buffer.from(input), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
function claims(overrides: Record<string, unknown> = {}) { return { iss:'https://issuer.example/auth/v1', aud:'authenticated', role:'authenticated', sub:user, iat:now-10, exp:now+300, ...overrides }; }
function request(token: string, options: { path?: string; userId?: string; nonce?: string; badMac?: boolean; body?: string } = {}) {
  const body = Buffer.from(options.body??'{}'), path=options.path??'/v1/authorize-attempt', stamp=String(now), nonce=options.nonce??Buffer.alloc(16, 1).toString('base64url'), uid=options.userId??user, kid='hmac-v1';
  const canonical=`flexsoar-issuer-v1\nPOST\n${path}\n${stamp}\n${nonce}\n${uid}\n${createHash('sha256').update(body).digest('hex')}`;
  const mac=createHmac('sha256',hmacKey).update(canonical).digest('hex');
  return { method:'POST',path,rawBody:body,headers:{'content-type':'application/json; charset=utf-8','x-flexsoar-kid':kid,'x-flexsoar-timestamp':stamp,'x-flexsoar-nonce':nonce,'x-flexsoar-user':uid,'x-flexsoar-signature':options.badMac?'0'.repeat(64):mac,authorization:`Bearer ${token}`} };
}
function deps() {
  const counters={nonce:0,reads:0,writes:0,signer:0,sender:0};
  const nonces=new Set<string>();
  const db: IssuerDeps['db']={
    consumeIssuerNonce:async(_kid,nonce)=>{counters.nonce++;const n=Buffer.from(nonce).toString('hex');if(nonces.has(n))throw Error('PAYMENT_V2_ISSUER_NONCE_REPLAY');nonces.add(n)}, subjectContext:async()=>{counters.reads++;return {found:true}}, saleSigningContext:async()=>{counters.reads++;return {found:true}},
    enrollWalletChecked:async()=>{counters.writes++}, prepareSale:async()=>{counters.writes++;return '22222222-2222-4222-8222-222222222222'},recordListing:async()=>{counters.writes++},
  };
  const d:IssuerDeps={db,rpc:[{genesis:async()=>'',finalizedSlot:async()=>BigInt('1'),account:async()=>null},{genesis:async()=>'',finalizedSlot:async()=>BigInt('1'),account:async()=>null}],fx:[{quote:async()=>{throw Error()}},{quote:async()=>{throw Error()}}],jwks:{get:async()=>[jwk]},nowSeconds:()=>now,
    config:{hmacKeys:new Map([['hmac-v1',hmacKey]]),activeHmacKid:'hmac-v1',issuer:'https://issuer.example/auth/v1',audience:'authenticated',jwksUrl:'https://issuer.example/jwks',jwtKid:jwk.kid!,allowList:new Set([user]),networkId:'33333333-3333-4333-8333-333333333333',networkGenesis:'11111111111111111111111111111111',mint:'11111111111111111111111111111111',tokenProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',tokenDecimals:6,program:'11111111111111111111111111111111',saleAddress:()=>'',escrowAddress:()=>''}};
  return { d, counters };
}
async function reject(token:string,opts:Parameters<typeof request>[1]={}){
  const {d,counters}=deps();const response=await handleIssuerRequest(request(token,opts),d);
  expect(response.status).not.toBe(200);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);return counters;
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
    expect(response).toMatchObject({status:403});expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
  });
  it('rejects a replayed nonce and bad HMAC before endpoint work',async()=>{
    const {d,counters}=deps(),token=jwt(claims()),req=request(token);
    await handleIssuerRequest(req,d);const replay=await handleIssuerRequest(req,d);
    expect(replay).toMatchObject({status:401});expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
    const bad=await reject(token,{badMac:true});expect(bad.nonce).toBe(0);
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
});

describe('issuer endpoint refusal boundaries',()=>{
  const listingId='22222222-2222-4222-8222-222222222222';
  const listingContext={found:true,ownerId:user,ownerAuthId:user,networkId:'33333333-3333-4333-8333-333333333333',genesis:'11111111111111111111111111111111',program:'11111111111111111111111111111111',listingStatus:'active',cardStatus:'authenticated',priceCents:'3',inventoryRegistered:true,saleFenced:false,fundingEnabled:true};
  const quote=(providerId:string,numerator:string,denominator='1',observedAt=new Date(now*1000).toISOString())=>({providerId,quoteId:`q-${providerId}`,numerator,denominator,observedAt});
  async function prepareRefusal(q1:ReturnType<typeof quote>,q2:ReturnType<typeof quote>,ctx:IssuerContext=listingContext){
    const {d,counters}=deps();d.db.subjectContext=async(kind):Promise<IssuerContext>=>{counters.reads++;return kind==='prepare_recovery'?{found:false}:ctx};
    d.fx=[{quote:async()=>q1},{quote:async()=>q2}];
    const response=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/prepare-sale',nonce:Buffer.alloc(16,2).toString('base64url'),body:JSON.stringify({listingId,requestId:'44444444-4444-4444-8444-444444444444'})}),d);
    expect(response.status).not.toBe(200);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);return response;
  }
  it('refuses FX disagreement, staleness, overflow, and a foreign listing before writes',async()=>{
    expect((await prepareRefusal(quote('a','199'),quote('b','202'))).body.error).toMatchObject({code:'ISSUER_FX_DISAGREEMENT'});
    expect((await prepareRefusal(quote('a','1','1',new Date((now-3601)*1000).toISOString()),quote('b','1'))).body.error).toMatchObject({code:'ISSUER_FX_STALE'});
    expect((await prepareRefusal(quote('a','18446744073709551615'),quote('b','18446744073709551615'),{...listingContext,priceCents:'18446744073709551615'})).body.error).toMatchObject({code:'ISSUER_FX_OVERFLOW'});
    expect((await prepareRefusal(quote('a','1'),quote('b','1'),{...listingContext,ownerId:'55555555-5555-4555-8555-555555555555'})).body.error).toMatchObject({code:'ISSUER_LISTING_NOT_OWNED'});
  });
  it('refuses enrollment proof replay across network, user, wallet, and mint',async()=>{
    const keys=generateKeyPairSync('ed25519'),pubJwk=keys.publicKey.export({format:'jwk'}),walletBytes=Buffer.from(pubJwk.x!,'base64url'),wallet=base58Encode(walletBytes),mint='11111111111111111111111111111111',genesis='11111111111111111111111111111111',ata=associatedTokenAddress(wallet,mint),issuedAt=String(now);
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
      const {d,counters}=deps();d.config.allowList=new Set([user,'55555555-5555-4555-8555-555555555555']);d.db.subjectContext=async()=>{counters.reads++;return {found:true,genesis}};
      const response=await handleIssuerRequest(request(c.token,{path:'/v1/enroll-wallet',userId:c.userId,nonce:Buffer.alloc(16,i+3).toString('base64url'),body:JSON.stringify(c.body)}),d);
      expect(response.body.error).toMatchObject({code:c.expected});expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
    }
  });
  it('enrolls only after matching finalized RPC snapshots from both providers',async()=>{
    const keys=generateKeyPairSync('ed25519'),pubJwk=keys.publicKey.export({format:'jwk'}),walletBytes=Buffer.from(pubJwk.x!,'base64url'),wallet=base58Encode(walletBytes),mint='11111111111111111111111111111111',genesis='11111111111111111111111111111111',decodedMint=decodeAddress(mint),ata=associatedTokenAddress(wallet,mint),issuedAt=String(now);
    const tokenMint=new Uint8Array(82);tokenMint[44]=6;tokenMint[45]=1;
    const tokenAccount=new Uint8Array(165);tokenAccount.set(decodedMint,0);tokenAccount.set(walletBytes,32);tokenAccount[108]=1;
    const message=`FlexSoar wallet enrollment v1\nnetwork:${genesis}\nuser:${user}\nwallet:${wallet}\nmint:${mint}\ntoken-account:${ata}\nissued-at:${issuedAt}`;
    const signature=cryptoSign(null,Buffer.from(message),keys.privateKey).toString('base64url');
    const body=JSON.stringify({phase:'complete',networkGenesis:genesis,wallet,mint,tokenAccount:ata,issuedAt,signature});
    const account=(address:string)=>({owner:d.config.tokenProgram,data:address===mint?tokenMint:tokenAccount,contextSlot:BigInt('100')});
    const {d,counters}=deps();d.db.subjectContext=async()=>({found:true,genesis});
    d.rpc=[{genesis:async()=>genesis,finalizedSlot:async()=>BigInt('100'),account:async(address)=>account(address)},{genesis:async()=>genesis,finalizedSlot:async()=>BigInt('100'),account:async(address)=>account(address)}];
    const response=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/enroll-wallet',nonce:Buffer.alloc(16,9).toString('base64url'),body}),d);
    expect(response.status,JSON.stringify(response.body)).toBe(200);expect(response.body).toMatchObject({enrolled:true});expect(counters.writes).toBe(1);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);
    const mismatch=deps();mismatch.d.db.subjectContext=async()=>({found:true,genesis});mismatch.d.rpc=[d.rpc[0],{genesis:async()=>genesis,finalizedSlot:async()=>BigInt('100'),account:async(address)=>{const acct=account(address);return address===ata?{...acct,data:new Uint8Array(165)}:acct}}];
    const refused=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/enroll-wallet',nonce:Buffer.alloc(16,10).toString('base64url'),body}),mismatch.d);
    expect(refused.body.error).toMatchObject({code:'ISSUER_RPC_DISAGREEMENT'});expect(mismatch.counters.writes).toBe(0);expect(mismatch.counters.signer).toBe(0);expect(mismatch.counters.sender).toBe(0);
  });
  it('refuses stale and incorrectly signed listing records before the 083 writer',async()=>{
    const saleId='66666666-6666-4666-8666-666666666666';const owner={ownerId:user,ownerAuthId:user};
    const signing={found:true,...owner,saleId,listingId,cardId:'77777777-7777-4777-8777-777777777777',state:'opening',genesis:'11111111111111111111111111111111',program:'11111111111111111111111111111111',cardCommitment:'11111111111111111111111111111111',saleCommitment:'11111111111111111111111111111111',generation:'1',sellerWallet:'11111111111111111111111111111111',quoteTotalUnits:'10',quoteExpiresAt:String(now+10),preparedAt:new Date((now-10)*1000).toISOString(),toleranceBps:200};
    const bytes=await encodeListing({domain:decodeAddress(String(signing.genesis)),program:decodeAddress(String(signing.program)),card:decodeAddress(String(signing.cardCommitment)),saleId:decodeAddress(String(signing.saleCommitment)),generation:BigInt('1'),minTotal:BigInt('10'),expiresAt:BigInt(now+60)});
    const body={saleId,messageBase64url:Buffer.from(bytes).toString('base64url'),signatureBase64url:Buffer.alloc(64).toString('base64url')};
    const run=async(state:string,ownerId=user)=>{const {d,counters}=deps();d.db.subjectContext=async()=>({found:true,...owner,state,quoteTotalUnits:'10',quoteExpiresAt:String(now+10)});d.db.saleSigningContext=async()=>({...signing,ownerId,ownerAuthId:ownerId,state});
      const response=await handleIssuerRequest(request(jwt(claims()),{path:'/v1/record-listing',nonce:Buffer.alloc(16,state==='opening'?11:12).toString('base64url'),body:JSON.stringify(body)}),d);
      expect(response.status).not.toBe(200);expect(counters.writes).toBe(0);expect(counters.signer).toBe(0);expect(counters.sender).toBe(0);return response;};
    expect((await run('closed')).body.error).toMatchObject({code:'ISSUER_SALE_NOT_OPENING'});
    expect((await run('opening','55555555-5555-4555-8555-555555555555')).body.error).toMatchObject({code:'ISSUER_SALE_NOT_OWNED'});
    expect((await run('opening')).body.error).toMatchObject({code:'ISSUER_LISTING_SIGNATURE_INVALID'});
  });
});
