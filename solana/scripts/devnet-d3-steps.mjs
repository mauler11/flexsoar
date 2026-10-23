/** D3 rehearsal steps. usage: node solana/scripts/devnet-d3-steps.mjs <step>. See devnet-d3.mjs for the rules every step runs under. */
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { TransactionInstruction } from '@solana/web3.js';
import { initializeV2 } from './init-v2.mjs';
import { keyPath } from './devnet-keys.mjs';
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

  /** Step 4: write-buffer, deploy from the buffer at max-len 700000, dump, and require sha256(first 573,824 dumped bytes) == B. */
  async deploy() {
    await verify();
    const dir = process.env.D3_SCRATCH; if (!dir) throw new Error('set D3_SCRATCH to a scratch directory (Windows path)');
    const fence = '```';
    const run = async (label, args) => {
      const r = await devnetCli(args);
      log(`- cli ${label}: exit ${r.status}\n${fence}\n${(r.stdout + r.stderr).trim().slice(-1500)}\n${fence}`);
      if (r.status !== 0) throw new Error(`${label} failed: ${r.stderr.trim().slice(-400)}`);
      return r.stdout;
    };
    const key = n => wslPath(keyPath(n));
    let buffer = process.env.D3_BUFFER ?? null;
    if (!process.env.D3_SKIP_DEPLOY) {
    const wb = await run('write-buffer', ['program', 'write-buffer', wslPath(B_SO), '--keypair', key('deployer')]);
    buffer = (wb.match(/Buffer:\s*(\w{32,44})/) ?? [])[1]; if (!buffer) throw new Error('could not read buffer address');
    await run('deploy', ['program', 'deploy', '--buffer', buffer, '--program-id', key('program'), '--upgrade-authority', key('deployer'), '--keypair', key('deployer'), '--max-len', '700000']);
    }
    const show = await run('program show', ['program', 'show', PROGRAM_ID, '--keypair', key('deployer')]);
    await run('program dump', ['program', 'dump', PROGRAM_ID, `${wslPath(dir)}/dump.so`, '--keypair', key('deployer')]);
    const dump = readFileSync(`${dir}\\dump.so`);
    const head = dump.subarray(0, B_SIZE);
    const result = { buffer, dumpedBytes: dump.length, firstBytesSha256: sha256(head), expected: B_SHA256, equal: sha256(head) === B_SHA256 };
    log(`\n### step 4 result\n${fence}json\n${JSON.stringify(result, null, 2)}\n${fence}\n${show.trim()}`);
    console.log(JSON.stringify(result, null, 2));
    if (!result.equal) throw new Error('STOP: dumped program does not equal build B');
  },

  /** Self-created 6-decimal TEST mint (mint authority = deployer, no freeze authority). Never a real or Circle mint. */
  async mint() {
    await verify();
    const mint = loadKey('test_mint'), payer = loadKey('deployer');
    if (await connection.getAccountInfo(mint.publicKey)) throw new Error('test mint already exists');
    const rent = await connection.getMinimumBalanceForRentExemption(82);
    const init = Buffer.concat([Buffer.from([20, 6]), payer.publicKey.toBuffer(), Buffer.from([0])]); // InitializeMint2(decimals 6, authority, no freeze)
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash })
      .add(SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports: rent, space: 82, programId: TOKEN }),
        new TransactionInstruction({ programId: TOKEN, keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }], data: init }));
    tx.sign(payer, mint);
    await land(tx, 'create test mint');
    const info = await connection.getAccountInfo(mint.publicKey);
    if (!info || !info.owner.equals(TOKEN) || info.data[44] !== 6) throw new Error('test mint read-back mismatch');
    log(`- test mint \`${mint.publicKey.toBase58()}\`: 6 decimals, owner Token program, mint authority deployer, freeze authority none`);
  },

  /** Step 5: manifest, init dry run (argv[3]==='dry') or real run; real run must print verified:true. */
  async init() {
    await verify();
    const names = ['issuer', 'inventory', 'receiver', 'authenticator', 'reviewer', 'release', 'reconciler', 'guardian'];
    const manifest = { cluster: 'devnet', genesisHash: await connection.getGenesisHash(), programId: PROGRAM_ID, mint: pubkeyOf('test_mint').toBase58(),
      domain: await connection.getGenesisHash(), policyDigest: sha256(Buffer.from('d3-rehearsal-policy-v1')), treasury: pubkeyOf('treasury').toBase58(),
      bootstrap: pubkeyOf('deployer').toBase58(), roles: Object.fromEntries(names.map(n => [n, pubkeyOf(n).toBase58()])),
      governance: ['native_founder', 'native_friend', 'native_ceremony'].map(n => pubkeyOf(n).toBase58()) };
    const dry = process.argv[3] === 'dry';
    const out = await initializeV2({ connection, manifest, bootstrap: dry ? null : loadKey('deployer'), dryRun: dry, commitment: 'finalized' });
    log(`\n### step 5 init ${dry ? 'dry run' : 'REAL'}\nmanifest (public keys only): \`${JSON.stringify(manifest)}\`\nresult: \`${JSON.stringify(out)}\``);
    console.log(JSON.stringify(out, null, 2));
    if (!dry && out.verified !== true) throw new Error('STOP: init did not print verified:true');
  },
};

const step = process.argv[2];
if (!steps[step]) { console.error(`unknown step ${step}; have: ${Object.keys(steps).join(', ')}`); process.exit(1); }
steps[step]().then(() => process.exit(0)).catch(e => { log(`- **STEP ${step} FAILED:** ${e.message}`); console.error(e.message); process.exit(1); });
