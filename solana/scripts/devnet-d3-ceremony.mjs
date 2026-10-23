/** D3 ceremony steps 6-8 (devnet only, behind the genesis guard). usage: node solana/scripts/devnet-d3-ceremony.mjs <step>
 * Squads side uses @sqds/multisig 2.1.3. Every step logs public values only. A refused check throws; nothing is retried or relaxed. */
import * as multisig from '@sqds/multisig';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { connection, verify, log, loadKey, pubkeyOf, land, sha256, devnetCli, wslPath, PROGRAM_ID, SQUADS, pause } from './devnet-d3.mjs';
import { keyPath } from './devnet-keys.mjs';

const program = new PublicKey(PROGRAM_ID), squads = new PublicKey(SQUADS);
const config = PublicKey.findProgramAddressSync([Buffer.from('config-v2')], program)[0];
const disc = n => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);
const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
const i64 = n => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const fence = '```';
const deployer = () => loadKey('deployer');
const GOV = ['gov_founder', 'gov_friend', 'gov_recovery'], UPG = ['upg_founder', 'upg_friend', 'upg_recovery'];
const pdas = createKey => { const [ms] = multisig.getMultisigPda({ createKey: pubkeyOf(createKey) }); const [vault] = multisig.getVaultPda({ multisigPda: ms, index: 0 }); return { ms, vault }; };

async function waitSig(signature, label) {
  for (let i = 0; i < 90; i++) {
    const s = (await connection.getSignatureStatuses([signature])).value[0];
    if (s?.err) throw new Error(`${label} failed on chain: ${JSON.stringify(s.err)} (${signature})`);
    if (s && ['confirmed', 'finalized'].includes(s.confirmationStatus)) { log(`- tx ${label}: \`${signature}\``); return signature; }
    await pause(1000);
  }
  throw new Error(`${label} did not land: ${signature}`);
}
const readConfig = async () => Buffer.from((await connection.getAccountInfo(config)).data);
const configView = b => ({ length: b.length, fundingPaused: b[560], layoutVersion: b[690], maxTrade: b.readBigUInt64LE(562).toString(), maxEscrow: b.readBigUInt64LE(570).toString(),
  outstanding: b.readBigUInt64LE(578).toString(), releaseDelay: b.readBigInt64LE(586).toString(), governanceVault: new PublicKey(b.subarray(488, 520)).toBase58(),
  pendingVault: new PublicKey(b.subarray(594, 626)).toBase58(), pendingController: new PublicKey(b.subarray(626, 658)).toBase58(), proposalRevision: b.readBigUInt64LE(691).toString(),
  governance: [0, 1, 2].map(i => new PublicKey(b.subarray(392 + 32 * i, 424 + 32 * i)).toBase58()) });

/** Sends a native-governance instruction signed by native_founder + native_friend; skipPreflight so a refusal lands and is recorded. Returns { signature, err }. */
async function nativeCall(name, data, label) {
  const f = loadKey('native_founder'), g = loadKey('native_friend'), payer = deployer();
  const ix = new TransactionInstruction({ programId: program, keys: [meta(config, false, true), meta(f.publicKey, true), meta(g.publicKey, true)], data: Buffer.concat([disc(name), ...data]) });
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash }).add(ix); tx.sign(payer, f, g);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  for (let i = 0; i < 90; i++) {
    const s = (await connection.getSignatureStatuses([signature])).value[0];
    if (s && ['confirmed', 'finalized'].includes(s.confirmationStatus)) { log(`- native ${label}: \`${signature}\` err=${JSON.stringify(s.err)}`); return { signature, err: s.err }; }
    await pause(1000);
  }
  throw new Error(`${label} did not land: ${signature}`);
}

/** Sends instructions as one v0 transaction (fee payer = deployer) and waits for the recorded status. Never throws on a CHAIN error when allowFail is set. */
async function sendIxs(instructions, signers, label, { allowFail = false, lookupTables = [] } = {}) {
  const payer = deployer();
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

/** Runs one instruction through a Squads vault transaction (create, propose, approve x2, execute). Returns the execute outcome without throwing on a chain error. */
async function viaSquads({ name, ms, vault, signers, index, message, label }) {
  const [s1, s2, s3] = signers.map(loadKey), payer = deployer();
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const transactionMessage = new TransactionMessage({ payerKey: vault, recentBlockhash: blockhash, instructions: [message] });
  await sendIxs([multisig.instructions.vaultTransactionCreate({ multisigPda: ms, transactionIndex: index, creator: s1.publicKey, rentPayer: payer.publicKey, vaultIndex: 0, ephemeralSigners: 0, transactionMessage, memo: label })], [s1], `${name} vaultTransactionCreate`);
  await sendIxs([multisig.instructions.proposalCreate({ multisigPda: ms, creator: s1.publicKey, rentPayer: payer.publicKey, transactionIndex: index })], [s1], `${name} proposalCreate`);
  await sendIxs([multisig.instructions.proposalApprove({ multisigPda: ms, transactionIndex: index, member: s1.publicKey })], [s1], `${name} approve 1`);
  await sendIxs([multisig.instructions.proposalApprove({ multisigPda: ms, transactionIndex: index, member: s2.publicKey })], [s2], `${name} approve 2`);
  const { instruction, lookupTableAccounts } = await multisig.instructions.vaultTransactionExecute({ connection, multisigPda: ms, transactionIndex: index, member: s3.publicKey });
  const r = await sendIxs([instruction], [s3], `${name} EXECUTE`, { allowFail: true, lookupTables: lookupTableAccounts });
  return { ok: !r.err, signature: r.signature, err: r.err, logs: r.logs };
}

const steps = {
  /** 6b: create both multisigs and run the Squads checklist against the on-chain accounts, recording actual field values. */
  async squads() {
    await verify();
    const sq = await connection.getAccountInfo(squads);
    if (!sq?.executable) throw new Error('STOP: Squads program is not deployed on devnet');
    const pcPda = multisig.getProgramConfigPda({})[0];
    const pc = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, pcPda);
    log(`\n## D3 Squads setup + checklist (@sqds/multisig 2.1.3)\n- Squads program \`${SQUADS}\` executable on devnet, owner \`${sq.owner.toBase58()}\`\n- ProgramConfig \`${pcPda.toBase58()}\`: treasury \`${pc.treasury.toBase58()}\`, multisigCreationFee ${pc.multisigCreationFee}, authority \`${pc.authority.toBase58()}\``);
    for (const [label, createKey, names] of [['governance', 'gov_create_key', GOV], ['upgrade', 'upg_create_key', UPG]]) {
      const { ms } = pdas(createKey);
      if (!(await connection.getAccountInfo(ms))) {
        const sig = await multisig.rpc.multisigCreateV2({ connection, treasury: pc.treasury, createKey: loadKey(createKey), creator: deployer(), multisigPda: ms, configAuthority: null, threshold: 2,
          members: names.map(n => ({ key: pubkeyOf(n), permissions: multisig.types.Permissions.all() })), timeLock: 0, rentCollector: null, memo: `d3 ${label}` });
        await waitSig(sig, `create ${label} multisig`);
      }
    }
    const report = {};
    for (const [label, createKey, names] of [['governance', 'gov_create_key', GOV], ['upgrade', 'upg_create_key', UPG]]) {
      const { ms, vault } = pdas(createKey);
      const info = await connection.getAccountInfo(ms);
      const m = await multisig.accounts.Multisig.fromAccountAddress(connection, ms);
      const [vaultAgain] = multisig.getVaultPda({ multisigPda: ms, index: 0 });
      const expected = names.map(n => pubkeyOf(n).toBase58());
      const members = m.members.map(x => ({ key: x.key.toBase58(), mask: x.permissions.mask }));
      const checks = {
        ownerIsSquads: info.owner.equals(squads), threshold2: m.threshold === 2, threeExactMembers: members.length === 3 && expected.every(k => members.some(x => x.key === k)),
        allPermissionsMask7: members.every(x => x.mask === 7), noMemberIsRoleOrCeremonyKey: members.every(x => !['issuer', 'inventory', 'receiver', 'authenticator', 'reviewer', 'release', 'reconciler', 'guardian', 'native_founder', 'native_friend', 'native_ceremony', 'deployer', 'treasury'].some(n => pubkeyOf(n).toBase58() === x.key)),
        configAuthorityIsDefault: m.configAuthority.equals(PublicKey.default), timeLock: m.timeLock, rentCollector: m.rentCollector ? m.rentCollector.toBase58() : null,
        vaultPdaRecomputed: vaultAgain.equals(vault), transactionIndex: Number(m.transactionIndex), staleTransactionIndex: Number(m.staleTransactionIndex), indicesEqual: String(m.transactionIndex) === String(m.staleTransactionIndex),
      };
      report[label] = { multisig: ms.toBase58(), vault0: vault.toBase58(), createKey: pubkeyOf(createKey).toBase58(), members, checks };
    }
    const overlap = report.governance.members.filter(x => report.upgrade.members.some(y => y.key === x.key));
    report.differentKeysBetweenMultisigs = overlap.length === 0;
    log(`${fence}json\n${JSON.stringify(report, null, 2)}\n${fence}`);
    console.log(JSON.stringify(report, null, 2));
    for (const label of ['governance', 'upgrade']) {
      const c = report[label].checks;
      if (!(c.ownerIsSquads && c.threshold2 && c.threeExactMembers && c.noMemberIsRoleOrCeremonyKey && c.vaultPdaRecomputed && c.indicesEqual)) throw new Error(`STOP: ${label} multisig checklist failed`);
    }
    if (!report.differentKeysBetweenMultisigs) throw new Error('STOP: governance and upgrade multisigs share a member');
  },

  /** 6a + 6c: native set_release_delay, propose the vault, read the pending slot, prove native governance still works. */
  async propose() {
    await verify();
    const before = configView(await readConfig());
    if (before.length !== 819 || before.layoutVersion !== 1 || before.fundingPaused !== 1 || before.maxTrade !== '0' || before.maxEscrow !== '0') throw new Error(`STOP: unexpected config ${JSON.stringify(before)}`);
    log(`\n## D3 step 5 read-back by hand\n- config \`${config.toBase58()}\`: ${JSON.stringify(before)}`);
    const a = await nativeCall('set_release_delay', [i64(86400)], '6a set_release_delay(86400)');
    if (a.err) throw new Error(`STOP: 6a failed ${JSON.stringify(a.err)}`);
    const { ms, vault } = pdas('gov_create_key');
    const policy = createHash('sha256').update(`d3-governance-multisig:${ms.toBase58()}:threshold2:members:${GOV.map(n => pubkeyOf(n).toBase58()).join(',')}`).digest();
    const p = await nativeCall('propose_governance_vault', [vault.toBuffer(), squads.toBuffer(), policy], '6c propose_governance_vault(GV, Squads, policy)');
    if (p.err) throw new Error(`STOP: 6c propose failed ${JSON.stringify(p.err)}`);
    const pending = configView(await readConfig());
    if (pending.pendingVault !== vault.toBase58() || pending.pendingController !== SQUADS) throw new Error(`STOP: pending slot mismatch ${JSON.stringify(pending)}`);
    const b = await nativeCall('set_release_delay', [i64(86400)], '6c native governance still works');
    if (b.err) throw new Error(`STOP: native governance broke after propose ${JSON.stringify(b.err)}`);
    log(`- pending slot read back: vault \`${pending.pendingVault}\`, controller \`${pending.pendingController}\`, proposalRevision ${pending.proposalRevision}; policy digest \`${policy.toString('hex')}\``);
    console.log(JSON.stringify(pending, null, 2));
  },

  /** 6d: accept THROUGH Squads. A failure here is a runbook STOP (native governance remains in force). */
  async accept() {
    await verify();
    const { ms, vault } = pdas('gov_create_key');
    const cfg = configView(await readConfig());
    const m = await multisig.accounts.Multisig.fromAccountAddress(connection, ms);
    const index = BigInt(m.transactionIndex) + 1n;
    const ix = new TransactionInstruction({ programId: program, keys: [meta(config, false, true), meta(vault, true), meta(SYSVAR_INSTRUCTIONS_PUBKEY)], data: Buffer.concat([disc('accept_governance_vault'), u64(cfg.proposalRevision)]) });
    log(`\n## D3 step 6d: accept_governance_vault through Squads (transaction index ${index}, revision ${cfg.proposalRevision})`);
    const r = await viaSquads({ name: '6d accept', ms, vault, signers: GOV, index, message: ix, label: 'accept_governance_vault' });
    const after = configView(await readConfig());
    log(`- outcome: ${r.ok ? 'SUCCESS, direct CPI from Squads vault_transaction_execute accepted' : `FAILED ${JSON.stringify(r.err ?? r.error)}`}; governance_vault now \`${after.governanceVault}\`, pending \`${after.pendingVault}\``);
    console.log(JSON.stringify({ ok: r.ok, err: r.err ?? r.error, after }, null, 2));
    if (!r.ok) throw new Error('STOP: accept through Squads failed; native governance is still in force');
  },

  /** 6e: verify the vault is active, native set_pause is refused, then destroy the ceremony key file. */
  async verifyAccept() {
    await verify();
    const { vault } = pdas('gov_create_key');
    const cfg = configView(await readConfig());
    if (cfg.governanceVault !== vault.toBase58()) throw new Error(`STOP: governance_vault ${cfg.governanceVault} != GV ${vault.toBase58()}`);
    if (cfg.pendingVault !== PublicKey.default.toBase58()) throw new Error('STOP: pending slot not empty');
    const r = await nativeCall('set_pause', [Buffer.from([1, 0])], '6e native set_pause must be refused');
    const code = r.err?.InstructionError?.[1]?.Custom;
    if (code !== 6001) throw new Error(`STOP: native set_pause was not refused with 6001: ${JSON.stringify(r.err)}`);
    unlinkSync(keyPath('native_ceremony'));
    log(`- 6e verified: governance_vault == GV \`${vault.toBase58()}\`, pending empty, native set_pause refused with Custom 6001; ceremony key file deleted (native_ceremony).`);
    console.log(JSON.stringify({ governanceVault: cfg.governanceVault, nativeRefused: code }));
  },

  /** 7: no-op set_release_delay(86400) through the multisig with accounts [config(w), GV(s), GV(s)]. */
  async step7() {
    await verify();
    const { ms, vault } = pdas('gov_create_key');
    const m = await multisig.accounts.Multisig.fromAccountAddress(connection, ms);
    const index = BigInt(m.transactionIndex) + 1n;
    const ix = new TransactionInstruction({ programId: program, keys: [meta(config, false, true), meta(vault, true), meta(vault, true)], data: Buffer.concat([disc('set_release_delay'), i64(86400)]) });
    log(`\n## D3 step 7: set_release_delay(86400) through Squads (index ${index})`);
    const r = await viaSquads({ name: 'step7', ms, vault, signers: GOV, index, message: ix, label: 'set_release_delay no-op' });
    console.log(JSON.stringify({ ok: r.ok, err: r.err ?? r.error }));
    if (!r.ok) throw new Error('STOP: step 7 failed; the fallback is a program change, not a workaround');
  },

  /** 8: hand the upgrade authority to the upgrade multisig vault UV (only after 7). */
  async handover() {
    await verify();
    const { vault } = pdas('upg_create_key');
    const run = async args => { const r = await devnetCli(args); log(`- cli ${args.slice(0, 2).join(' ')}: exit ${r.status}\n${fence}\n${(r.stdout + r.stderr).trim().slice(-1200)}\n${fence}`); if (r.status !== 0) throw new Error(`STOP: ${args[1]} failed: ${r.stderr.slice(-300)}`); return r.stdout; };
    const key = wslPath(keyPath('deployer'));
    log(`\n## D3 step 8: set-upgrade-authority to UV \`${vault.toBase58()}\``);
    await run(['program', 'set-upgrade-authority', PROGRAM_ID, '--new-upgrade-authority', vault.toBase58(), '--skip-new-upgrade-authority-signer-check', '--upgrade-authority', key, '--keypair', key]);
    const show = await run(['program', 'show', PROGRAM_ID, '--keypair', key]);
    if (!show.includes(`Authority: ${vault.toBase58()}`)) throw new Error('STOP: authority did not change to UV');
    console.log(show);
  },
};

const step = process.argv[2];
if (!steps[step]) { console.error(`unknown step ${step}; have: ${Object.keys(steps).join(', ')}`); process.exit(1); }
steps[step]().then(() => process.exit(0)).catch(e => { log(`- **STEP ${step} FAILED:** ${e.message}`); console.error(e.message); process.exit(1); });
