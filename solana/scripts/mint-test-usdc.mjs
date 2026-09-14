/**
 * solana/scripts/mint-test-usdc.mjs
 *
 * Devnet test-USDC mint for end-to-end buys (no faucet-mint roulette):
 * creates a fresh 6-decimal mint under the admin keypair, ensures the
 * treasury/seller/buyer ATAs exist, and funds the BUYER with test USDC.
 * Prints the MINT address — that value becomes SOLANA_USDC_MINT.
 *
 *   cd ~/solana-scripts && npm i @solana/spl-token
 *   cp ~/flexsoar/solana/scripts/mint-test-usdc.mjs ./
 *   SELLER=<seller-wallet> BUYER=<buyer-wallet> node mint-test-usdc.mjs
 *
 * Env (defaults match the project runbook):
 *   SOLANA_RPC_URL, SOLANA_ADMIN_KEYPAIR (~/.config/solana/id.json),
 *   TREASURY (default deployer wallet), SELLER, BUYER (both required),
 *   AMOUNT_UNITS (default 1000000000 = 1000 test-USDC to the buyer).
 *
 * Mint authority stays with the admin keypair, so more can be minted
 * later with AMOUNT_UNITS + the same MINT (rerun with MINT set to skip
 * creating a new mint — see below). Devnet only, never mainnet.
 */

import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const ADMIN_KEYPAIR_PATH =
  process.env.SOLANA_ADMIN_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`;
const TREASURY = new PublicKey(
  process.env.SOLANA_TREASURY ?? "98Hi2uh9Py7tL5Cm39ZCqimjTWAFjqMBJJXnivwbdqok",
);
const SELLER = new PublicKey(process.env.SELLER ?? "");
const BUYER = new PublicKey(process.env.BUYER ?? "");
const AMOUNT = Number(process.env.AMOUNT_UNITS ?? 1_000_000_000);

const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(ADMIN_KEYPAIR_PATH, "utf8"))),
);
const connection = new Connection(RPC_URL, "confirmed");

const mint = await createMint(connection, admin, admin.publicKey, null, 6);
console.log("MINT=" + mint.toBase58());

for (const [label, owner] of [["treasury", TREASURY], ["seller", SELLER], ["buyer", BUYER]]) {
  const ata = await getOrCreateAssociatedTokenAccount(connection, admin, mint, owner);
  console.log(`${label} ATA: ${ata.address.toBase58()}`);
}

const buyerAta = await getOrCreateAssociatedTokenAccount(connection, admin, mint, BUYER);
await mintTo(connection, admin, mint, buyerAta.address, admin, AMOUNT);
console.log(`minted ${AMOUNT} base units to buyer; set SOLANA_USDC_MINT=${mint.toBase58()}`);
