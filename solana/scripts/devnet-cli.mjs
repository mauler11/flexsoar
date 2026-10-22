/** Runs the Solana CLI (installed in WSL Ubuntu) against DEVNET only, behind the devnet guard.
 *
 *   node solana/scripts/devnet-cli.mjs <solana arguments...>          e.g.  program show <ID>
 *
 * The genesis hash is fetched and compared (devnet guard, AGENT_RULES 2b) immediately before the CLI starts, and `--url` is always
 * this script's devnet URL; an argument that supplies its own --url/-u or contains "mainnet" is refused. It never reads a default
 * wallet: a command that needs a signer must be given --keypair <explicit path> by the caller. Output is printed as the CLI wrote it. */
import { spawnSync } from 'node:child_process';
import { guardedConnection } from './devnet-guard.mjs';

export const RPC = 'https://api.devnet.solana.com';
const SOLANA = '/home/family/.local/opt/flexsoar-tools/agave-2.1.0/solana-release/bin/solana';

/** Windows path -> the same file as seen from WSL. */
export const wslPath = p => p.replace(/^([A-Za-z]):[\\/]/, (_m, d) => `/mnt/${d.toLowerCase()}/`).replaceAll('\\', '/');

export async function devnetCli(args, { connection } = {}) {
  for (const a of args) {
    if (/mainnet/i.test(a)) throw new Error('devnet-cli refused: an argument contains "mainnet"');
    if (a === '--url' || a === '-u' || a.startsWith('--url=')) throw new Error('devnet-cli refused: the URL is fixed to devnet; do not pass --url');
  }
  const guard = connection ?? guardedConnection(RPC).connection;
  await guard.getGenesisHash(); // throws unless this is the pinned devnet cluster
  const quoted = [...args, '--url', RPC].map(a => `'${String(a).replaceAll("'", "'\\''")}'`).join(' ');
  const run = spawnSync('wsl', ['-d', 'Ubuntu', '--exec', 'bash', '-c', `${SOLANA} ${quoted}`], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  devnetCli(process.argv.slice(2)).then(r => { process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.status ?? 1); }).catch(e => { console.error(e.message); process.exit(1); });
}
