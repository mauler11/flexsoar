import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { CONFIG_V2_SIZE, checkFundingGate, decodeConfigV2, evaluateFundingGate, type GovernanceModeRow } from '@/lib/solana/v2-funding-gate';
import { discriminator } from '@/lib/solana/v2-sdk';
import { decodeConfig as scriptDecode } from '@/solana/scripts/init-v2.mjs';

const GENESIS = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const PROGRAM = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
const CONFIG = new PublicKey(new Uint8Array(32).fill(8)).toBase58();
const SOLO: GovernanceModeRow = { operational_separation: 'solo', governors_required: 2, release_delay_seconds: 86_400 };
const SEPARATED: GovernanceModeRow = { operational_separation: 'separated', governors_required: 3, release_delay_seconds: 0 };

async function configBytes(o: { delay?: bigint; vault?: number; pending?: number; layout?: number; domain?: number; size?: number } = {}): Promise<Uint8Array> {
  const b = new Uint8Array(o.size ?? CONFIG_V2_SIZE); b.set(await discriminator('account:ConfigV2'));
  b.fill(o.domain ?? 7, 8, 40);
  if (o.vault) b.fill(o.vault, 488, 520);
  const view = new DataView(b.buffer); view.setBigInt64(586, o.delay ?? BigInt(0), true);
  if (o.pending) b.fill(o.pending, 594, 626);
  b[690] = o.layout ?? 1; b[560] = 1; return b;
}
const rpcFor = (bytes: Uint8Array | null, owner = PROGRAM) => async (method: string) => {
  if (method !== 'getAccountInfo') throw new Error(method);
  return { value: bytes && { owner, data: [Buffer.from(bytes).toString('base64'), 'base64'] } };
};

describe('pre-funding gate: on-chain config vs database governance_mode', () => {
  it('passes a solo database over a program with the 24 h delay and an active vault', async () => {
    const r = await checkFundingGate(rpcFor(await configBytes({ delay: BigInt(86_400), vault: 5 })), PROGRAM, CONFIG, SOLO, GENESIS);
    expect(r.failures).toEqual([]); expect(r.ok).toBe(true); expect(r.config?.releaseDelay).toBe(BigInt(86_400));
  });
  it('refuses solo over a program that still has delay 0 and native governance (the gap this gate exists for)', async () => {
    const r = await checkFundingGate(rpcFor(await configBytes()), PROGRAM, CONFIG, SOLO, GENESIS);
    expect(r.ok).toBe(false);
    expect(r.failures.join('|')).toMatch(/shorter than the database's 86400s/);
    expect(r.failures.join('|')).toMatch(/at least 86400s/);
    expect(r.failures.join('|')).toMatch(/vault active on chain/);
  });
  it('refuses when the on-chain delay is shorter than the database delay in any mode', async () => {
    const r = await checkFundingGate(rpcFor(await configBytes({ delay: BigInt(3_599) })), PROGRAM, CONFIG, { ...SEPARATED, release_delay_seconds: 3_600 }, GENESIS);
    expect(r.failures).toEqual(["on-chain release_delay 3599s is shorter than the database's 3600s"]);
    expect((await checkFundingGate(rpcFor(await configBytes({ delay: BigInt(3_600) })), PROGRAM, CONFIG, { ...SEPARATED, release_delay_seconds: 3_600 }, GENESIS)).ok).toBe(true);
  });
  it('separated mode with delay 0 on both sides passes, with or without a vault', async () => {
    expect((await checkFundingGate(rpcFor(await configBytes()), PROGRAM, CONFIG, SEPARATED, GENESIS)).ok).toBe(true);
    expect((await checkFundingGate(rpcFor(await configBytes({ vault: 5 })), PROGRAM, CONFIG, SEPARATED, GENESIS)).ok).toBe(true);
  });
  it('refuses a pending vault proposal, a wrong layout version, a wrong cluster and a solo database with 3 governors', async () => {
    expect((await checkFundingGate(rpcFor(await configBytes({ pending: 4 })), PROGRAM, CONFIG, SEPARATED, GENESIS)).failures[0]).toMatch(/proposal is pending/);
    expect((await checkFundingGate(rpcFor(await configBytes({ layout: 2 })), PROGRAM, CONFIG, SEPARATED, GENESIS)).failures[0]).toMatch(/layout_version is 2/);
    expect((await checkFundingGate(rpcFor(await configBytes({ domain: 1 })), PROGRAM, CONFIG, SEPARATED, GENESIS)).failures[0]).toMatch(/pinned cluster genesis/);
    const r = evaluateFundingGate(decodeConfigV2(await configBytes({ delay: BigInt(86_400), vault: 5 })), { ...SOLO, governors_required: 3 }, GENESIS);
    expect(r.failures).toEqual(['solo mode needs exactly 2 governors in the database']);
  });
  it('treats a missing, foreign, wrong-size or wrong-type account as a failure, never a pass', async () => {
    expect((await checkFundingGate(rpcFor(null), PROGRAM, CONFIG, SEPARATED, GENESIS)).failures).toEqual(['config account does not exist']);
    expect((await checkFundingGate(rpcFor(await configBytes(), CONFIG), PROGRAM, CONFIG, SEPARATED, GENESIS)).failures[0]).toMatch(/owned by/);
    expect((await checkFundingGate(rpcFor(await configBytes({ size: 594 })), PROGRAM, CONFIG, SEPARATED, GENESIS)).failures[0]).toMatch(/594 bytes, expected 819/);
    const wrongType = await configBytes(); wrongType[0] ^= 1;
    expect((await checkFundingGate(rpcFor(wrongType), PROGRAM, CONFIG, SEPARATED, GENESIS)).failures).toEqual(['config account is not a ConfigV2']);
  });
  it('decodes the same bytes the init script reads back (two decoders, one layout)', async () => {
    const b = await configBytes({ delay: BigInt(86_400), vault: 5, pending: 4 }), ts = decodeConfigV2(b), js = scriptDecode(b);
    expect(ts.domain).toBe(js.domain.toBase58()); expect(ts.governanceVault).toBe(js.governanceVault.toBase58());
    expect(ts.pendingVault).toBe(js.pendingVault.toBase58()); expect(ts.releaseDelay).toBe(js.releaseDelay); expect(ts.layoutVersion).toBe(js.layoutVersion);
  });
});
