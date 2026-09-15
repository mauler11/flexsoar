/**
 * lib/solana/transfers.ts
 *
 * Hand-rolled SPL Token Transfer instruction for the Send/withdraw flow.
 * No @solana/spl-token dependency (human-install only per AGENT_RULES, and
 * the layout below is frozen protocol): keys [source, destination, owner],
 * data [0x01, amount:u64 LE]. Pure and offline-testable — the dialog only
 * adds blockhash, fee payer, and a signature.
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js';

import { TOKEN_PROGRAM_ID, encodeU64 } from './sdk';

/** SPL Token `Transfer` instruction discriminator. */
export const TRANSFER_DISCRIMINATOR = 1;

export function buildUsdcTransferIx(input: {
  sourceAta: string;
  destAta: string;
  owner: string;
  amountUnits: number;
}): TransactionInstruction {
  if (!Number.isInteger(input.amountUnits) || input.amountUnits <= 0) {
    throw new Error(`transfer amount must be a positive integer, got ${input.amountUnits}`);
  }
  const data = Buffer.concat([
    Buffer.from([TRANSFER_DISCRIMINATOR]),
    Buffer.from(encodeU64(input.amountUnits)),
  ]);
  return new TransactionInstruction({
    programId: new PublicKey(TOKEN_PROGRAM_ID),
    keys: [
      { pubkey: new PublicKey(input.sourceAta), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.destAta), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.owner), isSigner: true, isWritable: false },
    ],
    data,
  });
}
