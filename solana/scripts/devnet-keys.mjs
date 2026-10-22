/** Generates THROWAWAY devnet keys into C:\Users\Family\flexsoar-devnet-keys\ (AGENT_RULES 2b). Prints public keys only.
 *
 *   node solana/scripts/devnet-keys.mjs            create every missing key, never overwrite one
 *
 * Refuses to run if the key directory is inside the repository or inside flexsoar-reviews. Secret bytes are written once to the key
 * file (JSON array, the same format `solana-keygen` uses) and never logged, returned or re-read here. */
import { Keypair } from '@solana/web3.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export const KEY_DIR = 'C:\\Users\\Family\\flexsoar-devnet-keys';
/** Role and ceremony names. The governance and upgrade multisigs use DIFFERENT keys for the same three "people" (founder amendment (c)). */
export const KEY_NAMES = ['deployer', 'program', 'issuer', 'inventory', 'receiver', 'authenticator', 'reviewer', 'release', 'reconciler', 'guardian',
  'native_founder', 'native_friend', 'native_ceremony', 'treasury', 'test_mint',
  'gov_founder', 'gov_friend', 'gov_recovery', 'gov_create_key', 'upg_founder', 'upg_friend', 'upg_recovery', 'upg_create_key'];

export function assertKeyDirSafe(dir = KEY_DIR) {
  const abs = resolve(dir).toLowerCase();
  for (const forbidden of ['c:\\users\\family\\flexsoar-payment-security', 'c:\\users\\family\\flexsoar-reviews', 'c:\\users\\family\\flexsoar']) {
    if (abs === forbidden || abs.startsWith(forbidden + sep)) throw new Error(`devnet-keys refused: ${dir} is inside ${forbidden}`);
  }
  return resolve(dir);
}
export const keyPath = (name, dir = KEY_DIR) => `${assertKeyDirSafe(dir)}${sep}${name}.json`;

/** Creates any missing key file; returns { name: publicKeyBase58 } for the ones created now. Existing files are never touched. */
export function createMissingKeys(names = KEY_NAMES, dir = KEY_DIR) {
  const base = assertKeyDirSafe(dir); mkdirSync(base, { recursive: true });
  const created = {};
  for (const name of names) {
    const file = keyPath(name, dir);
    if (existsSync(file)) continue;
    const kp = Keypair.generate();
    writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { flag: 'wx', mode: 0o600 });
    created[name] = kp.publicKey.toBase58();
  }
  return created;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  const created = createMissingKeys();
  console.log(JSON.stringify({ keyDir: KEY_DIR, createdNow: created, countCreated: Object.keys(created).length }, null, 2));
}
