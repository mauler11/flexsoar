export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface IssuerContext {
  found: boolean;
  [key: string]: unknown;
}
export interface IssuerJwk extends JsonWebKey { kid?: string; alg?: string; use?: string; key_ops?: string[] }

export interface IssuerDatabase {
  consumeIssuerNonce(kid: string, nonce: Uint8Array): Promise<void>;
  subjectContext(kind: 'network' | 'listing' | 'sale' | 'prepare_recovery', id: string | null, networkId: string | null): Promise<IssuerContext>;
  saleSigningContext(saleId: string): Promise<IssuerContext>;
  enrollWalletChecked(userId: string, networkId: string, wallet: Uint8Array, tokenAccount: Uint8Array, proofDigest: Uint8Array): Promise<void>;
  prepareSale(listingId: string, networkId: string, terms: {
    id: string; saleAddress: string; escrowAddress: string; totalUnits: string;
    fxSnapshot: Record<string, unknown>; validFrom: string; expiresAt: string;
  }): Promise<string>;
  recordListing(saleId: string, message: Uint8Array, signature: Uint8Array): Promise<void>;
}

export interface RpcAccount { owner: string; data: Uint8Array; contextSlot: bigint }
export interface IssuerRpc {
  genesis(): Promise<string>;
  finalizedSlot(): Promise<bigint>;
  account(address: string, minContextSlot: bigint): Promise<RpcAccount | null>;
}

export interface FxQuote { providerId: string; quoteId: string; numerator: string; denominator: string; observedAt: string }
export interface FxProvider { quote(): Promise<FxQuote> }

export interface IssuerConfig {
  hmacKeys: ReadonlyMap<string, Uint8Array>; activeHmacKid: string;
  issuer: string; audience: string; jwksUrl: string; jwtKid: string;
  allowList: ReadonlySet<string>; networkId: string; networkGenesis: string; mint: string;
  tokenProgram: string; tokenDecimals: number; program: string; saleAddress(ctx: IssuerContext): string;
  escrowAddress(ctx: IssuerContext): string;
}

export interface IssuerDeps {
  db: IssuerDatabase; rpc: readonly [IssuerRpc, IssuerRpc]; fx: readonly [FxProvider, FxProvider];
  jwks: { get(jwksUrl: string): Promise<readonly IssuerJwk[]> };
  config: IssuerConfig; nowSeconds(): number;
}
