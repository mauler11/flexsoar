/** Reviewed initializer for flexsoar-settlement `initialize_v2` (R1-01 inventory, R1-03 pinned manifest).
 *
 *   node solana/scripts/init-v2.mjs --manifest <manifest.json> --rpc <url> --dry-run
 *   node solana/scripts/init-v2.mjs --manifest <manifest.json> --rpc <url> --keypair <bootstrap.json> [--commitment finalized]
 *
 * Nothing is signed or sent until EVERY check below passes, in this order:
 *   1. the manifest is complete; the eight role keys and three native governance keys are distinct, non-default 32-byte keys (treasury,
 *      mint, program and bootstrap are only checked as valid keys: review them by hand); and `domain` equals the pinned genesis hash;
 *   2. the RPC's genesis hash equals the manifest's pinned one (a mismatch means this is not the cluster you reviewed), and
 *      mainnet-beta is refused outright (mainnet needs its own reviewed run);
 *   3. the program id is an upgradeable program whose upgrade authority is the manifest's bootstrap key (initialize_v2 requires it);
 *   4. the mint is the pinned token mint with 6 decimals;
 *   5. INVENTORY: the program id owns no accounts at all. Any V2 config, card or sale means a different (or fresh) program id is
 *      required, because account layouts are typed and there is no migration path (see LAYOUT RULE in lib.rs);
 *      (the read-back checks owner, executable=false, the ConfigV2 discriminator, then every body field);
 *   6. dry run: simulate the transaction and print the exact instruction; real run: sign, send, then READ THE CONFIG BACK and
 *      refuse on any single field that differs from the manifest.
 * No default RPC, no default keypair, no environment lookups, and the key file is read only for a real run. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';

export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ROLE_NAMES = ['issuer', 'inventory', 'receiver', 'authenticator', 'reviewer', 'release', 'reconciler', 'guardian'];
export const CONFIG_SIZE = 819, LAYOUT_VERSION = 1;
const disc = name => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
/** Anchor's 8-byte account header: SHA-256("account:ConfigV2")[0..8]. */
export const CONFIG_DISCRIMINATOR = createHash('sha256').update('account:ConfigV2').digest().subarray(0, 8);

const fail = message => { throw new Error(`init-v2 refused: ${message}`); };
const key = (value, label) => { try { const k = new PublicKey(String(value)); if (k.toBytes().length !== 32) throw 0; return k; } catch { return fail(`${label} is not a valid public key`); } };

/** Validates the manifest and returns it with parsed keys. Pure: no network. */
export function parseManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('manifest must be a JSON object');
  const allowed = ['cluster', 'genesisHash', 'programId', 'mint', 'domain', 'policyDigest', 'treasury', 'bootstrap', 'roles', 'governance'];
  for (const k of Object.keys(raw)) if (!allowed.includes(k)) fail(`unknown manifest field ${k}`);
  for (const k of allowed) if (raw[k] === undefined) fail(`manifest is missing ${k}`);
  if (!['devnet', 'localnet'].includes(raw.cluster)) fail('cluster must be "devnet" or "localnet"');
  if (!/^[0-9a-f]{64}$/.test(raw.policyDigest) || /^0+$/.test(raw.policyDigest)) fail('policyDigest must be 64 hex characters and not all zero');
  if (!raw.roles || typeof raw.roles !== 'object' || Object.keys(raw.roles).sort().join() !== [...ROLE_NAMES].sort().join()) fail(`roles must be exactly ${ROLE_NAMES.join(', ')}`);
  if (!Array.isArray(raw.governance) || raw.governance.length !== 3) fail('governance must list exactly 3 native member keys');
  const m = { cluster: raw.cluster, genesisHash: key(raw.genesisHash, 'genesisHash'), programId: key(raw.programId, 'programId'), mint: key(raw.mint, 'mint'),
    domain: key(raw.domain, 'domain'), policyDigest: Buffer.from(raw.policyDigest, 'hex'), treasury: key(raw.treasury, 'treasury'), bootstrap: key(raw.bootstrap, 'bootstrap'),
    roles: Object.fromEntries(ROLE_NAMES.map(n => [n, key(raw.roles[n], `roles.${n}`)])), governance: raw.governance.map((g, i) => key(g, `governance[${i}]`)) };
  if (m.genesisHash.toBase58() === MAINNET_GENESIS) fail('mainnet-beta is not supported by this script');
  if (!m.domain.equals(m.genesisHash)) fail('domain must equal the pinned genesis hash (it separates seller signatures between clusters)');
  const all = [...ROLE_NAMES.map(n => m.roles[n]), ...m.governance];
  all.forEach((k, i) => { if (k.equals(PublicKey.default)) fail('a role or governance key is the default key'); if (all.slice(0, i).some(o => o.equals(k))) fail(`duplicate key ${k.toBase58()} among roles and governance`); });
  return m;
}

/** The exact instruction, byte for byte as the program decodes it. */
export function buildInitInstruction(m) {
  const config = PublicKey.findProgramAddressSync([Buffer.from('config-v2')], m.programId)[0];
  const programData = PublicKey.findProgramAddressSync([m.programId.toBuffer()], LOADER)[0];
  const data = Buffer.concat([disc('initialize_v2'), m.domain.toBuffer(), m.policyDigest, m.treasury.toBuffer(),
    ...ROLE_NAMES.map(n => m.roles[n].toBuffer()), ...m.governance.map(g => g.toBuffer())]);
  const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
  const instruction = new TransactionInstruction({ programId: m.programId, data,
    keys: [meta(config, false, true), meta(m.bootstrap, true, true), meta(programData), meta(m.mint), meta(SystemProgram.programId)] });
  return { instruction, config, programData };
}

/** Everything that must hold before a transaction exists. Read-only RPC. */
export async function preflight(connection, m) {
  const genesis = await connection.getGenesisHash();
  if (genesis !== m.genesisHash.toBase58()) fail(`RPC genesis ${genesis} does not match the pinned ${m.genesisHash.toBase58()}`);
  if (genesis === MAINNET_GENESIS) fail('mainnet-beta is not supported by this script');
  const { config, programData } = buildInitInstruction(m);
  const program = await connection.getAccountInfo(m.programId, 'confirmed');
  if (!program || !program.executable || !program.owner.equals(LOADER)) fail('programId is not a deployed upgradeable program on this cluster');
  const pd = await connection.getAccountInfo(programData, 'confirmed');
  // ProgramData: u32 enum(3) | slot u64 | Option<Pubkey> (1 tag byte + 32).
  if (!pd || pd.data.length < 45 || pd.data.readUInt32LE(0) !== 3 || pd.data[12] !== 1) fail('the program has no upgrade authority (immutable); initialize_v2 cannot run');
  const authority = new PublicKey(pd.data.subarray(13, 45));
  if (!authority.equals(m.bootstrap)) fail(`upgrade authority is ${authority.toBase58()}, not the manifest bootstrap ${m.bootstrap.toBase58()}`);
  const mint = await connection.getAccountInfo(m.mint, 'confirmed');
  if (!mint || !mint.owner.equals(TOKEN) || mint.data.length < 82 || mint.data[44] !== 6) fail('mint is not an SPL token mint with 6 decimals');
  // Inventory: ANY account owned by the program (V2 config, card, sale, ...) means this program id is not fresh.
  const owned = await connection.getProgramAccounts(m.programId, { commitment: 'confirmed', dataSlice: { offset: 0, length: 0 } });
  if (owned.length > 0) fail(`program id already owns ${owned.length} account(s) (e.g. ${owned[0].pubkey.toBase58()}); use a fresh program id, layouts have no migration path`);
  if (await connection.getAccountInfo(config, 'confirmed')) fail('the V2 config account already exists');
  return { genesis, config, programData, authority };
}

/** Field-by-field readback. `expected` is derived from the manifest, never from what was sent. */
export function decodeConfig(input) {
  const bytes = Buffer.from(input); // accept a Buffer or a plain Uint8Array
  if (bytes.length !== CONFIG_SIZE) fail(`config is ${bytes.length} bytes, expected ${CONFIG_SIZE}`);
  const pk = o => new PublicKey(bytes.subarray(o, o + 32)), zero = (a, b) => bytes.subarray(a, b).every(x => x === 0);
  return { domain: pk(8), policy: bytes.subarray(40, 72), treasury: pk(72), mint: pk(104), roles: ROLE_NAMES.map((n, i) => pk(136 + 32 * i)),
    governance: [0, 1, 2].map(i => pk(392 + 32 * i)), governanceVault: pk(488), governancePolicyZero: zero(520, 552), epoch: bytes.readBigUInt64LE(552),
    fundingPaused: bytes[560], outflowPaused: bytes[561], maxTrade: bytes.readBigUInt64LE(562), maxEscrow: bytes.readBigUInt64LE(570), outstanding: bytes.readBigUInt64LE(578),
    releaseDelay: bytes.readBigInt64LE(586), pendingVault: pk(594), pendingController: pk(626), pendingPolicyZero: zero(658, 690), layoutVersion: bytes[690], proposalRevision: bytes.readBigUInt64LE(691), reservedZero: zero(699, 819),
    discriminatorOk: bytes.subarray(0, 8).equals(CONFIG_DISCRIMINATOR) };
}
export function verifyConfig(bytes, m) {
  const c = decodeConfig(bytes), diffs = [];
  const eq = (name, a, b) => { if (String(a) !== String(b)) diffs.push(`${name}: on chain ${a}, manifest ${b}`); };
  eq('domain', c.domain.toBase58(), m.domain.toBase58()); eq('policy', Buffer.from(c.policy).toString('hex'), m.policyDigest.toString('hex'));
  eq('treasury', c.treasury.toBase58(), m.treasury.toBase58()); eq('mint', c.mint.toBase58(), m.mint.toBase58());
  ROLE_NAMES.forEach((n, i) => eq(`roles.${n}`, c.roles[i].toBase58(), m.roles[n].toBase58()));
  m.governance.forEach((g, i) => eq(`governance[${i}]`, c.governance[i].toBase58(), g.toBase58()));
  eq('governance_vault', c.governanceVault.toBase58(), PublicKey.default.toBase58()); eq('governance_policy zero', c.governancePolicyZero, true);
  eq('epoch', c.epoch, 1n); eq('funding_paused', c.fundingPaused, 1); eq('outflow_paused', c.outflowPaused, 0);
  eq('max_trade', c.maxTrade, 0n); eq('max_escrow', c.maxEscrow, 0n); eq('outstanding', c.outstanding, 0n); eq('release_delay', c.releaseDelay, 0n);
  eq('pending_vault', c.pendingVault.toBase58(), PublicKey.default.toBase58()); eq('pending_controller', c.pendingController.toBase58(), PublicKey.default.toBase58());
  eq('pending_policy zero', c.pendingPolicyZero, true); eq('layout_version', c.layoutVersion, LAYOUT_VERSION); eq('proposal_revision', c.proposalRevision, 0n); eq('reserved zero', c.reservedZero, true);
  eq('account discriminator is ConfigV2', c.discriminatorOk, true);
  if (diffs.length) fail(`config read back from chain differs from the manifest:\n  ${diffs.join('\n  ')}`);
  return c;
}

/** dryRun: preflight + simulation, nothing sent, no key needed. Otherwise sign with `bootstrap`, send, read back and verify. */
export async function initializeV2({ connection, manifest, bootstrap = null, dryRun = true, commitment = 'finalized' }) {
  const m = parseManifest(manifest), pre = await preflight(connection, m), { instruction, config } = buildInitInstruction(m);
  const plan = { programId: m.programId.toBase58(), config: config.toBase58(), genesis: pre.genesis, instructionDataHex: instruction.data.toString('hex'),
    accounts: instruction.keys.map(k => ({ pubkey: k.pubkey.toBase58(), signer: k.isSigner, writable: k.isWritable })) };
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: m.bootstrap, blockhash, lastValidBlockHeight }).add(instruction);
  if (dryRun) {
    const sim = await connection.simulateTransaction(tx);
    if (sim.value.err) fail(`simulation failed: ${JSON.stringify(sim.value.err)}\n${(sim.value.logs ?? []).join('\n')}`);
    return { dryRun: true, plan, unitsConsumed: sim.value.unitsConsumed ?? null };
  }
  if (!bootstrap || !bootstrap.publicKey.equals(m.bootstrap)) fail('the supplied key is not the manifest bootstrap key');
  tx.sign(bootstrap);
  const signature = await connection.sendRawTransaction(tx.serialize());
  const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, commitment);
  if (result.value.err) fail(`transaction failed: ${JSON.stringify(result.value.err)}`);
  const account = await connection.getAccountInfo(config, commitment);
  if (!account || !account.owner.equals(m.programId)) fail('config account missing or not owned by the program after init');
  if (account.executable !== false) fail('config account is executable (or the flag is missing); it must be plain data');
  verifyConfig(account.data, m);
  return { dryRun: false, plan, signature, verified: true };
}

async function main(argv) {
  const arg = n => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
  const manifestPath = arg('--manifest'), rpc = arg('--rpc'), dryRun = argv.includes('--dry-run'), keypairPath = arg('--keypair');
  if (!manifestPath || !rpc) fail('usage: init-v2.mjs --manifest <file> --rpc <url> (--dry-run | --keypair <bootstrap.json>)');
  if (!dryRun && !keypairPath) fail('a real run needs --keypair <bootstrap.json> (never a default wallet); use --dry-run to rehearse');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bootstrap = dryRun ? null : Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))));
  const out = await initializeV2({ connection: new Connection(rpc, 'confirmed'), manifest, bootstrap, dryRun, commitment: arg('--commitment') ?? 'finalized' });
  console.log(JSON.stringify(out, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
