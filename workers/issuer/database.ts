import { paymentRpc, type PaymentRpc } from '@/lib/db/payment-v2';
import type { IssuerContext, IssuerDatabase } from './types';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid issuer database context');
  return value as Record<string, unknown>;
}
function bytea(value: Uint8Array): string { return `\\x${Buffer.from(value).toString('hex')}`; }

/** Dedicated issuer RPC adapter. It accepts only the payment_v2_issuer transport. */
export function createIssuerDatabase(transport: PaymentRpc): IssuerDatabase {
  return {
    async consumeIssuerNonce(kid, nonce) {
      await paymentRpc(transport, 'fn_payment_v2_consume_issuer_nonce', { p_kid: kid, p_nonce: bytea(nonce) });
    },
    async subjectContext(kind, id, networkId) {
      return object(await paymentRpc(transport, 'fn_payment_v2_issuer_subject_context', { p_kind: kind, p_subject_id: id, p_network_id: networkId })) as IssuerContext;
    },
    async saleSigningContext(saleId) {
      const value = object(await paymentRpc(transport, 'fn_payment_v2_issuer_context', { p_sale_id: saleId, p_action: 'open_sale' }));
      return { ...value, found: true, quoteTotalUnits: value.totalUnits, quoteValidFrom: value.validFrom, quoteExpiresAt: value.expiresAt, sellerWallet: value.seller };
    },
    async enrollWalletChecked(userId, networkId, wallet, tokenAccount, proofDigest) {
      await paymentRpc(transport, 'fn_payment_v2_issuer_enroll_wallet_checked', {
        p_user: userId, p_network: networkId, p_wallet: bytea(wallet), p_token_account: bytea(tokenAccount), p_proof_digest: bytea(proofDigest),
      });
    },
    async prepareSale(listingId, networkId, terms) {
      const value = await paymentRpc(transport, 'fn_payment_v2_prepare_sale', { p_listing_id: listingId, p_network_id: networkId, p_terms: terms });
      if (typeof value !== 'string') throw new Error('invalid prepared sale identity');
      return value;
    },
    async recordListing(saleId, message, signature) {
      await paymentRpc(transport, 'fn_payment_v2_record_listing', { p_sale: saleId, p_message: bytea(message), p_signature: bytea(signature) });
    },
  };
}
