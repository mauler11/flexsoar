/** D3 rehearsal steps. usage: node solana/scripts/devnet-d3-steps.mjs <step>. See devnet-d3.mjs for the rules every step runs under. */
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { connection, verify, log, loadKey, pubkeyOf, land, sha256, devnetCli, wslPath, PROGRAM_ID, SQUADS, B_SHA256, B_SIZE, B_SO, LOADER, TOKEN, pause } from './devnet-d3.mjs';

const steps = {
  /** Read-only: genesis, key/program identity, Squads deployed, fresh-id inventory, balances. */
  async preflight() {
    const genesis = await verify();
    const program = pubkeyOf('program');
    if (program.toBase58() !== PROGRAM_ID) throw new Error('program.json does not derive the expected program id');
    const so = readFileSync(B_SO);
    if (so.length !== B_SIZE || sha256(so) !== B_SHA256) throw new Error('B artifact does not match the pinned size/sha256');
    const sq = await connection.getAccountInfo(new PublicKey(SQUADS));
    if (!sq || !sq.executable) throw new Error('Squads v4 program is not deployed (executable) on devnet: STOP before step 6');
    const existing = await connection.getAccountInfo(program);
    const owned = await connection.getProgramAccounts(program, { dataSlice: { offset: 0, length: 0 } });
    const config = PublicKey.findProgramAddressSync([Buffer.from('config-v2')], program)[0];
    const cfg = await connection.getAccountInfo(config);
    const deployer = pubkeyOf('deployer');
    const balance = await connection.getBalance(deployer);
    const out = { genesis, program: program.toBase58(), programAccountExists: !!existing, accountsOwnedByProgramId: owned.length, configPda: config.toBase58(), configExists: !!cfg,
      squadsExecutable: true, squadsOwner: sq.owner.toBase58(), squadsDataLen: sq.data.length, deployer: deployer.toBase58(), deployerLamports: balance, bSha256: sha256(so), bSize: so.length };
    if (existing || owned.length || cfg) throw new Error(`program id is not fresh: ${JSON.stringify(out)}`);
    log(`\n## D3 preflight (read-only)\n\`\`\`json\n${JSON.stringify(out, null, 2)}\n\`\`\``);
    console.log(JSON.stringify(out, null, 2));
  },

  /** Faucet SOL for the deployer (devnet faucet only). Amount in SOL via argv[3]. */
  async airdrop() {
    const sol = Number(process.argv[3] ?? '2'), deployer = pubkeyOf('deployer');
    await verify();
    const signature = await connection.requestAirdrop(deployer, Math.round(sol * LAMPORTS_PER_SOL));
    for (let i = 0; i < 60; i++) {
      const s = (await connection.getSignatureStatuses([signature])).value[0];
      if (s?.err) throw new Error(`airdrop failed: ${JSON.stringify(s.err)}`);
      if (s && ['confirmed', 'finalized'].includes(s.confirmationStatus)) break;
      await pause(1000);
      if (i === 59) throw new Error('airdrop did not confirm');
    }
    const balance = await connection.getBalance(deployer);
    log(`- airdrop ${sol} SOL to deployer \`${deployer.toBase58()}\`: \`${signature}\`; balance now ${balance} lamports`);
    console.log({ signature, balance });
  },
};

const step = process.argv[2];
if (!steps[step]) { console.error(`unknown step ${step}; have: ${Object.keys(steps).join(', ')}`); process.exit(1); }
steps[step]().then(() => process.exit(0)).catch(e => { log(`- **STEP ${step} FAILED:** ${e.message}`); console.error(e.message); process.exit(1); });
