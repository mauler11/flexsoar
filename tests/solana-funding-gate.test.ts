import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { CONFIG_V2_SIZE, checkFundingGate, decodeConfigV2, parseGovernanceModeRows, type GateRpc, type PinnedDeployment } from '@/lib/solana/v2-funding-gate';
import { decodeConfig as scriptDecode } from '@/solana/scripts/init-v2.mjs';

const GENESIS = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const PROGRAM = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
const PINNED: PinnedDeployment = { genesisHash: GENESIS, programId: PROGRAM };
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const CONFIG = PublicKey.findProgramAddressSync([Buffer.from('config-v2')], new PublicKey(PROGRAM))[0].toBase58();
const SLOT = 4_242;
const DISC = createHash('sha256').update('account:ConfigV2').digest().subarray(0, 8);
const SOLO = [{ operational_separation: 'solo', governors_required: 2, release_delay_seconds: 86_400 }];
const SEPARATED = [{ operational_separation: 'separated', governors_required: 3, release_delay_seconds: 0 }];

function configBytes(o: { delay?: bigint; vault?: number; pendingVault?: number; pendingController?: number; pendingPolicy?: number; layout?: number; domain?: number; size?: number;
  funding?: number; outflow?: number; reserved?: number; disc?: boolean; revision?: bigint } = {}): Uint8Array {
  const b = new Uint8Array(o.size ?? CONFIG_V2_SIZE); if (o.disc !== false) b.set(DISC);
  b.fill(o.domain ?? 7, 8, 40);
  if (o.vault) b.fill(o.vault, 488, 520);
  const view = new DataView(b.buffer); view.setBigInt64(586, o.delay ?? BigInt(0), true);
  if (o.pendingVault) b.fill(o.pendingVault, 594, 626);
  if (o.pendingController) b.fill(o.pendingController, 626, 658);
  if (o.pendingPolicy) b.fill(o.pendingPolicy, 658, 690);
  b[690] = o.layout ?? 1; b[560] = o.funding ?? 1; b[561] = o.outflow ?? 0;
  if (b.length >= 699) view.setBigUint64(691, o.revision ?? BigInt(0), true);
  if (o.reserved) b[699 + 5] = o.reserved;
  return b;
}
interface World { genesis?: unknown; programExecutable?: boolean; programOwner?: string; config?: Uint8Array | null; configOwner?: string; configExecutable?: boolean; throwAt?: string; badReply?: boolean }
function world(w: World = {}) {
  const calls: { method: string; params: unknown[] }[] = [];
  const rpc: GateRpc = async (method, params) => {
    calls.push({ method, params });
    if (w.throwAt === method) throw new Error(`boom in ${method}`);
    if (method === 'getGenesisHash') return w.genesis === undefined ? GENESIS : w.genesis;
    if (method !== 'getAccountInfo') throw new Error(`unexpected ${method}`);
    if (w.badReply) return { value: null };
    const address = params[0];
    if (address === PROGRAM) return { context: { slot: SLOT }, value: { owner: w.programOwner ?? LOADER, executable: w.programExecutable ?? true, data: ['', 'base64'] } };
    if (address === CONFIG) {
      const bytes = w.config === undefined ? configBytes({ delay: BigInt(86_400), vault: 5 }) : w.config;
      return { context: { slot: SLOT }, value: bytes && { owner: w.configOwner ?? PROGRAM, executable: w.configExecutable ?? false, data: [Buffer.from(bytes).toString('base64'), 'base64'] } };
    }
    throw new Error(`the gate asked for an account it should not know: ${String(address)}`);
  };
  return { rpc, calls };
}
const fails = async (w: World, rows: unknown, re: RegExp) => { const { rpc } = world(w); const d = await checkFundingGate(rpc, PINNED, rows); expect(d.ok).toBe(false); expect(d.failures.join(' | ')).toMatch(re); return d; };

describe('R2-02: the database row is untrusted input and is parsed at runtime', () => {
  it('accepts exactly the three valid shapes the table can hold', () => {
    expect(parseGovernanceModeRows(SOLO)).toEqual(SOLO[0]);
    expect(parseGovernanceModeRows(SEPARATED)).toEqual(SEPARATED[0]);
    expect(parseGovernanceModeRows([{ operational_separation: 'separated', governors_required: 2, release_delay_seconds: 3_600 }]).release_delay_seconds).toBe(3_600);
  });
  it.each([
    ['not an array', { operational_separation: 'solo' }, /expected an array/],
    ['no rows', [], /exactly one row, got 0/],
    ['two rows', [SOLO[0], SOLO[0]], /exactly one row, got 2/],
    ['a null row', [null], /not an object/],
    ['an array row', [[1, 2, 3]], /not an object/],
    ['an empty object', [{}], /must have exactly/],
    ['only the seconds (the review\'s partial row)', [{ release_delay_seconds: 0 }], /must have exactly/],
    ['mode missing', [{ governors_required: 3, release_delay_seconds: 0 }], /must have exactly/],
    ['an extra field', [{ ...SEPARATED[0], id: 'x' }], /must have exactly/],
    ['a misspelled field', [{ operational_separation: 'solo', governors_required: 2, release_delay_second: 86_400 }], /must have exactly/],
    ['mode not in the enum', [{ ...SEPARATED[0], operational_separation: 'Solo' }], /operational_separation must be/],
    ['mode empty', [{ ...SEPARATED[0], operational_separation: '' }], /operational_separation must be/],
    ['mode null', [{ ...SEPARATED[0], operational_separation: null }], /operational_separation must be/],
    ['mode a number', [{ ...SEPARATED[0], operational_separation: 1 }], /operational_separation must be/],
    ['governors as a string', [{ ...SEPARATED[0], governors_required: '3' }], /governors_required must be the number/],
    ['governors as a bigint', [{ ...SEPARATED[0], governors_required: BigInt(3) }], /governors_required must be the number/],
    ['governors boolean', [{ ...SEPARATED[0], governors_required: true }], /governors_required must be the number/],
    ['governors 4', [{ ...SEPARATED[0], governors_required: 4 }], /governors_required must be the number/],
    ['governors 1', [{ ...SEPARATED[0], governors_required: 1 }], /governors_required must be the number/],
    ['governors 0', [{ ...SEPARATED[0], governors_required: 0 }], /governors_required must be the number/],
    ['seconds as a string', [{ ...SEPARATED[0], release_delay_seconds: '86400' }], /release_delay_seconds must be a non-negative/],
    ['seconds as an empty string (BigInt("") would coerce to 0)', [{ ...SEPARATED[0], release_delay_seconds: '' }], /release_delay_seconds must be a non-negative/],
    ['seconds false (BigInt(false) would coerce to 0)', [{ ...SEPARATED[0], release_delay_seconds: false }], /release_delay_seconds must be a non-negative/],
    ['seconds as a bigint', [{ ...SEPARATED[0], release_delay_seconds: BigInt(86_400) }], /release_delay_seconds must be a non-negative/],
    ['seconds null', [{ ...SEPARATED[0], release_delay_seconds: null }], /release_delay_seconds must be a non-negative/],
    ['seconds negative', [{ ...SEPARATED[0], release_delay_seconds: -1 }], /release_delay_seconds must be a non-negative/],
    ['seconds fractional', [{ ...SEPARATED[0], release_delay_seconds: 1.5 }], /release_delay_seconds must be a non-negative/],
    ['seconds NaN', [{ ...SEPARATED[0], release_delay_seconds: NaN }], /release_delay_seconds must be a non-negative/],
    ['seconds Infinity', [{ ...SEPARATED[0], release_delay_seconds: Infinity }], /release_delay_seconds must be a non-negative/],
    ['seconds beyond the safe integers', [{ ...SEPARATED[0], release_delay_seconds: Number.MAX_SAFE_INTEGER + 1 }], /release_delay_seconds must be a non-negative/],
    ['solo with 3 governors', [{ operational_separation: 'solo', governors_required: 3, release_delay_seconds: 86_400 }], /solo requires 2 governors/],
    ['solo with under a day', [{ operational_separation: 'solo', governors_required: 2, release_delay_seconds: 86_399 }], /solo requires 2 governors/],
    ['solo with zero seconds', [{ operational_separation: 'solo', governors_required: 2, release_delay_seconds: 0 }], /solo requires 2 governors/],
  ] as [string, unknown, RegExp][])('refuses: %s', (_name, rows, re) => { expect(() => parseGovernanceModeRows(rows)).toThrow(re); });
  it('a malformed row stops the gate before it touches the RPC', async () => {
    const { rpc, calls } = world(), d = await checkFundingGate(rpc, PINNED, [{ release_delay_seconds: 0 }]);
    expect(d.ok).toBe(false); expect(d.failures[0]).toMatch(/must have exactly/); expect(calls).toEqual([]); expect(d.mode).toBeNull();
  });
});

describe('R2-03: the observation is bound to the pinned cluster, program and derived config', () => {
  it('passes a solo database over the 24 h delay and an active vault, and reports exactly what it observed', async () => {
    const { rpc, calls } = world(), d = await checkFundingGate(rpc, PINNED, SOLO);
    expect(d.failures).toEqual([]); expect(d.ok).toBe(true);
    expect(d.target).toEqual({ genesis: GENESIS, program: PROGRAM, config: CONFIG, slot: SLOT });
    expect(d.config?.releaseDelay).toBe(BigInt(86_400)); expect(d.mode).toEqual(SOLO[0]);
    expect(calls.map(c => c.method)).toEqual(['getGenesisHash', 'getAccountInfo', 'getAccountInfo']);
    expect(calls[2].params[0]).toBe(CONFIG); // derived inside the gate from the pinned program id; there is no way to pass an address in
  });
  it('refuses a cluster whose genesis is not the pinned one (a clone carrying a compliant config)', async () => {
    const other = new PublicKey(new Uint8Array(32).fill(8)).toBase58(), { rpc, calls } = world({ genesis: other }), d = await checkFundingGate(rpc, PINNED, SOLO);
    expect(d.ok).toBe(false); expect(d.failures[0]).toMatch(/is not the pinned .*not the cluster that was reviewed/); expect(d.target.genesis).toBe(other);
    expect(calls.map(c => c.method)).toEqual(['getGenesisHash']); // nothing else is read from a cluster that failed the binding
  });
  it('refuses when the genesis reply is not a string', async () => { await fails({ genesis: 123 }, SOLO, /no genesis hash/); });
  it.each([['getGenesisHash'], ['getAccountInfo']])('an RPC error at %s is a refusal, never a pass and never an exception', async method => {
    const d = await fails({ throwAt: method }, SOLO, /RPC or decoding error, refusing: boom in/); expect(d.ok).toBe(false);
  });
  it('refuses a malformed account reply', async () => { await fails({ badReply: true }, SOLO, /RPC or decoding error.*malformed account reply/); });
  it('refuses a program id that is not an executable upgradeable program', async () => {
    await fails({ programExecutable: false }, SOLO, /not a deployed upgradeable program/);
    await fails({ programOwner: PROGRAM }, SOLO, /not a deployed upgradeable program/);
  });
  it('refuses a config that does not exist, is foreign, is executable, or has the wrong size or type', async () => {
    await fails({ config: null }, SOLO, /config account does not exist/);
    await fails({ configOwner: CONFIG }, SOLO, /owned by .*not the program/);
    await fails({ configExecutable: true }, SOLO, /marked executable/);
    await fails({ config: configBytes({ size: 594 }) }, SOLO, /594 bytes, expected 819/);
    await fails({ config: configBytes({ delay: BigInt(86_400), vault: 5, disc: false }) }, SOLO, /discriminator mismatch/);
    const wrong = configBytes({ delay: BigInt(86_400), vault: 5 }); wrong[3] ^= 1;
    await fails({ config: wrong }, SOLO, /discriminator mismatch/);
  });
  it('requires strict booleans: any pause byte other than 0 or 1 is refused', async () => {
    await fails({ config: configBytes({ delay: BigInt(86_400), vault: 5, funding: 2 }) }, SOLO, /funding_paused is 2, expected 0 or 1/);
    await fails({ config: configBytes({ delay: BigInt(86_400), vault: 5, outflow: 255 }) }, SOLO, /outflow_paused is 255, expected 0 or 1/);
  });
  it('requires an empty pending slot and zero reserved bytes', async () => {
    await fails({ config: configBytes({ delay: BigInt(86_400), vault: 5, pendingVault: 4 }) }, SOLO, /proposal is pending/);
    await fails({ config: configBytes({ delay: BigInt(86_400), vault: 5, pendingController: 4 }) }, SOLO, /pending controller or policy is not empty/);
    await fails({ config: configBytes({ delay: BigInt(86_400), vault: 5, pendingPolicy: 4 }) }, SOLO, /pending controller or policy is not empty/);
    await fails({ config: configBytes({ delay: BigInt(86_400), vault: 5, reserved: 1 }) }, SOLO, /reserved bytes are not zero/);
  });
});

describe('the policy itself (on-chain config vs database governance_mode)', () => {
  it('refuses solo over delay 0 and native governance, listing every gap at once', async () => {
    const d = await fails({ config: configBytes() }, SOLO, /shorter than the database's 86400s/);
    expect(d.failures.join('|')).toMatch(/at least 86400s/); expect(d.failures.join('|')).toMatch(/vault active on chain/);
  });
  it('refuses an on-chain delay shorter than the database delay in any mode', async () => {
    const rows = [{ operational_separation: 'separated', governors_required: 3, release_delay_seconds: 3_600 }];
    const d = await fails({ config: configBytes({ delay: BigInt(3_599) }) }, rows, /shorter than the database's 3600s/); expect(d.failures).toHaveLength(1);
    const { rpc } = world({ config: configBytes({ delay: BigInt(3_600) }) }); expect((await checkFundingGate(rpc, PINNED, rows)).ok).toBe(true);
  });
  it('separated mode with delay 0 on both sides passes, with or without a vault', async () => {
    for (const config of [configBytes(), configBytes({ vault: 5 })]) { const { rpc } = world({ config }); expect((await checkFundingGate(rpc, PINNED, SEPARATED)).ok).toBe(true); }
  });
  it('refuses a wrong layout version and a config whose domain is not the pinned genesis', async () => {
    await fails({ config: configBytes({ layout: 2 }) }, SEPARATED, /layout_version is 2/);
    await fails({ config: configBytes({ domain: 1 }) }, SEPARATED, /pinned cluster genesis/);
  });
  it('decodes the same bytes the init script reads back (two decoders, one layout)', () => {
    const b = configBytes({ delay: BigInt(86_400), vault: 5, pendingVault: 4, revision: BigInt(9) }), ts = decodeConfigV2(b), js = scriptDecode(b);
    expect(ts.domain).toBe(js.domain.toBase58()); expect(ts.governanceVault).toBe(js.governanceVault.toBase58());
    expect(ts.pendingVault).toBe(js.pendingVault.toBase58()); expect(ts.releaseDelay).toBe(js.releaseDelay); expect(ts.layoutVersion).toBe(js.layoutVersion);
    expect(ts.proposalRevision).toBe(BigInt(9)); expect(js.proposalRevision).toBe(BigInt(9)); expect(js.discriminatorOk).toBe(true);
  });
});

describe('R3: the gate returns a refusal for rejections that are not Error objects and for malformed pinned input', () => {
  it.each([['null', null], ['undefined', undefined], ['a string', 'plain string rejection'], ['a plain object', { code: 429 }]])('an RPC rejection with %s is ok:false', async (_n, reason) => {
    const rpc: GateRpc = async () => { throw reason; };
    const d = await checkFundingGate(rpc, PINNED, SOLO);
    expect(d.ok).toBe(false); expect(d.failures[0]).toMatch(/^RPC or decoding error, refusing: /);
  });
  it.each([['null', null], ['undefined', undefined], ['an empty object', {}], ['a numeric program id', { genesisHash: GENESIS, programId: 5 }], ['a missing genesis', { programId: PROGRAM }]])('a pinned deployment that is %s is ok:false', async (_n, pinned) => {
    const { rpc, calls } = world(), d = await checkFundingGate(rpc, pinned as unknown as PinnedDeployment, SOLO);
    expect(d.ok).toBe(false); expect(d.failures[0]).toMatch(/pinned deployment .* missing or malformed/); expect(calls).toEqual([]);
  });
  it('a pinned program id that is not a public key is refused, not thrown', async () => {
    const { rpc } = world(), d = await checkFundingGate(rpc, { genesisHash: GENESIS, programId: 'not-a-key' }, SOLO);
    expect(d.ok).toBe(false); expect(d.failures[0]).toMatch(/RPC or decoding error, refusing/);
  });
});
