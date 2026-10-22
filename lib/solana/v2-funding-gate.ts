/** Pre-funding gate: the on-chain config must be at least as strict as the database says it is.
 *
 * The program keeps its own `release_delay` and vault state; the database keeps `payment_v2.governance_mode` (082). Nothing else
 * compares them, so a DB in 'solo' mode could be switched on over a program that still has delay 0 or native governance. Run
 * this before any governed action that enables funding. It only reads: it never signs, sends or mutates.
 *
 * Offsets (ConfigV2, 819 bytes): domain 8, governance_vault 488, release_delay 586, pending_vault 594, layout_version 690. */
import { discriminator } from './v2-sdk';
import { base58Encode } from './base58';

export const CONFIG_V2_SIZE = 819, CONFIG_LAYOUT_VERSION = 1, SOLO_MIN_DELAY_SECONDS = 86_400;
const isZero = (b: Uint8Array) => b.every(x => x === 0);

export interface GovernanceModeRow { operational_separation: 'separated' | 'solo'; governors_required: number; release_delay_seconds: number }
export interface ConfigV2View {
  domain: string; governanceVault: string | null; releaseDelay: bigint; pendingVault: string | null; layoutVersion: number;
  fundingPaused: boolean; outflowPaused: boolean; maxTrade: bigint; maxEscrow: bigint;
}
export interface GateResult { ok: boolean; failures: string[]; config: ConfigV2View | null }
export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

export function decodeConfigV2(bytes: Uint8Array): ConfigV2View {
  if (bytes.length !== CONFIG_V2_SIZE) throw new Error(`ConfigV2 must be ${CONFIG_V2_SIZE} bytes, got ${bytes.length}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const key = (o: number) => { const k = bytes.subarray(o, o + 32); return isZero(k) ? null : base58Encode(k); };
  return { domain: base58Encode(bytes.subarray(8, 40)), governanceVault: key(488), releaseDelay: view.getBigInt64(586, true), pendingVault: key(594),
    layoutVersion: bytes[690], fundingPaused: bytes[560] === 1, outflowPaused: bytes[561] === 1, maxTrade: view.getBigUint64(562, true), maxEscrow: view.getBigUint64(570, true) };
}

/** Pure policy: every failure is reported, not just the first, so an operator sees the whole gap at once. */
export function evaluateFundingGate(config: ConfigV2View, db: GovernanceModeRow, expectedGenesis: string): GateResult {
  const failures: string[] = [];
  if (config.layoutVersion !== CONFIG_LAYOUT_VERSION) failures.push(`config layout_version is ${config.layoutVersion}, expected ${CONFIG_LAYOUT_VERSION}`);
  if (config.domain !== expectedGenesis) failures.push('config domain is not the pinned cluster genesis hash');
  if (config.pendingVault !== null) failures.push('a governance vault proposal is pending; finish or replace it before funding');
  if (config.releaseDelay < BigInt(db.release_delay_seconds)) failures.push(`on-chain release_delay ${config.releaseDelay}s is shorter than the database's ${db.release_delay_seconds}s`);
  if (db.operational_separation === 'solo') {
    if (config.releaseDelay < BigInt(SOLO_MIN_DELAY_SECONDS)) failures.push(`solo mode needs an on-chain release_delay of at least ${SOLO_MIN_DELAY_SECONDS}s, found ${config.releaseDelay}s`);
    if (config.governanceVault === null) failures.push('solo mode needs the governance vault active on chain; native governance is still in force');
    if (db.governors_required !== 2) failures.push('solo mode needs exactly 2 governors in the database');
  }
  return { ok: failures.length === 0, failures, config };
}

function bytesOf(value: unknown): Uint8Array | null {
  const v = value as { value?: { owner?: string; data?: [string, string] } | null } | null;
  if (!v?.value?.data || v.value.data[1] !== 'base64') return null;
  return Uint8Array.from(Buffer.from(v.value.data[0], 'base64'));
}

/** Reads the config PDA at finalized commitment and evaluates the gate. A missing/foreign/misshapen account is a failure, never a pass. */
export async function checkFundingGate(rpc: Rpc, program: string, configAddress: string, db: GovernanceModeRow, expectedGenesis: string): Promise<GateResult> {
  const reply = await rpc('getAccountInfo', [configAddress, { encoding: 'base64', commitment: 'finalized' }]) as { value?: { owner?: string } | null };
  if (!reply?.value) return { ok: false, failures: ['config account does not exist'], config: null };
  if (reply.value.owner !== program) return { ok: false, failures: [`config account is owned by ${reply.value.owner}, not the program`], config: null };
  const bytes = bytesOf(reply);
  if (!bytes || bytes.length !== CONFIG_V2_SIZE) return { ok: false, failures: [`config account is ${bytes?.length ?? 'unreadable'} bytes, expected ${CONFIG_V2_SIZE}`], config: null };
  const wanted = await discriminator('account:ConfigV2');
  if (wanted.some((b, i) => b !== bytes[i])) return { ok: false, failures: ['config account is not a ConfigV2'], config: null };
  return evaluateFundingGate(decodeConfigV2(bytes), db, expectedGenesis);
}
