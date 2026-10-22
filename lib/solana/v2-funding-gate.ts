/** Pre-funding gate: the on-chain config must be at least as strict as the database says it is, observed on the cluster you pinned.
 *
 * The program keeps its own `release_delay` and vault state; the database keeps `payment_v2.governance_mode` (082). Nothing else
 * compares them, so a DB in 'solo' mode could be switched on over a program that still has delay 0 or native governance. Run this
 * before any governed action that enables funding. It only reads: it never signs, sends or mutates.
 *
 * Trust model (R2-02, R2-03):
 *  - The database row is UNTRUSTED INPUT. `parseGovernanceModeRows` accepts exactly one row with exactly three fields of exactly
 *    the right JavaScript types, and applies the table's own cross-field rule. Missing, extra, coerced, negative, fractional or
 *    out-of-enum values are refused, never defaulted.
 *  - The RPC is bound to a reviewed deployment manifest: it must report the pinned genesis hash, the config address is DERIVED
 *    here from the pinned program id (never supplied), the program must be executable, the config must be plain data owned by it,
 *    and the decision carries the cluster/program/config/slot it was made on so the funding-enable action can consume the same
 *    identity. Any RPC error or malformed reply is a refusal.
 *  - Only `ok === true` permits approval. Evidence is a snapshot at `target.slot`; the caller must act on it promptly and re-run
 *    the gate if governance changes in between. A malicious RPC that fabricates every reply is outside this model.
 *
 * Offsets (ConfigV2, 819 bytes): discriminator 0, domain 8, governance_vault 488, release_delay 586, pending_vault 594,
 * pending_controller 626, pending_policy 658, layout_version 690, proposal_revision 691, reserved 699. */
import { PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { base58Encode } from './base58';

export const CONFIG_V2_SIZE = 819, CONFIG_LAYOUT_VERSION = 1, SOLO_MIN_DELAY_SECONDS = 86_400;
const CONFIG_DISCRIMINATOR = Uint8Array.from(createHash('sha256').update('account:ConfigV2').digest().subarray(0, 8));
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const allZero = (b: Uint8Array) => b.every(x => x === 0);

export interface GovernanceModeRow { operational_separation: 'separated' | 'solo'; governors_required: 2 | 3; release_delay_seconds: number }
export interface ConfigV2View {
  domain: string; governanceVault: string | null; releaseDelay: bigint; pendingVault: string | null; layoutVersion: number;
  fundingPaused: boolean; outflowPaused: boolean; maxTrade: bigint; maxEscrow: bigint; proposalRevision: bigint;
}
/** The reviewed deployment this gate is allowed to look at. Both come from the pinned manifest, never from the caller's RPC. */
export interface PinnedDeployment { genesisHash: string; programId: string }
export interface GateTarget { genesis: string | null; program: string; config: string | null; slot: number | null }
export interface GateDecision { ok: boolean; failures: string[]; target: GateTarget; config: ConfigV2View | null; mode: GovernanceModeRow | null }
export type GateRpc = (method: string, params: unknown[]) => Promise<unknown>;

/** Strict runtime parse of the `payment_v2.governance_mode` projection. Throws a refusal for anything but one well-formed row. */
export function parseGovernanceModeRows(rows: unknown): GovernanceModeRow {
  if (!Array.isArray(rows)) throw new Error('governance_mode: expected an array of rows');
  if (rows.length !== 1) throw new Error(`governance_mode: expected exactly one row, got ${rows.length}`);
  const row: unknown = rows[0];
  if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('governance_mode: the row is not an object');
  const keys = Object.keys(row).sort().join(',');
  if (keys !== 'governors_required,operational_separation,release_delay_seconds') {
    throw new Error(`governance_mode: the row must have exactly operational_separation, governors_required and release_delay_seconds (got ${keys || 'no fields'})`);
  }
  const r = row as Record<string, unknown>;
  if (r.operational_separation !== 'separated' && r.operational_separation !== 'solo') throw new Error('governance_mode: operational_separation must be "separated" or "solo"');
  if (typeof r.governors_required !== 'number' || (r.governors_required !== 2 && r.governors_required !== 3)) throw new Error('governance_mode: governors_required must be the number 2 or 3');
  if (typeof r.release_delay_seconds !== 'number' || !Number.isSafeInteger(r.release_delay_seconds) || r.release_delay_seconds < 0) {
    throw new Error('governance_mode: release_delay_seconds must be a non-negative safe integer number of SECONDS');
  }
  // The table's own CHECK: solo needs 2 governors and at least a day.
  if (r.operational_separation === 'solo' && (r.governors_required !== 2 || r.release_delay_seconds < SOLO_MIN_DELAY_SECONDS)) {
    throw new Error(`governance_mode: solo requires 2 governors and release_delay_seconds >= ${SOLO_MIN_DELAY_SECONDS}`);
  }
  return { operational_separation: r.operational_separation, governors_required: r.governors_required, release_delay_seconds: r.release_delay_seconds };
}

/** Rejections are not always Error objects (null, strings, plain objects); never read .message off an unknown. */
function errorText(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function strictBool(b: number, name: string): boolean { if (b !== 0 && b !== 1) throw new Error(`${name} is ${b}, expected 0 or 1`); return b === 1; }

/** Strict decode: every boolean must be 0/1 and the discriminator must be ConfigV2's. Throws on anything else. */
export function decodeConfigV2(bytes: Uint8Array): ConfigV2View {
  if (bytes.length !== CONFIG_V2_SIZE) throw new Error(`ConfigV2 must be ${CONFIG_V2_SIZE} bytes, got ${bytes.length}`);
  if (CONFIG_DISCRIMINATOR.some((b, i) => b !== bytes[i])) throw new Error('not a ConfigV2 account (discriminator mismatch)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const key = (o: number) => { const k = bytes.subarray(o, o + 32); return allZero(k) ? null : base58Encode(k); };
  return { domain: base58Encode(bytes.subarray(8, 40)), governanceVault: key(488), releaseDelay: view.getBigInt64(586, true), pendingVault: key(594),
    layoutVersion: bytes[690], fundingPaused: strictBool(bytes[560], 'funding_paused'), outflowPaused: strictBool(bytes[561], 'outflow_paused'),
    maxTrade: view.getBigUint64(562, true), maxEscrow: view.getBigUint64(570, true), proposalRevision: view.getBigUint64(691, true) };
}

/** INTERNAL policy over already-validated inputs; not an approval boundary (no row parsing, no RPC binding). Use checkFundingGate. */
function evaluatePolicy(config: ConfigV2View, db: GovernanceModeRow, expectedGenesis: string): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  if (config.layoutVersion !== CONFIG_LAYOUT_VERSION) failures.push(`config layout_version is ${config.layoutVersion}, expected ${CONFIG_LAYOUT_VERSION}`);
  if (config.domain !== expectedGenesis) failures.push('config domain is not the pinned cluster genesis hash');
  if (config.pendingVault !== null) failures.push('a governance vault proposal is pending; finish or cancel it before funding');
  if (config.releaseDelay < BigInt(db.release_delay_seconds)) failures.push(`on-chain release_delay ${config.releaseDelay}s is shorter than the database's ${db.release_delay_seconds}s`);
  if (db.operational_separation === 'solo') {
    if (config.releaseDelay < BigInt(SOLO_MIN_DELAY_SECONDS)) failures.push(`solo mode needs an on-chain release_delay of at least ${SOLO_MIN_DELAY_SECONDS}s, found ${config.releaseDelay}s`);
    if (config.governanceVault === null) failures.push('solo mode needs the governance vault active on chain; native governance is still in force');
  }
  return { ok: failures.length === 0, failures };
}

interface AccountReply { context: { slot: number }; value: { owner: string; executable: boolean; data: [string, string] } | null }
function accountReply(raw: unknown): AccountReply {
  const r = raw as AccountReply | null;
  if (!r || typeof r !== 'object' || !r.context || !Number.isSafeInteger(r.context.slot) || r.context.slot < 0) throw new Error('malformed account reply (no slot)');
  if (r.value !== null) {
    const v = r.value;
    if (!v || typeof v.owner !== 'string' || typeof v.executable !== 'boolean' || !Array.isArray(v.data) || v.data[1] !== 'base64' || typeof v.data[0] !== 'string') throw new Error('malformed account reply');
  }
  return r;
}

/** Observes the pinned deployment and decides. Every failure it can anticipate (bad row, wrong cluster, RPC rejection of any kind, malformed reply, bad pinned input) comes back as ok:false with a reason; callers must still treat an unexpected exception as a refusal. */
export async function checkFundingGate(rpc: GateRpc, pinned: PinnedDeployment, dbRows: unknown): Promise<GateDecision> {
  const target: GateTarget = { genesis: null, program: typeof pinned?.programId === 'string' ? pinned.programId : '', config: null, slot: null };
  const refuse = (failures: string[], config: ConfigV2View | null = null, mode: GovernanceModeRow | null = null): GateDecision => ({ ok: false, failures, target, config, mode });
  let mode: GovernanceModeRow;
  try { mode = parseGovernanceModeRows(dbRows); } catch (e) { return refuse([errorText(e)]); }
  try {
    if (!pinned || typeof pinned.programId !== 'string' || typeof pinned.genesisHash !== 'string') return refuse(['the pinned deployment (genesisHash, programId) is missing or malformed'], null, mode);
    const program = new PublicKey(pinned.programId), pinnedGenesis = new PublicKey(pinned.genesisHash).toBase58();
    const config = PublicKey.findProgramAddressSync([Buffer.from('config-v2')], program)[0].toBase58();
    target.config = config;
    const genesis = await rpc('getGenesisHash', []);
    if (typeof genesis !== 'string') return refuse(['RPC returned no genesis hash'], null, mode);
    target.genesis = genesis;
    if (genesis !== pinnedGenesis) return refuse([`RPC genesis ${genesis} is not the pinned ${pinnedGenesis}; this is not the cluster that was reviewed`], null, mode);
    const programReply = accountReply(await rpc('getAccountInfo', [pinned.programId, { encoding: 'base64', commitment: 'finalized' }]));
    if (!programReply.value || !programReply.value.executable || programReply.value.owner !== LOADER) return refuse(['the pinned program id is not a deployed upgradeable program on this cluster'], null, mode);
    const reply = accountReply(await rpc('getAccountInfo', [config, { encoding: 'base64', commitment: 'finalized' }]));
    target.slot = reply.context.slot;
    if (!reply.value) return refuse(['config account does not exist'], null, mode);
    if (reply.value.owner !== pinned.programId) return refuse([`config account is owned by ${reply.value.owner}, not the program`], null, mode);
    if (reply.value.executable !== false) return refuse(['config account is marked executable; it must be plain data'], null, mode);
    const bytes = Uint8Array.from(Buffer.from(reply.value.data[0], 'base64'));
    if (bytes.length !== CONFIG_V2_SIZE) return refuse([`config account is ${bytes.length} bytes, expected ${CONFIG_V2_SIZE}`], null, mode);
    const view = decodeConfigV2(bytes), failures: string[] = [];
    // Invariants a program-written account always satisfies; a violation means the account is not what the program produced.
    if (!allZero(bytes.subarray(626, 690))) failures.push('pending controller or policy is not empty');
    if (!allZero(bytes.subarray(699, 819))) failures.push('reserved bytes are not zero');
    const policy = evaluatePolicy(view, mode, pinnedGenesis);
    failures.push(...policy.failures);
    return { ok: failures.length === 0, failures, target, config: view, mode };
  } catch (e) {
    return refuse([`RPC or decoding error, refusing: ${errorText(e)}`], null, mode);
  }
}
