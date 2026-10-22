import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { base58Encode } from '../lib/solana/base58';
import { configPda, TOKEN_PROGRAM_ID } from '../lib/solana/sdk';
import { inspectPurchaseTransaction, type PurchaseBinding, type PurchaseTransaction } from '../lib/solana/purchase-verification';
import { verifyPurchaseTransaction } from '../lib/solana/verify';
import { issueQuote, verifyQuote, verifyQuoteSignature } from '../lib/solana/quotes';
import { recoverOrSettlePayment, stripePayoutBlockReason, type PaymentOrder } from '../lib/db/purchase-payment';

const mocks = vi.hoisted(() => ({ query: vi.fn(), stripe: vi.fn(), auth: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: () => ({ from: mocks.query }),
  createServerSupabase: async () => ({ auth: { getUser: mocks.auth }, rpc: mocks.rpc, from: mocks.query }),
}));
vi.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }));
vi.mock('stripe', () => ({ default: mocks.stripe }));
import { checkPayoutEligibility, executePayout, purchaseCard, purchaseCardSplit } from '../lib/api/contract';
import { POST } from '../app/api/solana/settle/route';
import { GET as quoteGET } from '../app/api/solana/quote/route';
import { GET as buildGET } from '../app/api/solana/build-tx/route';
import { GET as attemptsGET } from '../app/api/solana/attempts/route';
import { GET as receiptsGET } from '../app/api/solana/receipts/route';

const signature = base58Encode(new Uint8Array(64).fill(7));
const programId = 'CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF';
const expected: PurchaseBinding = {
  programId, cardId: '11111111-1111-1111-1111-111111111111',
  buyerWallet: 'buyer', sellerWallet: 'seller', treasuryWallet: 'treasury',
  usdcMint: 'mint', totalUnits: 1_000_000, sellerUnits: 950_000, feeUnits: 50_000,
  expiresAt: '2026-10-15T12:05:00Z',
};

function fixture(): PurchaseTransaction {
  const data = Buffer.alloc(48);
  Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]).copy(data);
  data.writeBigUInt64LE(BigInt(1_000_000), 8);
  createHash('sha256').update(`flexsoar:card:${expected.cardId}`).digest().copy(data, 16);
  const accounts = ['buyer', 'seller', 'buyerToken', 'sellerToken', 'treasuryToken', configPda(programId), TOKEN_PROGRAM_ID];
  const keys = ['sponsor', ...accounts];
  const balances = (amounts: string[]) => amounts.map((amount, i) => ({
    accountIndex: i + 3, mint: 'mint', owner: ['buyer', 'seller', 'treasury'][i],
    programId: TOKEN_PROGRAM_ID, uiTokenAmount: { amount, decimals: 6 },
  }));
  return {
    slot: 123, blockTime: Date.parse('2026-10-15T12:03:00Z') / 1000,
    transaction: { signatures: [signature, signature], message: {
      accountKeys: keys.map((pubkey) => ({ pubkey, signer: ['sponsor', 'buyer'].includes(pubkey), writable: pubkey.endsWith('Token') })),
      instructions: [{ programId, accounts, data: base58Encode(data) }],
    } },
    meta: { err: null, preTokenBalances: balances(['2000000', '0', '0']), postTokenBalances: balances(['1000000', '950000', '50000']),
      innerInstructions: [{ index: 0, instructions: ['sellerToken', 'treasuryToken'].map((destination, i) => ({
        programId: TOKEN_PROGRAM_ID, parsed: { type: 'transfer', info: {
          source: 'buyerToken', destination, authority: 'buyer', amount: ['950000', '50000'][i],
        } },
      })) }],
    },
  };
}

describe('production buy ABI verification', () => {
  it('accepts a sponsored buy; buyer need not be fee payer', async () => {
    expect(await inspectPurchaseTransaction(fixture(), signature, expected)).toBeNull();
  });
  it('allows unrelated extra instructions without mistaking their transfers for the buy', async () => {
    const tx = fixture();
    tx.transaction!.message!.instructions!.push({ programId: 'compute-budget' });
    expect(await inspectPurchaseTransaction(tx, signature, expected)).toBeNull();
  });
  const cases: [string, (tx: PurchaseTransaction) => void][] = [
    ['program', (tx) => { tx.transaction!.message!.instructions![0].programId = 'wrong'; }],
    ['instruction', (tx) => { tx.transaction!.message!.instructions![0].data = base58Encode(new Uint8Array(48)); }],
    ['signer', (tx) => { tx.transaction!.message!.accountKeys![1].signer = false; }],
    ['mint', (tx) => { tx.meta!.postTokenBalances![0].mint = 'wrong'; }],
    ['recipient', (tx) => { tx.transaction!.message!.instructions![0].accounts![3] = 'wrong'; }],
    ['owner', (tx) => { tx.meta!.postTokenBalances![1].owner = 'wrong'; }],
    ['amount', (tx) => { tx.meta!.postTokenBalances![1].uiTokenAmount.amount = '949999'; }],
    ['unrelated matching transfers', (tx) => { tx.meta!.innerInstructions = []; }],
    ['matching transfers under another invocation', (tx) => {
      tx.transaction!.message!.instructions!.push({ programId: 'unrelated' });
      tx.meta!.innerInstructions![0].index = 1;
    }],
    ['duplicate settlement invocation', (tx) => {
      tx.transaction!.message!.instructions!.push({ ...tx.transaction!.message!.instructions![0] });
    }],
    ['wrong CPI destination', (tx) => { tx.meta!.innerInstructions![0].instructions[0].parsed!.info!.destination = 'wrong'; }],
    ['failed transaction', (tx) => { tx.meta!.err = 'failed'; }],
    ['missing block time', (tx) => { tx.blockTime = null; }],
    ['late inclusion', (tx) => { tx.blockTime = Date.parse(expected.expiresAt) / 1000 + 1; }],
    ['old matching payment', (tx) => { tx.blockTime = Date.parse(expected.expiresAt) / 1000 - 301; }],
    ['transaction signature', (tx) => { tx.transaction!.signatures = ['other']; }],
  ];
  it.each(cases)('rejects wrong %s', async (_name, mutate) => {
    const tx = fixture(); mutate(tx);
    expect(await inspectPurchaseTransaction(tx, signature, expected)).not.toBeNull();
  });
  it('checks decoded instruction amount and Card reference independently of deltas', async () => {
    expect(await inspectPurchaseTransaction(fixture(), signature, { ...expected, cardId: 'different-card' })).toBe('wrong Card reference');
    const tx = fixture();
    const data = Buffer.alloc(48);
    Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]).copy(data);
    data.writeBigUInt64LE(BigInt(2), 8);
    tx.transaction!.message!.instructions![0].data = base58Encode(data);
    expect(await inspectPurchaseTransaction(tx, signature, expected)).toBe('wrong instruction amount');
  });
  it('rejects extra movements from another token account of the buyer', async () => {
    const tx = fixture();
    tx.meta!.preTokenBalances!.push({ accountIndex: 99, mint: 'mint', owner: 'buyer', programId: TOKEN_PROGRAM_ID, uiTokenAmount: { amount: '1', decimals: 6 } });
    expect(await inspectPurchaseTransaction(tx, signature, expected)).toBe('wrong wallet delta');
  });
  it('requests finalized evidence from configured cluster; absence is retry-only', async () => {
    const oldKey = process.env.HELIUS_API_KEY;
    const oldCluster = process.env.SOLANA_CLUSTER;
    process.env.HELIUS_API_KEY = 'offline-fixture'; process.env.SOLANA_CLUSTER = 'devnet';
    try {
      const rpc = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ result: fixture() })));
      expect((await verifyPurchaseTransaction(signature, expected, rpc)).ok).toBe(true);
      expect(String(rpc.mock.calls[0][0])).toContain('devnet.helius-rpc.com');
      expect(JSON.parse(String(rpc.mock.calls[0][1]?.body)).params[1].commitment).toBe('finalized');
      rpc.mockResolvedValue(new Response(JSON.stringify({ result: null })));
      expect(await verifyPurchaseTransaction(signature, expected, rpc)).toEqual({ ok: false, reason: expect.stringContaining('retry settlement only') });
    } finally {
      if (oldKey === undefined) delete process.env.HELIUS_API_KEY; else process.env.HELIUS_API_KEY = oldKey;
      if (oldCluster === undefined) delete process.env.SOLANA_CLUSTER; else process.env.SOLANA_CLUSTER = oldCluster;
    }
  });
  it('authenticates an expired original quote for recovery, never for a new payment', async () => {
    const previous = process.env.SOLANA_QUOTE_SECRET;
    process.env.SOLANA_QUOTE_SECRET = 'offline-fixture';
    try {
      const quote = await issueQuote({ listingId: 'listing', buyerId: 'buyer', totalUnits: 1_000_000, ttlSeconds: -1 });
      expect(await verifyQuote(quote)).toBe(false);
      expect(await verifyQuoteSignature(quote)).toBe(true);
      expect(await verifyQuoteSignature({ ...quote, buyerId: 'other' })).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.SOLANA_QUOTE_SECRET; else process.env.SOLANA_QUOTE_SECRET = previous;
    }
  });
});

describe('actual settlement endpoint: legacy branch removed (H1)', () => {
  // Was: legacy quote-based receipt lookup through the service credential.
  // Removed in H1; every non-v2 body is now 410 before any privileged read.
  const listingId = '11111111-1111-1111-1111-111111111111';
  beforeEach(() => { mocks.query.mockReset(); mocks.auth.mockReset(); mocks.rpc.mockReset(); });
  it('requires a session before any privileged lookup', async () => {
    mocks.auth.mockResolvedValue({ data: { user: null } });
    expect((await POST(new Request('https://offline.invalid', { method: 'POST', body: '{}' }))).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('refuses a quote whose buyer is someone else with 410 (was 400); no privileged lookup', async () => {
    mocks.auth.mockResolvedValue({ data: { user: { id: 'other' } } });
    const request = new Request('https://offline.invalid', { method: 'POST', body: JSON.stringify({ listingId, signature, quote: { buyerId: 'buyer', listingId } }) });
    expect((await POST(request)).status).toBe(410);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each([300, -1])('an authentic own legacy quote (TTL %s) is 410 and never reads orders with the service credential (was 200 receipt / 409)', async (ttlSeconds) => {
    const previous = process.env.SOLANA_QUOTE_SECRET;
    process.env.SOLANA_QUOTE_SECRET = 'offline-endpoint-fixture';
    mocks.auth.mockResolvedValue({ data: { user: { id: 'buyer' } } });
    try {
      const quote = await issueQuote({ buyerId: 'buyer', listingId, totalUnits: 1_000_000, ttlSeconds });
      const response = await POST(new Request('https://offline.invalid', { method: 'POST', body: JSON.stringify({ listingId, signature, quote }) }));
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ code: 'LEGACY_SETTLEMENT_REMOVED', receiptsPath: '/api/solana/receipts', error: expect.stringContaining('do not pay again') });
      expect(mocks.query).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.SOLANA_QUOTE_SECRET; else process.env.SOLANA_QUOTE_SECRET = previous;
    }
  });
  it('the settle route no longer imports the service-credential client', () => {
    const source = fs.readFileSync('app/api/solana/settle/route.ts', 'utf8');
    expect(source).not.toContain('createServiceSupabase');
  });
});

describe('production receipt reconciliation (mock persistence, NOT SQL concurrency proof)', () => {
  const identity = { buyerId: 'buyer', listingId: 'listing', reference: `sol:${signature}` };
  const receipt: PaymentOrder = { id: 'order', buyer_id: 'buyer', listing_id: 'listing', settlement_ref: identity.reference, status: 'settled' };
  it('returns original result without re-verifying a sold listing or signing again', async () => {
    const verify = vi.fn(); const settle = vi.fn();
    expect(await recoverOrSettlePayment(identity, { findOrder: async () => receipt, verify, settle })).toBe('order');
    expect(verify).not.toHaveBeenCalled(); expect(settle).not.toHaveBeenCalled();
  });
  it.each(['buyer_id', 'listing_id', 'settlement_ref', 'status'] as const)('refuses mismatched receipt %s', async (field) => {
    await expect(recoverOrSettlePayment(identity, { findOrder: async () => ({ ...receipt, [field]: 'other' }), verify: vi.fn(), settle: vi.fn() })).rejects.toThrow('does not match');
  });
  it('recovers when commit succeeded but RPC response was lost', async () => {
    const findOrder = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(receipt);
    expect(await recoverOrSettlePayment(identity, { findOrder, verify: async () => {}, settle: async () => { throw new Error('lost response'); } })).toBe('order');
  });
  it('rechecks the receipt if concurrent verification sees an already-sold listing', async () => {
    const findOrder = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(receipt);
    expect(await recoverOrSettlePayment(identity, { findOrder, verify: async () => { throw new Error('sold'); }, settle: vi.fn() })).toBe('order');
  });
  it('reconciles two concurrent duplicate requests against one durable receipt', async () => {
    let calls = 0;
    const findOrder = async () => ++calls <= 2 ? null : receipt;
    const deps = { findOrder, verify: async () => {}, settle: async () => 'order' };
    expect(await Promise.all([recoverOrSettlePayment(identity, deps), recoverOrSettlePayment(identity, deps)])).toEqual(['order', 'order']);
  });
  it('does not hide a conflicting RPC order behind a matching durable receipt', async () => {
    const findOrder = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(receipt);
    await expect(recoverOrSettlePayment(identity, { findOrder, verify: async () => {}, settle: async () => 'different-order' })).rejects.toThrow('conflicting order');
  });
  it('does not hide a conflicting receipt after a lost response', async () => {
    const findOrder = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ ...receipt, listing_id: 'different-listing' });
    await expect(recoverOrSettlePayment(identity, { findOrder, verify: async () => {}, settle: async () => { throw new Error('lost response'); } })).rejects.toThrow('does not match');
  });
  it('surfaces an explicit unresolved failure; never initiates a replacement payment', async () => {
    await expect(recoverOrSettlePayment(identity, { findOrder: async () => null, verify: async () => {}, settle: async () => { throw new Error('claim unavailable; resolution required'); } })).rejects.toThrow('resolution required');
  });
});

describe('production Stripe payout containment', () => {
  beforeEach(() => { mocks.query.mockReset(); mocks.stripe.mockReset(); });
  function query(data: unknown) {
    const builder = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
    builder.select.mockReturnValue(builder); builder.eq.mockReturnValue(builder);
    builder.maybeSingle.mockResolvedValue({ data, error: null });
    mocks.query.mockReturnValue(builder);
  }
  it('excludes Solana orders in actual eligibility and refuses execution independently', async () => {
    query([{ id: 'o', seller_id: 's', net_cents: 1900, settlement_ref: `sol:${signature}` }]);
    expect(await checkPayoutEligibility()).toEqual([expect.objectContaining({ eligible: false, reason: expect.stringContaining('USDC') })]);
    query({ id: 'o', settlement_ref: `sol:${signature}` });
    await expect(executePayout('o')).rejects.toThrow('USDC');
    expect(mocks.stripe).not.toHaveBeenCalled();
  });
  it('keeps Stripe dormant even for Stripe references; rejects missing evidence', async () => {
    expect(stripePayoutBlockReason(null)).toContain('no explicit');
    query({ id: 'o', settlement_ref: 'pi_old' });
    await expect(executePayout('o')).rejects.toThrow('dormant');
    expect(mocks.stripe).not.toHaveBeenCalled();
  });
});

describe('production funding gates and durable status while paused',()=>{
  beforeEach(()=>{mocks.auth.mockReset();mocks.query.mockReset();mocks.rpc.mockReset();});
  it('refuses legacy issuance before privileged lookup, including authenticated callers',async()=>{
    mocks.auth.mockResolvedValue({data:{user:{id:'buyer'}}});
    for(const handler of [quoteGET,buildGET]){const response=await handler();expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'FUNDING_DISABLED',retrySettlementOnly:true});}
    expect(mocks.query).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not invoke reference-only settlement from application or dormant Stripe',async()=>{
    await expect(purchaseCard('listing','buyer','sol:old')).rejects.toThrow('Reference-only');
    await expect(purchaseCardSplit('listing','buyer','pi_old',0,null)).rejects.toThrow('Reference-only');
    expect(mocks.query).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('restores authenticated status from session RPC and reports absent schema honestly',async()=>{
    mocks.auth.mockResolvedValue({data:{user:{id:'buyer'}}});mocks.rpc.mockResolvedValue({data:[],error:null});
    const request=()=>new Request('https://offline.invalid/api/solana/attempts?listingId=11111111-1111-1111-1111-111111111111');
    expect((await attemptsGET(request())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('fn_payment_v2_own_attempts',{p_listing_id:'11111111-1111-1111-1111-111111111111'});
    mocks.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'not installed'}});
    const response=await attemptsGET(request());expect(response.status).toBe(503);expect(await response.json()).toMatchObject({recoveryRequired:true,retrySettlementOnly:true});
  });
  it('attaches a v2 candidate as pending, never as verified settlement',async()=>{
    mocks.auth.mockResolvedValue({data:{user:{id:'buyer'}}});mocks.rpc.mockResolvedValue({data:null,error:null});
    const response=await POST(new Request('https://offline.invalid',{method:'POST',body:JSON.stringify({version:2,attemptId:'11111111-1111-1111-1111-111111111111',signature})}));
    expect(response.status).toBe(202);expect(await response.json()).toMatchObject({pending:true,retrySettlementOnly:true});
    expect(mocks.rpc.mock.calls.map(([name])=>name)).toEqual(['fn_payment_v2_attach_candidate']);expect(mocks.query).not.toHaveBeenCalled();
  });
  it('retains buyer-bound Panda-style legacy record lookup without claiming escrow',async()=>{
    mocks.auth.mockResolvedValue({data:{user:{id:'buyer'}}});
    const listingId='11111111-1111-1111-1111-111111111111';
    const builder={select:vi.fn(),eq:vi.fn(),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[{id:'old-order',listing_id:listingId,buyer_id:'buyer',settlement_ref:`sol:${signature}`,status:'settled'}],error:null}).then(resolve)};
    builder.select.mockReturnValue(builder);builder.eq.mockReturnValue(builder);mocks.query.mockReturnValue(builder);
    const response=await receiptsGET(new Request(`https://offline.invalid/api/solana/receipts?listingId=${listingId}`));
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({receipts:[{classification:'legacy_record_only',paymentVerified:false,orderId:'old-order'}]});
    expect(builder.eq).toHaveBeenCalledWith('buyer_id','buyer');
  });
});
