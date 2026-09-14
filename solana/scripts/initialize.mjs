/**
 * solana/scripts/initialize.mjs
 *
 * One-time program init (devnet): creates the config PDA holding
 * (admin, treasury, paused=false). Without this, every `buy` fails —
 * the program reads a config account that does not exist yet.
 *
 * Run from a scratch dir with @solana/web3.js installed (NOT from the
 * repo — the repo must stay free of keypair material):
 *
 *   mkdir -p ~/solana-scripts && cd ~/solana-scripts
 *   npm init -y && npm i @solana/web3.js@1
 *   cp ~/flexsoar/solana/scripts/initialize.mjs ./
 *   SOLANA_TREASURY=<treasury-wallet> node initialize.mjs
 *
 * Env (all have devnet defaults matching the project runbook):
 *   SOLANA_RPC_URL      — default https://api.devnet.solana.com
 *   SOLANA_PROGRAM_ID   — default the devnet deployment
 *   SOLANA_ADMIN_KEYPAIR — default ~/.config/solana/id.json (payer + admin)
 *   SOLANA_TREASURY     — default the deployer wallet (devnet only;
 *                         mainnet uses the Squads multisig, never this)
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.SOLANA_PROGRAM_ID ??
    "CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF",
);
const ADMIN_KEYPAIR_PATH =
  process.env.SOLANA_ADMIN_KEYPAIR ??
  `${process.env.HOME}/.config/solana/id.json`;
const TREASURY = new PublicKey(
  process.env.SOLANA_TREASURY ?? "98Hi2uh9Py7tL5Cm39ZCqimjTWAFjqMBJJXnivwbdqok",
);

/** Anchor discriminator: sha256("global:<name>")[0..8]. */
function sighash(name) {
  return createHash("sha256").update(`global:${name}`, "utf8").digest().subarray(0, 8);
}

const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(ADMIN_KEYPAIR_PATH, "utf8"))),
);
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);

// Account order mirrors the program's Initialize struct exactly:
// config (init) -> admin (payer+signer) -> treasury -> system_program.
const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: TREASURY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.from(sighash("initialize")),
});

const connection = new Connection(RPC_URL, "confirmed");
const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin]);
console.log("initialize success:", sig);
console.log("config PDA:", config.toBase58());
console.log("admin:", admin.publicKey.toBase58());
console.log("treasury:", TREASURY.toBase58());
