import type { Connection } from '@solana/web3.js';

export const DEVNET_GENESIS: string;
export const MAINNET_GENESIS: string;
export function assertDevnetUrl(url: string): string;
export function checkGenesis(genesis: string, pin: { value: string | null }): string;
export function guardedConnection(url: string, options?: { commitment?: string; onAction?: ((name: string) => void) | null; make?: (url: string, commitment: string) => Connection }):
  { connection: Connection; pin: { value: string | null }; verify: () => Promise<string> };
