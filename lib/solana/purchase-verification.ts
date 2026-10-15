/** Strict inspection of the existing buy ABI. RPC evidence is trusted only from
 * the configured cluster at finalized commitment. There is NO attempt nonce in
 * this ABI: Card binding and an inclusion window are not purchase exclusivity.
 */
import { base58Decode } from './base58';
import { buyDiscriminator, configPda, TOKEN_PROGRAM_ID, vaultRefForCard } from './sdk';

export interface PurchaseBinding {
  programId: string;
  cardId: string;
  buyerWallet: string;
  sellerWallet: string;
  treasuryWallet: string;
  usdcMint: string;
  totalUnits: number;
  sellerUnits: number;
  feeUnits: number;
  expiresAt: string;
}

export interface PurchaseTransaction {
  slot?: number;
  blockTime?: number | null;
  transaction?: {
    signatures?: string[];
    message?: {
      accountKeys?: { pubkey: string; signer: boolean; writable: boolean }[];
      instructions?: { programId: string; accounts?: string[]; data?: string }[];
    };
  };
  meta?: {
    err: unknown;
    innerInstructions?: { index: number; instructions: {
      programId: string;
      parsed?: { type?: string; info?: { source?: string; destination?: string; authority?: string; amount?: string } };
    }[] }[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  };
}
interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export async function inspectPurchaseTransaction(
  tx: PurchaseTransaction, signature: string, expected: PurchaseBinding,
): Promise<string | null> {
  const message = tx.transaction?.message;
  const meta = tx.meta;
  if (!meta || meta.err !== null || !message || !Number.isSafeInteger(tx.slot) || (tx.slot ?? 0) <= 0) return 'missing or failed transaction';
  if (tx.transaction?.signatures?.[0] !== signature) return 'transaction signature mismatch';
  const keys = message.accountKeys ?? [];
  const buyer = keys.find((key) => key.pubkey === expected.buyerWallet);
  // Sponsorship is allowed: the buyer must sign, but need not pay network fees.
  if (!buyer?.signer) return 'buyer did not sign';
  if (new Set([expected.buyerWallet, expected.sellerWallet, expected.treasuryWallet]).size !== 3) return 'payment roles must be distinct';
  if (!Number.isSafeInteger(expected.totalUnits) || expected.totalUnits <= 0 ||
      expected.feeUnits !== Math.floor(expected.totalUnits * 500 / 10_000) ||
      expected.sellerUnits !== expected.totalUnits - expected.feeUnits) return 'invalid expected amounts';
  const deadline = Date.parse(expected.expiresAt);
  const includedAt = (tx.blockTime ?? NaN) * 1000;
  // Existing issuer uses a five-minute TTL. This is a conservative legacy
  // inclusion check, not proof of a unique attempt or exact signing time.
  if (!Number.isFinite(deadline) || !Number.isFinite(includedAt) || includedAt > deadline || includedAt < deadline - 300_000) return 'payment outside quote inclusion window';
  const instructions = message.instructions ?? [];
  const matches = instructions.map((ix, index) => ({ ix, index })).filter(({ ix }) => ix.programId === expected.programId);
  if (matches.length !== 1) return 'expected exactly one settlement program instruction';
  const { ix, index } = matches[0];
  let data: Uint8Array;
  try { data = base58Decode(ix.data ?? ''); } catch { return 'invalid instruction encoding'; }
  const discriminator = await buyDiscriminator();
  const ref = await vaultRefForCard(expected.cardId);
  if (data.length !== 48 || discriminator.some((b, i) => data[i] !== b)) return 'wrong buy instruction';
  let amount = BigInt(0);
  for (let i = 7; i >= 0; i--) amount = amount * BigInt(256) + BigInt(data[8 + i]);
  if (amount !== BigInt(expected.totalUnits)) return 'wrong instruction amount';
  if (ref.some((b, i) => data[16 + i] !== b)) return 'wrong Card reference';
  const accounts = ix.accounts ?? [];
  if (accounts.length !== 7 || accounts[0] !== expected.buyerWallet || accounts[1] !== expected.sellerWallet ||
      accounts[5] !== configPda(expected.programId) || accounts[6] !== TOKEN_PROGRAM_ID) return 'wrong buy accounts';
  const owners = [expected.buyerWallet, expected.sellerWallet, expected.treasuryWallet];
  const changes = [-expected.totalUnits, expected.sellerUnits, expected.feeUnits];
  for (let i = 0; i < 3; i++) {
    const keyIndex = keys.findIndex((key) => key.pubkey === accounts[2 + i] && key.writable);
    if (keyIndex < 0) return 'missing writable token account';
    const pre = meta.preTokenBalances?.filter((b) => b.accountIndex === keyIndex) ?? [];
    const post = meta.postTokenBalances?.filter((b) => b.accountIndex === keyIndex) ?? [];
    // Current builder requires existing accounts. ATA setup instructions are
    // otherwise allowed; new accounts with no prebalance need a future policy.
    if (pre.length !== 1 || post.length !== 1) return 'missing token account evidence';
    for (const b of [pre[0], post[0]]) {
      if (b.mint !== expected.usdcMint || b.owner !== owners[i] || b.programId !== TOKEN_PROGRAM_ID ||
          b.uiTokenAmount.decimals !== 6 || !/^\d+$/.test(b.uiTokenAmount.amount)) return 'wrong token mint or owner';
    }
    if (BigInt(post[0].uiTokenAmount.amount) - BigInt(pre[0].uiTokenAmount.amount) !== BigInt(changes[i])) return 'wrong token account delta';
  }
  for (let i = 0; i < owners.length; i++) {
    const sum = (balances: TokenBalance[]) => balances
      .filter((balance) => balance.owner === owners[i] && balance.mint === expected.usdcMint)
      .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), BigInt(0));
    if (sum(meta.postTokenBalances ?? []) - sum(meta.preTokenBalances ?? []) !== BigInt(changes[i])) return 'wrong wallet delta';
  }
  // Attribute the transfers to THIS program invocation, not unrelated outer
  // instructions that happen to produce the same final balance changes.
  const transfers = (meta.innerInstructions ?? []).filter((group) => group.index === index)
    .flatMap((group) => group.instructions).filter((inner) => inner.programId === TOKEN_PROGRAM_ID);
  const recipients = [accounts[3], accounts[4]];
  const amounts = [expected.sellerUnits, expected.feeUnits];
  if (transfers.length !== 2 || transfers.some((inner, i) => {
    const info = inner.parsed?.info;
    return inner.parsed?.type !== 'transfer' || info?.source !== accounts[2] ||
      info.destination !== recipients[i] || info.authority !== expected.buyerWallet || info.amount !== String(amounts[i]);
  })) return 'buy token transfers do not match';
  return null;
}
