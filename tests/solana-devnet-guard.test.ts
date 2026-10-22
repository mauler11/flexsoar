import { describe, expect, it } from 'vitest';
import { DEVNET_GENESIS, MAINNET_GENESIS, assertDevnetUrl, checkGenesis, guardedConnection } from '@/solana/scripts/devnet-guard.mjs';

const TESTNET = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY';

describe('devnet guard (AGENT_RULES 2b)', () => {
  it('pins the published devnet genesis and the mainnet-beta genesis the rules forbid', () => {
    expect(DEVNET_GENESIS).toBe('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
    expect(MAINNET_GENESIS).toBe('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
  });
  it.each(['https://api.mainnet-beta.solana.com', 'https://MAINNET.example.com', 'http://x.test/rpc?cluster=Mainnet', 'https://devnet.helius-rpc.com/mainnet-proxy'])('refuses an RPC URL containing "mainnet": %s', url => {
    expect(() => assertDevnetUrl(url)).toThrow(/contains "mainnet"/);
  });
  it.each([['no scheme', 'api.devnet.solana.com'], ['not a string', 5 as unknown as string], ['empty', ''], ['ws scheme', 'wss://api.devnet.solana.com']])('refuses a URL that is %s', (_n, url) => {
    expect(() => assertDevnetUrl(url)).toThrow(/explicit http\(s\) URL/);
  });
  it('accepts the public devnet URL', () => { expect(assertDevnetUrl('https://api.devnet.solana.com')).toBe('https://api.devnet.solana.com'); });
  it('pins the first genesis only if it is the published devnet value, and refuses mainnet-beta, testnet and anything else', () => {
    const pin = { value: null as string | null };
    expect(() => checkGenesis(MAINNET_GENESIS, pin)).toThrow(/mainnet-beta genesis/);
    expect(() => checkGenesis(TESTNET, pin)).toThrow(/not the published devnet genesis/);
    expect(() => checkGenesis(undefined as unknown as string, pin)).toThrow(/no genesis/);
    expect(pin.value).toBeNull();
    expect(checkGenesis(DEVNET_GENESIS, pin)).toBe(DEVNET_GENESIS); expect(pin.value).toBe(DEVNET_GENESIS);
    expect(() => checkGenesis(TESTNET, pin)).toThrow(/changed from/);
    expect(() => checkGenesis(MAINNET_GENESIS, pin)).toThrow(/mainnet-beta genesis/);
  });
});

describe('guardedConnection verifies the genesis before every call', () => {
  function fake(genesisSequence: (string | undefined)[]) {
    const calls: string[] = [];
    let n = 0;
    const inner = {
      getGenesisHash: async () => { calls.push('getGenesisHash'); const g = genesisSequence[Math.min(n, genesisSequence.length - 1)]; n++; return g; },
      requestAirdrop: async (...a: unknown[]) => { calls.push('requestAirdrop'); return `airdrop:${a.length}`; },
      sendRawTransaction: async () => { calls.push('sendRawTransaction'); return 'sig'; },
      commitment: 'confirmed',
    };
    return { calls, make: () => inner as never };
  }
  it('fetches the genesis immediately before each action, with no caching', async () => {
    const { calls, make } = fake([DEVNET_GENESIS]), seen: string[] = [];
    const { connection } = guardedConnection('https://api.devnet.solana.com', { make, onAction: n => seen.push(n) });
    await connection.requestAirdrop({} as never, 1); await connection.sendRawTransaction(Buffer.alloc(1));
    expect(calls).toEqual(['getGenesisHash', 'requestAirdrop', 'getGenesisHash', 'sendRawTransaction']);
    expect(seen).toEqual(['requestAirdrop', 'sendRawTransaction']);
    expect((connection as unknown as { commitment: string }).commitment).toBe('confirmed'); // non-function properties pass through
  });
  it('a mainnet-beta genesis stops the very first action and the action is never sent', async () => {
    const { calls, make } = fake([MAINNET_GENESIS]), { connection } = guardedConnection('https://api.devnet.solana.com', { make });
    await expect(connection.sendRawTransaction(Buffer.alloc(1))).rejects.toThrow(/mainnet-beta genesis/);
    expect(calls).toEqual(['getGenesisHash']);
  });
  it('a cluster that is not the published devnet is refused on the first call', async () => {
    const { calls, make } = fake([TESTNET]), { connection } = guardedConnection('https://api.devnet.solana.com', { make });
    await expect(connection.requestAirdrop({} as never, 1)).rejects.toThrow(/not the published devnet genesis/);
    expect(calls).toEqual(['getGenesisHash']);
  });
  it('a genesis that changes mid-session stops the next action', async () => {
    const { calls, make } = fake([DEVNET_GENESIS, TESTNET]), { connection } = guardedConnection('https://api.devnet.solana.com', { make });
    await connection.requestAirdrop({} as never, 1);
    await expect(connection.sendRawTransaction(Buffer.alloc(1))).rejects.toThrow(/changed from/);
    expect(calls).toEqual(['getGenesisHash', 'requestAirdrop', 'getGenesisHash']);
  });
  it('a missing genesis reply stops the action', async () => {
    const { make } = fake([undefined]), { connection } = guardedConnection('https://api.devnet.solana.com', { make });
    await expect(connection.requestAirdrop({} as never, 1)).rejects.toThrow(/no genesis/);
  });
  it('refuses to build a connection for a mainnet URL at all', () => {
    expect(() => guardedConnection('https://api.mainnet-beta.solana.com')).toThrow(/contains "mainnet"/);
  });
});
