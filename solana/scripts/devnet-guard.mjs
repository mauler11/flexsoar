/** Devnet guard for AGENT_RULES.md section 2b (Devnet exception). Every script that talks to a cluster goes through this.
 *
 *  - An RPC URL containing "mainnet" (any case) is refused before a connection exists.
 *  - The first call pins the cluster genesis hash; it must equal the published DEVNET genesis, and the mainnet-beta genesis is refused always.
 *  - Before EVERY other RPC call the genesis is fetched again and must equal the pinned value. There is no cache and no bypass flag.
 *  - Nothing here reads keys, environment variables or default wallets. Key files are read only by callers, from an explicit path.
 *
 * Wrapping is by Proxy over a web3.js Connection, so any method (including ones added later) is covered. */
import { Connection } from '@solana/web3.js';

/** Published Solana devnet genesis hash (https://docs.solana.com / `solana genesis-hash --url devnet`). */
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const refuse = message => { throw new Error(`devnet-guard refused: ${message}`); };

export function assertDevnetUrl(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) refuse('the RPC URL must be an explicit http(s) URL');
  if (/mainnet/i.test(url)) refuse('the RPC URL contains "mainnet"');
  return url;
}

/** Checks one genesis value against the pin. The first value seen becomes the pin and must be the devnet genesis. */
export function checkGenesis(genesis, pin) {
  if (typeof genesis !== 'string') refuse('the RPC returned no genesis hash');
  if (genesis === MAINNET_GENESIS) refuse('the RPC reports the mainnet-beta genesis');
  if (pin.value === null) {
    if (genesis !== DEVNET_GENESIS) refuse(`the RPC genesis ${genesis} is not the published devnet genesis`);
    pin.value = genesis;
  } else if (genesis !== pin.value) refuse(`the RPC genesis changed from ${pin.value} to ${genesis}`);
  return genesis;
}

/** A Connection whose every method first re-verifies the genesis. `onAction(name)` is told about each guarded call (for logs). */
export function guardedConnection(url, { commitment = 'confirmed', onAction = null, make = (u, c) => new Connection(u, c) } = {}) {
  assertDevnetUrl(url);
  const inner = make(url, commitment), pin = { value: null };
  const verify = async () => checkGenesis(await inner.getGenesisHash(), pin);
  const proxy = new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || prop === 'constructor') return value;
      if (prop === 'getGenesisHash') return async () => verify();
      return async (...args) => { await verify(); if (onAction) onAction(String(prop)); return value.apply(target, args); };
    },
  });
  return { connection: proxy, pin, verify };
}
