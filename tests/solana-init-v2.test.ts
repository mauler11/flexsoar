import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { CONFIG_SIZE, MAINNET_GENESIS, ROLE_NAMES, buildInitInstruction, initializeV2, parseManifest, preflight, verifyConfig, type InitConnection } from '@/solana/scripts/init-v2.mjs';

const k = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'), TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const bootstrap = Keypair.generate();
const manifestRaw = () => ({
  cluster: 'devnet', genesisHash: k(1).toBase58(), programId: k(2).toBase58(), mint: k(3).toBase58(), domain: k(1).toBase58(),
  policyDigest: createHash('sha256').update('policy').digest('hex'), treasury: k(4).toBase58(), bootstrap: bootstrap.publicKey.toBase58(),
  roles: Object.fromEntries(ROLE_NAMES.map((n, i) => [n, k(10 + i).toBase58()])), governance: [k(30), k(31), k(32)].map(x => x.toBase58()),
});

/** The config the program would write for this manifest (independent of the script's own decoder). */
function expectedConfig(m: ReturnType<typeof parseManifest>): Buffer {
  const b = Buffer.alloc(CONFIG_SIZE);
  m.domain.toBuffer().copy(b, 8); m.policyDigest.copy(b, 40); m.treasury.toBuffer().copy(b, 72); m.mint.toBuffer().copy(b, 104);
  ROLE_NAMES.forEach((n, i) => m.roles[n].toBuffer().copy(b, 136 + 32 * i)); m.governance.forEach((g, i) => g.toBuffer().copy(b, 392 + 32 * i));
  b.writeBigUInt64LE(BigInt(1), 552); b[560] = 1; b[690] = 1; return b;
}

interface World { genesis?: string; programExecutable?: boolean; authority?: PublicKey | null; decimals?: number; owned?: number; configExists?: boolean; chainConfig?: Buffer | null; simErr?: unknown }
function fakeConnection(w: World = {}) {
  const m = parseManifest(manifestRaw()), { config, programData } = buildInitInstruction(m);
  const calls = { sent: 0, simulated: 0 };
  const pd = Buffer.alloc(45); pd.writeUInt32LE(3, 0); const auth = w.authority === undefined ? bootstrap.publicKey : w.authority; if (auth) { pd[12] = 1; auth.toBuffer().copy(pd, 13); }
  const mint = Buffer.alloc(82); mint[44] = w.decimals ?? 6;
  let sent = false;
  const connection: InitConnection = {
    getGenesisHash: async () => w.genesis ?? m.genesisHash.toBase58(),
    getAccountInfo: async key => {
      if (key.equals(m.programId)) return { executable: w.programExecutable ?? true, owner: LOADER, data: Buffer.alloc(36) };
      if (key.equals(programData)) return { owner: LOADER, data: pd };
      if (key.equals(m.mint)) return { owner: TOKEN, data: mint };
      if (key.equals(config)) return sent ? { owner: m.programId, data: w.chainConfig ?? expectedConfig(m) } : (w.configExists ? { owner: m.programId, data: Buffer.alloc(CONFIG_SIZE) } : null);
      return null;
    },
    getProgramAccounts: async () => Array.from({ length: w.owned ?? 0 }, () => ({ pubkey: k(99) })),
    getLatestBlockhash: async () => ({ blockhash: k(5).toBase58(), lastValidBlockHeight: 100 }),
    simulateTransaction: async () => { calls.simulated++; return { value: { err: w.simErr ?? null, logs: ['log'], unitsConsumed: 1234 } }; },
    sendRawTransaction: async () => { calls.sent++; sent = true; return 'sig'; },
    confirmTransaction: async () => ({ value: { err: null } }),
  };
  return { connection, calls, m };
}
const refuses = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);

describe('init-v2 manifest', () => {
  it('accepts a complete manifest and builds the instruction the program decodes', () => {
    const m = parseManifest(manifestRaw()), { instruction, config } = buildInitInstruction(m);
    expect(instruction.data.length).toBe(8 + 32 + 32 + 32 + 256 + 96);
    expect(instruction.data.subarray(0, 8).toString('hex')).toBe(createHash('sha256').update('global:initialize_v2').digest().subarray(0, 8).toString('hex'));
    expect(instruction.keys.map(x => [x.isSigner, x.isWritable])).toEqual([[false, true], [true, true], [false, false], [false, false], [false, false]]);
    expect(config.equals(PublicKey.findProgramAddressSync([Buffer.from('config-v2')], m.programId)[0])).toBe(true);
  });
  it.each([
    ['unknown field', (r: Record<string, unknown>) => ({ ...r, extra: 1 }), /unknown manifest field extra/],
    ['missing field', (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([name]) => name !== 'mint')), /missing mint/],
    ['cluster mainnet-beta label', (r: Record<string, unknown>) => ({ ...r, cluster: 'mainnet-beta' }), /cluster must be/],
    ['mainnet genesis', (r: Record<string, unknown>) => ({ ...r, genesisHash: MAINNET_GENESIS, domain: MAINNET_GENESIS }), /mainnet-beta is not supported/],
    ['domain is not the genesis', (r: Record<string, unknown>) => ({ ...r, domain: k(77).toBase58() }), /domain must equal the pinned genesis/],
    ['all-zero policy digest', (r: Record<string, unknown>) => ({ ...r, policyDigest: '0'.repeat(64) }), /policyDigest/],
    ['a role missing', (r: Record<string, unknown>) => ({ ...r, roles: { issuer: k(10).toBase58() } }), /roles must be exactly/],
    ['two governors the same key', (r: Record<string, unknown>) => ({ ...r, governance: [k(30), k(30), k(32)].map(x => x.toBase58()) }), /duplicate key/],
    ['a governor reuses a role key', (r: Record<string, unknown>) => ({ ...r, governance: [k(30), k(31), k(10)].map(x => x.toBase58()) }), /duplicate key/],
    ['a bad public key', (r: Record<string, unknown>) => ({ ...r, treasury: 'not-a-key' }), /treasury is not a valid public key/],
  ])('refuses: %s', (_name, mutate, re) => { expect(() => parseManifest(mutate(manifestRaw()))).toThrow(re); });
});

describe('init-v2 preflight (nothing is signed until all of it passes)', () => {
  it('passes on a fresh, correctly configured program', async () => { const { connection, m } = fakeConnection(); expect((await preflight(connection, m)).authority.equals(bootstrap.publicKey)).toBe(true); });
  it.each([
    ['RPC genesis differs from the pinned manifest', { genesis: k(66).toBase58() }, /does not match the pinned/],
    ['RPC is mainnet', { genesis: MAINNET_GENESIS }, /does not match the pinned/],
    ['program not deployed as upgradeable', { programExecutable: false }, /not a deployed upgradeable program/],
    ['program is immutable', { authority: null }, /no upgrade authority/],
    ['upgrade authority is someone else', { authority: k(55) }, /upgrade authority is/],
    ['mint has the wrong decimals', { decimals: 9 }, /6 decimals/],
    ['the program id already owns accounts (not fresh)', { owned: 3 }, /already owns 3 account/],
    ['the config already exists', { configExists: true }, /config account already exists/],
  ] as [string, World, RegExp][])('refuses: %s', async (_n, world, re) => { const { connection, m } = fakeConnection(world); await refuses(preflight(connection, m), re); });
});

describe('init-v2 run', () => {
  it('dry run simulates, reports the plan and sends nothing, with no key supplied', async () => {
    const { connection, calls } = fakeConnection(), r = await initializeV2({ connection, manifest: manifestRaw(), dryRun: true });
    expect(r.dryRun).toBe(true); expect(r.unitsConsumed).toBe(1234); expect(calls).toEqual({ sent: 0, simulated: 1 }); expect(r.plan.accounts[1].signer).toBe(true);
  });
  it('a failed simulation is a refusal', async () => { const { connection, calls } = fakeConnection({ simErr: { InstructionError: [0, 'Custom'] } }); await refuses(initializeV2({ connection, manifest: manifestRaw(), dryRun: true }), /simulation failed/); expect(calls.sent).toBe(0); });
  it('a real run needs the manifest bootstrap key and sends nothing otherwise', async () => {
    const { connection, calls } = fakeConnection();
    await refuses(initializeV2({ connection, manifest: manifestRaw(), dryRun: false }), /not the manifest bootstrap key/);
    await refuses(initializeV2({ connection, manifest: manifestRaw(), dryRun: false, bootstrap: Keypair.generate() }), /not the manifest bootstrap key/);
    expect(calls.sent).toBe(0);
  });
  it('sends once and verifies the config read back from chain', async () => {
    const { connection, calls } = fakeConnection(), r = await initializeV2({ connection, manifest: manifestRaw(), dryRun: false, bootstrap });
    expect(r.verified).toBe(true); expect(r.signature).toBe('sig'); expect(calls.sent).toBe(1);
  });
  it('refuses on ANY single differing field of the read-back config', async () => {
    const m = parseManifest(manifestRaw()), good = expectedConfig(m);
    expect(() => verifyConfig(good, m)).not.toThrow();
    const flips: [string, number][] = [['domain', 8], ['policy', 40], ['treasury', 72], ['mint', 104], ['issuer', 136], ['guardian', 136 + 32 * 7], ['governance[0]', 392], ['governance[2]', 392 + 64],
      ['governance_vault', 488], ['governance_policy', 520], ['epoch', 552], ['funding_paused', 560], ['outflow_paused', 561], ['max_trade', 562], ['max_escrow', 570], ['outstanding', 578],
      ['release_delay', 586], ['pending_vault', 594], ['pending_controller', 626], ['pending_policy', 658], ['layout_version', 690], ['reserved first byte', 691], ['reserved last byte', 818]];
    for (const [name, offset] of flips) { const bad = Buffer.from(good); bad[offset] ^= 1; expect(() => verifyConfig(bad, m), name).toThrow(/differs from the manifest|zero|layout_version|reserved/); }
    expect(() => verifyConfig(good.subarray(0, 594), m)).toThrow(/594 bytes, expected 819/);
    const { connection, calls } = fakeConnection({ chainConfig: (() => { const b = Buffer.from(good); b[560] = 0; return b; })() });
    await refuses(initializeV2({ connection, manifest: manifestRaw(), dryRun: false, bootstrap }), /funding_paused: on chain 0, manifest 1/);
    expect(calls.sent).toBe(1); // it was sent; the refusal is the read-back, and it is loud
  });
});
