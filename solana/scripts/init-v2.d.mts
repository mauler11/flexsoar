import type { Connection, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';

export const MAINNET_GENESIS: string;
export const ROLE_NAMES: readonly string[];
export const CONFIG_SIZE: number;
export const LAYOUT_VERSION: number;

export interface ParsedManifest {
  cluster: 'devnet' | 'localnet'; genesisHash: PublicKey; programId: PublicKey; mint: PublicKey; domain: PublicKey; policyDigest: Buffer;
  treasury: PublicKey; bootstrap: PublicKey; roles: Record<string, PublicKey>; governance: PublicKey[];
}
export interface DecodedConfig {
  domain: PublicKey; policy: Uint8Array; treasury: PublicKey; mint: PublicKey; roles: PublicKey[]; governance: PublicKey[]; governanceVault: PublicKey;
  governancePolicyZero: boolean; epoch: bigint; fundingPaused: number; outflowPaused: number; maxTrade: bigint; maxEscrow: bigint; outstanding: bigint;
  releaseDelay: bigint; pendingVault: PublicKey; pendingController: PublicKey; pendingPolicyZero: boolean; layoutVersion: number; reservedZero: boolean;
}
export interface InitConnection {
  getGenesisHash(): Promise<string>;
  getAccountInfo(key: PublicKey, commitment?: string): Promise<{ executable?: boolean; owner: PublicKey; data: Buffer } | null>;
  getProgramAccounts(key: PublicKey, config?: unknown): Promise<{ pubkey: PublicKey }[]>;
  getLatestBlockhash(commitment?: string): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  simulateTransaction(tx: unknown): Promise<{ value: { err: unknown; logs?: string[] | null; unitsConsumed?: number } }>;
  sendRawTransaction(raw: Buffer | Uint8Array): Promise<string>;
  confirmTransaction(args: unknown, commitment?: string): Promise<{ value: { err: unknown } }>;
}
export function parseManifest(raw: unknown): ParsedManifest;
export function buildInitInstruction(m: ParsedManifest): { instruction: TransactionInstruction; config: PublicKey; programData: PublicKey };
export function preflight(connection: InitConnection | Connection, m: ParsedManifest): Promise<{ genesis: string; config: PublicKey; programData: PublicKey; authority: PublicKey }>;
export function decodeConfig(bytes: Uint8Array): DecodedConfig;
export function verifyConfig(bytes: Uint8Array, m: ParsedManifest): DecodedConfig;
export function initializeV2(args: { connection: InitConnection | Connection; manifest: unknown; bootstrap?: Keypair | null; dryRun?: boolean; commitment?: string }):
  Promise<{ dryRun: boolean; plan: { programId: string; config: string; genesis: string; instructionDataHex: string; accounts: { pubkey: string; signer: boolean; writable: boolean }[] }; unitsConsumed?: number | null; signature?: string; verified?: boolean }>;
