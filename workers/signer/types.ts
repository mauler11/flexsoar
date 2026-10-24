import type { AddressLookupTableAccount } from '@solana/web3.js';

export interface SignerLookupTablePin {
  address: string;
  owner: string;
  addresses: readonly string[];
  addressesSha256: string;
  lastExtendedSlot: string;
  deactivationSlot: string;
}

export interface SignerPins {
  issuer: string;
  program: string;
  genesis: string;
  mint: string;
  tokenProgram: string;
  associatedTokenProgram: string;
  systemProgram: string;
  rentSysvar: string;
  instructionsSysvar: string;
  ed25519Program: string;
  lookupTables: readonly SignerLookupTablePin[];
  maxBlockhashAge: number;
  maxFloorToleranceBps: number;
}

export interface SignerAlert {
  operation: 'open-sale-pair' | 'buy-sale';
  requestId: string;
  refusalCode: string;
}

export interface SignerAlertSink {
  deliver(event: SignerAlert): Promise<void>;
}

export interface SignerClock {
  nowSeconds(): number;
}

export interface SignerRuntimeConfig {
  custodyMode: 'key-file';
  custodyRoot: string;
  pinsFilePath: string;
  initializationMarkerPath: string;
  secretKeyPath: string;
  issuerPublicKey: string;
  allowedPeerUid: number;
  allowedPeerPid: number;
  signerUid: number;
  signerGid: number;
  socketGroupGid: number;
  socketPath: string;
  rateJournalPath: string;
  auditPath: string;
  alertQueuePath: string;
  pins: SignerPins;
  /** Same-UID custody is only for local development and requires both this pin and the process flag. */
  devOnly?: true;
}

export interface OpenSalePairSignRequest {
  kind: 'open-sale-pair';
  requestId: string;
  saleId: string;
  permitBase64url: string;
  listingMessageBase64url: string;
  sellerSignatureBase64url: string;
  blockhash: string;
  currentBlockHeight: string;
  currentSlot: string;
  blockhashBlockHeight: string;
  transactionBase64url: string;
}

export interface BuySaleSignRequest {
  kind: 'buy-sale';
  requestId: string;
  attemptId: string;
  permitSha256: string;
  permitBase64url: string;
  blockhash: string;
  currentBlockHeight: string;
  currentSlot: string;
  blockhashBlockHeight: string;
  transactionBase64url: string;
}

export type SignRequest = OpenSalePairSignRequest | BuySaleSignRequest;
export interface SignResponse { signedTransactionBase64url: string }

export interface LoadedLookupTable {
  account: AddressLookupTableAccount;
  pin: SignerLookupTablePin;
}
