/** Squads v4 helpers for the devnet rehearsals (AGENT_RULES 2b). Built ONLY from `multisig.instructions.*` and our own transaction sender:
 * the SDK `rpc.*` wrappers failed from this client in D3 (see solana-d3.md) and are not used. Every call goes through the genesis guard. */
import * as multisig from '@sqds/multisig';
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { connection, log, loadKey, pause } from './devnet-d3.mjs';

export const fence = '```';

/** One v0 transaction, fee payer `deployer`; waits for the recorded status. A chain error throws unless allowFail. */
export async function sendIxs(instructions, signers, label, { allowFail = false, lookupTables = [], payerName = 'deployer' } = {}) {
  const payer = loadKey(payerName);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables));
  tx.sign([payer, ...signers]);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  for (let i = 0; i < 90; i++) {
    const s = (await connection.getSignatureStatuses([signature])).value[0];
    if (s && ['confirmed', 'finalized'].includes(s.confirmationStatus)) {
      const t = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      log(`- tx ${label}: \`${signature}\` err=${JSON.stringify(s.err)}${s.err ? `\n${fence}\n${(t?.meta?.logMessages ?? []).join('\n').slice(-2500)}\n${fence}` : ''}`);
      if (s.err && !allowFail) throw new Error(`${label} failed on chain: ${JSON.stringify(s.err)} (${signature})`);
      return { signature, err: s.err, logs: t?.meta?.logMessages ?? [] };
    }
    await pause(1000);
  }
  throw new Error(`${label} did not land: ${signature}`);
}

/** create + propose + approve x2 (stages 1-4). `signers` are key NAMES; the first creates and approves, the second approves. */
export async function proposeAndApprove({ name, ms, vault, signers, index, message, label }) {
  const [s1, s2] = signers.map(loadKey), payer = loadKey('deployer');
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const transactionMessage = new TransactionMessage({ payerKey: vault, recentBlockhash: blockhash, instructions: [message] });
  await sendIxs([multisig.instructions.vaultTransactionCreate({ multisigPda: ms, transactionIndex: index, creator: s1.publicKey, rentPayer: payer.publicKey, vaultIndex: 0, ephemeralSigners: 0, transactionMessage, memo: label })], [s1], `${name} vaultTransactionCreate`);
  await sendIxs([multisig.instructions.proposalCreate({ multisigPda: ms, creator: s1.publicKey, rentPayer: payer.publicKey, transactionIndex: index })], [s1], `${name} proposalCreate`);
  await sendIxs([multisig.instructions.proposalApprove({ multisigPda: ms, transactionIndex: index, member: s1.publicKey })], [s1], `${name} approve 1`);
  await sendIxs([multisig.instructions.proposalApprove({ multisigPda: ms, transactionIndex: index, member: s2.publicKey })], [s2], `${name} approve 2`);
}

/** Execute stage. Returns { ok, signature, err, logs } without throwing on a chain error. */
export async function executeStage({ name, ms, index, member }) {
  const m = loadKey(member);
  const { instruction, lookupTableAccounts } = await multisig.instructions.vaultTransactionExecute({ connection, multisigPda: ms, transactionIndex: index, member: m.publicKey });
  const r = await sendIxs([instruction], [m], `${name} EXECUTE`, { allowFail: true, lookupTables: lookupTableAccounts });
  return { ok: !r.err, signature: r.signature, err: r.err, logs: r.logs };
}

export async function viaSquads(opts) {
  await proposeAndApprove(opts);
  return executeStage({ name: opts.name, ms: opts.ms, index: opts.index, member: opts.signers[2] });
}

export const nextIndex = async ms => BigInt((await multisig.accounts.Multisig.fromAccountAddress(connection, ms)).transactionIndex) + 1n;
export const pdas = createKeyPubkey => { const [ms] = multisig.getMultisigPda({ createKey: createKeyPubkey }); const [vault] = multisig.getVaultPda({ multisigPda: ms, index: 0 }); return { ms, vault }; };
