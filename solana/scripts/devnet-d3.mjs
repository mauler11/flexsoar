/** D3 devnet rehearsal driver (AGENT_RULES 2b Devnet exception, task d3). DEVNET ONLY, behind the genesis guard on every RPC call.
 *
 *   node solana/scripts/devnet-d3.mjs <step> [args]
 *
 * Keys are read only from the per-task folder (devnet-keys.mjs KEY_DIR), by explicit name; they are never printed or logged. Every
 * step appends a record (signatures, addresses, results; no keys) to the rehearsal log outside the repository. A failed check throws
 * and the process exits 1: nothing here retries a refused check or weakens one. */
import { Keypair, PublicKey } from '@solana/web3.js';
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { guardedConnection } from './devnet-guard.mjs';
import { devnetCli, wslPath, RPC } from './devnet-cli.mjs';
import { keyPath } from './devnet-keys.mjs';

export const LOG = 'C:\\Users\\Family\\flexsoar-reviews\\devnet-20261023\\rehearsal-log.md';
export const PROGRAM_ID = 'HRqab2EMDcJKfkc4J88sxc4GVZyq5m3gNU43WMsa5Ve1';
export const SQUADS = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
export const B_SHA256 = '61da352f0a316f8a20f0e0690bc659854b00af260761ade1f6538d1da411defc';
export const B_SIZE = 573824;
export const B_SO = 'C:\\Users\\Family\\flexsoar-payment-security\\solana\\target\\d2\\B\\flexsoar_settlement.so';
export const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
export const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export const log = text => appendFileSync(LOG, `${text}\n`);
export const loadKey = name => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath(name), 'utf8'))));
export const pubkeyOf = name => loadKey(name).publicKey;
const calls = [];
export const { connection, verify } = guardedConnection(RPC, { onAction: n => calls.push(n) });
export const pause = ms => new Promise(r => setTimeout(r, ms));

/** Sends a signed transaction and waits for the recorded status; throws on any chain error or if it never lands. */
export async function land(tx, label) {
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
  for (let i = 0; i < 90; i++) {
    const s = (await connection.getSignatureStatuses([signature])).value[0];
    if (s?.err) throw new Error(`${label} failed on chain: ${JSON.stringify(s.err)} (${signature})`);
    if (s && ['confirmed', 'finalized'].includes(s.confirmationStatus)) { log(`- tx ${label}: \`${signature}\` ${s.confirmationStatus}`); return signature; }
    await pause(1000);
  }
  throw new Error(`${label} did not land: ${signature}`);
}
export const sha256 = buf => createHash('sha256').update(buf).digest('hex');
export { devnetCli, wslPath };
