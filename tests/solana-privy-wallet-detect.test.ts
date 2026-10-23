import { describe, expect, it } from 'vitest';
import { detectSolanaWallet, isSolanaProofWallet } from '@/lib/solana/privy-wallet-detect';

const SOL = '6J88dRi3T5465bcntkrSWyT3o3bfM7Zd2KNMFPgUFoue';
// Mirrors @privy-io/js-sdk-core ConnectedStandardSolanaWallet: address is a prototype getter, no chainType field.
class FakeConnectedStandardSolanaWallet {
  get address() { return SOL; }
  async signMessage() { return { signature: new Uint8Array(64) }; }
}
const evm = { chainType: 'ethereum', address: '0x1111111111111111111111111111111111111111', signMessage: async () => ({}) };
const base = { privyReady: true, walletsReady: true, authenticated: true };

describe('detectSolanaWallet (PP1)', () => {
  it('finds a Solana-hook wallet (class instance, getter address, no chainType)', () => {
    const r = detectSolanaWallet({ ...base, wallets: [new FakeConnectedStandardSolanaWallet()] });
    expect(r.status).toBe('found');
    if (r.status === 'found') expect(r.address).toBe(SOL);
  });
  it('finds a plain object that declares chainType solana', () => {
    expect(detectSolanaWallet({ ...base, wallets: [{ chainType: 'solana', address: SOL, signMessage: async () => ({}) }] }).status).toBe('found');
  });
  it('picks the Solana wallet out of a mixed list', () => {
    expect(detectSolanaWallet({ ...base, wallets: [evm, new FakeConnectedStandardSolanaWallet()] }).status).toBe('found');
  });
  it('is waiting, not missing, until Privy is ready', () => {
    expect(detectSolanaWallet({ ...base, privyReady: false, wallets: [] })).toEqual({ status: 'waiting' });
  });
  it('is waiting, not missing, until the wallets list is ready (even when empty)', () => {
    expect(detectSolanaWallet({ ...base, walletsReady: false, wallets: [] })).toEqual({ status: 'waiting' });
    expect(detectSolanaWallet({ ...base, walletsReady: false, wallets: [new FakeConnectedStandardSolanaWallet()] })).toEqual({ status: 'waiting' });
  });
  it('is signed-out when ready but not authenticated', () => {
    expect(detectSolanaWallet({ ...base, authenticated: false, wallets: [] })).toEqual({ status: 'signed-out' });
  });
  it('treats an EVM-only list as missing and reports what it saw', () => {
    const r = detectSolanaWallet({ ...base, wallets: [evm] });
    expect(r.status).toBe('missing');
    if (r.status === 'missing') expect(r.seen).toEqual(['ethereum/0x11…1111']);
  });
  it('an empty ready list is missing', () => {
    expect(detectSolanaWallet({ ...base, wallets: [] })).toEqual({ status: 'missing', seen: [] });
  });
  it('rejects look-alikes: wrong chainType with a base58 address, bad address, no signMessage, non-objects', () => {
    expect(isSolanaProofWallet({ chainType: 'ethereum', address: SOL, signMessage: async () => ({}) })).toBe(false);
    expect(isSolanaProofWallet({ address: 'not-a-key', signMessage: async () => ({}) })).toBe(false);
    expect(isSolanaProofWallet({ address: SOL })).toBe(false);
    expect(isSolanaProofWallet(null)).toBe(false);
    expect(isSolanaProofWallet('x')).toBe(false);
  });
});
