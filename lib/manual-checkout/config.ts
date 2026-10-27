import 'server-only';
import allowlist from '@/config/manual-checkout.json';
import { base58Decode } from '@/lib/solana/base58';

export type ManualCheckoutStatus = 'open' | 'reserved' | 'unavailable';

export function manualCheckoutStatus(listingId: string): ManualCheckoutStatus {
  if (process.env.MANUAL_CHECKOUT_ENABLED !== 'true') return 'unavailable';
  if (!Object.hasOwn(allowlist, listingId)) return 'unavailable';
  const entry: unknown = Reflect.get(allowlist, listingId);
  if (!entry || typeof entry !== 'object' || !('status' in entry)) return 'unavailable';
  return entry.status === 'open' || entry.status === 'reserved' ? entry.status : 'unavailable';
}

export function manualPaymentConfig() {
  const address = process.env.MANUAL_USDC_ADDRESS?.trim();
  if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) || base58Decode(address).length !== 32) {
    throw new Error('MANUAL_USDC_ADDRESS must be configured with a Solana address');
  }
  const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://flexsoar.net');
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('NEXT_PUBLIC_SITE_URL must be an HTTPS URL');
  return { address, qrUrl: `${origin.origin}/payments/duitnow-qr.png` };
}
