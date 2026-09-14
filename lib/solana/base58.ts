/**
 * lib/solana/base58.ts
 *
 * Minimal base58 decode (Bitcoin alphabet) for Solana addresses and
 * signatures. Hand-rolled because @solana/web3.js is not installed yet
 * (DEPS.md — human installs) and the settle path must verify with zero
 * new dependencies. Tested against known vectors below in
 * tests/solana-settle.test.ts.
 */

const ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Decode a base58 string to bytes. Throws on invalid characters. */
export function base58Decode(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);
  // Leading '1's are zero bytes — counted here, skipped by the loop.
  let zeros = 0;
  while (zeros < input.length && input[zeros] === '1') zeros++;

  const bytes: number[] = [];
  for (let i = zeros; i < input.length; i++) {
    const digit = ALPHABET.indexOf(input[i]);
    if (digit < 0) {
      throw new Error(`invalid base58 character at index ${i}`);
    }
    let carry = digit;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[out.length - 1 - i] = bytes[i];
  }
  return out;
}

/** A Solana address decodes to exactly 32 bytes — anything else is rejected. */
export function decodeAddress(input: string): Uint8Array {
  const bytes = base58Decode(input);
  if (bytes.length !== 32) {
    throw new Error(`solana address must decode to 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

/** Encode bytes to base58 (Bitcoin alphabet). Inverse of base58Decode. */
export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  // All-zero input is just leading ones — the digit loop below would add
  // one more spurious '1' for the zero value itself.
  if (zeros === bytes.length) return '1'.repeat(bytes.length);
  const digits: number[] = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = '';
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return '1'.repeat(zeros) + out;
}
