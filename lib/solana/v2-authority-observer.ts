/** Finalized authority-instruction observation. The expected instruction MUST be
 * derived from trusted immutable sale/decision/committed-claim context, never a
 * client-supplied instruction or digest. No signing or database writes here. */
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { base58Decode } from './base58';
import { equalBytes } from './protocol-v2';
import { localRpc, type V2Transaction } from './v2-observer';

export function inspectAuthorityTransaction(tx: V2Transaction, signature: string, expected: TransactionInstruction): void {
  if (tx.meta?.err !== null || tx.transaction.signatures[0] !== signature || !Number.isSafeInteger(tx.slot) || tx.slot < 0) throw new Error('authority transaction failed or mismatched');
  const message = tx.transaction.message;
  const matches = message.instructions.filter(i => i.programId === expected.programId.toBase58());
  if (matches.length !== 1) throw new Error('ambiguous authority invocation');
  const ix = matches[0];
  if (!equalBytes(base58Decode(ix.data ?? ''), expected.data) || ix.accounts?.length !== expected.keys.length) throw new Error('authority instruction mismatch');
  expected.keys.forEach((key, index) => {
    const address = key.pubkey.toBase58();
    const accounts = message.accountKeys.filter(k => k.pubkey === address);
    const account = accounts[0];
    if (ix.accounts![index] !== address || accounts.length !== 1 || !account || (key.isSigner && account.signer !== true) || (key.isWritable && account.writable !== true)) throw new Error('authority account/signature mismatch');
  });
}

export async function observeAuthorityTransaction(url: string, genesis: string, signature: string, expected: TransactionInstruction, request: typeof fetch = fetch): Promise<{signature:string;slot:number;executedAtSeconds:string}> {
  new PublicKey(genesis);
  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    const response = await request(localRpc(url), {method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'authority-finality',method,params})});
    if (!response.ok) throw new Error('authority RPC unavailable');
    const body = await response.json(); if (body.error) throw new Error('authority RPC: '+JSON.stringify(body.error)); return body.result;
  }
  if (await rpc('getGenesisHash', []) !== genesis) throw new Error('authority genesis mismatch');
  const raw = await rpc('getTransaction', [signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  if (!raw || typeof raw !== 'object' || !('slot' in raw) || !('transaction' in raw) || !('meta' in raw) || !('blockTime' in raw) || typeof raw.blockTime !== 'number' || !Number.isSafeInteger(raw.blockTime)) throw new Error('finalized authority evidence unavailable');
  // Validate the externally observed transaction shape before calling the inspector.
  const tx = raw as V2Transaction;
  if (!Array.isArray(tx.transaction?.message?.accountKeys) || !Array.isArray(tx.transaction.message.instructions) || !Array.isArray(tx.transaction.signatures)) throw new Error('invalid authority transaction');
  inspectAuthorityTransaction(tx, signature, expected);
  return {signature,slot:tx.slot,executedAtSeconds:String(raw.blockTime)};
}
