/** D4 devnet steps (AGENT_RULES 2b, task d4). usage: node solana/scripts/devnet-d4.mjs <upgrade|govcheck|timelock>
 *  upgrade  - write-buffer build B, hand the buffer authority to the upgrade vault UV, execute the upgrade through the upgrade multisig (2-of-3),
 *             then dump and require the first 573,824 bytes to still hash to B.
 *  govcheck - governance through the governance multisig still works; native governors are still refused.
 *  timelock - third throwaway 2-of-3 multisig with a 120 s time lock: a no-op cannot execute before the lock expires and can after.
 * Builds Squads transactions from multisig.instructions.* only. Never enables funding. A refused check throws; nothing is retried or relaxed. */
import * as multisig from '@sqds/multisig';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connection, verify, log, loadKey, pubkeyOf, sha256, devnetCli, wslPath, pause, PROGRAM_ID, B_SHA256, B_SIZE, B_SO, LOADER } from './devnet-d3.mjs';
import { keyPath } from './devnet-keys.mjs';
import { sendIxs, viaSquads, proposeAndApprove, executeStage, nextIndex, pdas, fence } from './devnet-squads.mjs';

const program = new PublicKey(PROGRAM_ID);
const programData = PublicKey.findProgramAddressSync([program.toBuffer()], LOADER)[0];
const config = PublicKey.findProgramAddressSync([Buffer.from('config-v2')], program)[0];
const disc = n => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);
const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
const i64 = n => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const UPG = ['upg_founder', 'upg_friend', 'upg_recovery'], GOV = ['gov_founder', 'gov_friend', 'gov_recovery'];

async function cli(args, label) {
  const r = await devnetCli(args);
  log(`- cli ${label}: exit ${r.status}\n${fence}\n${(r.stdout + r.stderr).trim().slice(-1200)}\n${fence}`);
  if (r.status !== 0) throw new Error(`STOP: ${label} failed: ${r.stderr.trim().slice(-300)}`);
  return r.stdout;
}
const readProgramData = async () => {
  const pd = await connection.getAccountInfo(programData);
  return { slot: pd.data.readBigUInt64LE(4).toString(), authority: new PublicKey(pd.data.subarray(13, 45)).toBase58(), length: pd.data.length };
};
const configView = b => ({ length: b.length, fundingPaused: b[560], maxTrade: b.readBigUInt64LE(562).toString(), maxEscrow: b.readBigUInt64LE(570).toString(), outstanding: b.readBigUInt64LE(578).toString(),
  releaseDelay: b.readBigInt64LE(586).toString(), governanceVault: new PublicKey(b.subarray(488, 520)).toBase58() });

const steps = {
  async upgrade() {
    await verify();
    const dir = process.env.D4_SCRATCH; if (!dir) throw new Error('set D4_SCRATCH to a scratch directory (Windows path)');
    const key = wslPath(keyPath('deployer'));
    const { ms, vault: UV } = pdas(pubkeyOf('upg_create_key'));
    const before = await readProgramData();
    if (before.authority !== UV.toBase58()) throw new Error(`STOP: upgrade authority is ${before.authority}, expected UV ${UV.toBase58()}`);
    const so = readFileSync(B_SO);
    if (so.length !== B_SIZE || sha256(so) !== B_SHA256) throw new Error('STOP: build B artifact does not match the pinned size/sha256');
    const cfgBefore = configView(Buffer.from((await connection.getAccountInfo(config)).data));
    log(`\n## D4 step 1: upgrade through the upgrade multisig\n- before: ProgramData ${JSON.stringify(before)}; config ${JSON.stringify(cfgBefore)}; upgrade multisig \`${ms.toBase58()}\`, UV \`${UV.toBase58()}\``);

    const wb = await cli(['program', 'write-buffer', wslPath(B_SO), '--keypair', key], 'write-buffer');
    const buffer = (wb.match(/Buffer:\s*(\w{32,44})/) ?? [])[1]; if (!buffer) throw new Error('could not read buffer address');
    await cli(['program', 'set-buffer-authority', buffer, '--new-buffer-authority', UV.toBase58(), '--buffer-authority', key, '--keypair', key], 'set-buffer-authority to UV');
    const shown = await cli(['program', 'show', buffer, '--keypair', key], 'show buffer');
    if (!shown.includes(`Authority: ${UV.toBase58()}`)) throw new Error('STOP: buffer authority is not UV');

    // BPF Loader Upgradeable `Upgrade` (instruction 3): programdata(w), program(w), buffer(w), spill(w), rent, clock, authority(s).
    const spill = pubkeyOf('deployer');
    const upgradeIx = new TransactionInstruction({ programId: LOADER, data: Buffer.from([3, 0, 0, 0]),
      keys: [meta(programData, false, true), meta(program, false, true), meta(new PublicKey(buffer), false, true), meta(spill, false, true), meta(SYSVAR_RENT_PUBKEY), meta(SYSVAR_CLOCK_PUBKEY), meta(UV, true)] });
    const index = await nextIndex(ms);
    log(`- buffer \`${buffer}\` (authority UV, same binary), spill \`${spill.toBase58()}\`, upgrade multisig transaction index ${index}`);
    const r = await viaSquads({ name: 'upgrade', ms, vault: UV, signers: UPG, index, message: upgradeIx, label: 'upgrade to build B' });
    if (!r.ok) throw new Error(`STOP: upgrade through the multisig failed: ${JSON.stringify(r.err)}`);

    const after = await readProgramData();
    await cli(['program', 'dump', PROGRAM_ID, `${wslPath(dir)}/dump-d4.so`, '--keypair', key], 'program dump');
    const dump = readFileSync(`${dir}\\dump-d4.so`), head = sha256(dump.subarray(0, B_SIZE));
    const tailZero = dump.subarray(B_SIZE).every(b => b === 0);
    const out = { before, after, slotChanged: before.slot !== after.slot, authorityStillUV: after.authority === UV.toBase58(), dumpedBytes: dump.length, firstBytesSha256: head, equalsB: head === B_SHA256, tailZero };
    log(`\n### D4 upgrade result\n${fence}json\n${JSON.stringify(out, null, 2)}\n${fence}`);
    console.log(JSON.stringify(out, null, 2));
    if (!(out.equalsB && out.authorityStillUV && out.tailZero && out.slotChanged)) throw new Error('STOP: post-upgrade verification failed');
  },

  async govcheck() {
    await verify();
    const { ms, vault: GV } = pdas(pubkeyOf('gov_create_key'));
    const cfg0 = configView(Buffer.from((await connection.getAccountInfo(config)).data));
    if (cfg0.governanceVault !== GV.toBase58()) throw new Error(`STOP: governance_vault ${cfg0.governanceVault} is not GV`);
    const ix = new TransactionInstruction({ programId: program, keys: [meta(config, false, true), meta(GV, true), meta(GV, true)], data: Buffer.concat([disc('set_release_delay'), i64(86400)]) });
    log('\n## D4 governance check after the upgrade');
    const r = await viaSquads({ name: 'govcheck set_release_delay', ms, vault: GV, signers: GOV, index: await nextIndex(ms), message: ix, label: 'post-upgrade no-op' });
    if (!r.ok) throw new Error(`STOP: governance through Squads failed after the upgrade: ${JSON.stringify(r.err)}`);
    const f = loadKey('native_founder'), g = loadKey('native_friend');
    const nat = await sendIxs([new TransactionInstruction({ programId: program, keys: [meta(config, false, true), meta(f.publicKey, true), meta(g.publicKey, true)], data: Buffer.concat([disc('set_pause'), Buffer.from([1, 0])]) })], [f, g], 'native set_pause (must be refused)', { allowFail: true });
    const code = nat.err?.InstructionError?.[1]?.Custom;
    if (code !== 6001) throw new Error(`STOP: native set_pause was not refused with 6001: ${JSON.stringify(nat.err)}`);
    const cfg1 = configView(Buffer.from((await connection.getAccountInfo(config)).data));
    log(`- config after: ${JSON.stringify(cfg1)}`);
    console.log(JSON.stringify({ squadsGovernance: 'ok', nativeRefused: code, cfg1 }));
    if (cfg1.fundingPaused !== 1 || cfg1.maxTrade !== '0' || cfg1.maxEscrow !== '0') throw new Error('STOP: funding state changed');
  },

  async timelock() {
    await verify();
    const pcPda = multisig.getProgramConfigPda({})[0];
    const pc = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, pcPda);
    const names = ['tl_a', 'tl_b', 'tl_c'], { ms, vault } = pdas(pubkeyOf('tl_create_key'));
    log('\n## D4 step 2: time-locked multisig (2-of-3, timeLock 120 s)');
    if (!(await connection.getAccountInfo(ms))) {
      const members = names.map(n => ({ key: pubkeyOf(n), permissions: multisig.types.Permissions.all() }));
      await sendIxs([multisig.instructions.multisigCreateV2({ treasury: pc.treasury, creator: pubkeyOf('deployer'), multisigPda: ms, configAuthority: null, threshold: 2, members, timeLock: 120, createKey: pubkeyOf('tl_create_key'), rentCollector: null, memo: 'd4 time lock' })],
        [loadKey('tl_create_key')], 'create time-locked multisig');
    }
    const m = await multisig.accounts.Multisig.fromAccountAddress(connection, ms);
    log(`- multisig \`${ms.toBase58()}\` vault \`${vault.toBase58()}\`: threshold ${m.threshold}, timeLock ${m.timeLock}, members ${m.members.length}, configAuthority ${m.configAuthority.toBase58()}`);
    if (m.timeLock !== 120 || m.threshold !== 2) throw new Error('STOP: time-locked multisig has the wrong threshold or time lock');
    // No-op governed instruction: a 0-lamport system transfer signed by the vault PDA.
    const noop = SystemProgram.transfer({ fromPubkey: vault, toPubkey: pubkeyOf('deployer'), lamports: 0 });
    const index = await nextIndex(ms);
    await proposeAndApprove({ name: 'timelock', ms, vault, signers: names, index, message: noop, label: 'time lock no-op' });
    const [proposalPda] = multisig.getProposalPda({ multisigPda: ms, transactionIndex: index });
    const proposal = await multisig.accounts.Proposal.fromAccountAddress(connection, proposalPda);
    const approvedAt = Number(proposal.status.timestamp.toString()), clock = async () => connection.getBlockTime(await connection.getSlot('confirmed'));
    log(`- proposal ${index} status ${proposal.status.__kind}, approved at unix ${approvedAt}, cluster time now ${await clock()}; earliest execute ${approvedAt + 120}`);
    if (proposal.status.__kind !== 'Approved') throw new Error('STOP: proposal is not Approved');
    const early = await executeStage({ name: 'timelock EARLY', ms, index, member: names[2] });
    const earlyClock = await clock();
    log(`- early execute at cluster time ${earlyClock} (${earlyClock - approvedAt} s after approval): ${early.ok ? 'SUCCEEDED (time lock NOT enforced)' : `refused ${JSON.stringify(early.err)}`}`);
    if (early.ok) throw new Error('STOP: the time lock did not stop an early execution');
    const wait = Math.max(0, approvedAt + 120 - earlyClock) + 15;
    log(`- waiting ${wait} s of wall time for the lock to expire`);
    await pause(wait * 1000);
    let late, tries = 0;
    do { late = await executeStage({ name: `timelock LATE (try ${++tries})`, ms, index, member: names[2] }); if (!late.ok) await pause(10000); } while (!late.ok && tries < 3);
    const lateClock = await clock();
    log(`- late execute at cluster time ${lateClock} (${lateClock - approvedAt} s after approval): ${late.ok ? 'SUCCEEDED' : `FAILED ${JSON.stringify(late.err)}`}`);
    console.log(JSON.stringify({ approvedAt, earlyRefused: !early.ok, earlyErr: early.err, earlyLogs: early.logs.slice(-4), lateOk: late.ok, secondsAfterApproval: lateClock - approvedAt }, null, 2));
    if (!late.ok) throw new Error('STOP: execution failed after the time lock expired');
  },
};

const step = process.argv[2];
if (!steps[step]) { console.error(`unknown step ${step}; have: ${Object.keys(steps).join(', ')}`); process.exit(1); }
steps[step]().then(() => process.exit(0)).catch(e => { log(`- **STEP ${step} FAILED:** ${e.message}`); console.error(e.message); process.exit(1); });
