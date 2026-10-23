# D4 - upgrade through the upgrade multisig, and a real time lock (devnet)

2026-10-23, `track/payment-security`. Cites AGENT_RULES 2b (founder-issued for task D4). Keys: `C:\Users\Family\flexsoar-devnet-keys\d4\` (D3 keys copied: deployer,
upg_*, gov_*, native_founder/friend; new throwaway: tl_create_key, tl_a, tl_b, tl_c). Signatures: `C:\Users\Family\flexsoar-reviews\devnet-20261023\rehearsal-log.md` (section D4).
Squads transactions are built from `multisig.instructions.*` via `solana/scripts/devnet-squads.mjs`; drivers `devnet-d4.mjs` (`upgrade`, `govcheck`, `timelock`).
Funding was never enabled: paused, caps 0, before and after.

## 1. Upgrade through the upgrade multisig - PASS

- Program `HRqab2EM...Ve1`, upgrade authority before and after: UV `2zvxdkXpXryoewr1pkPhPKySX1kC8M6kQWLSF6soLTkM` (upgrade multisig `4sfcXmXL...rAzo`).
- Buffer `8kxBzcMVfHHn9aqCged9Yh2e4GJcQn4HNrJfYLMUQPPo` written with build B (sha256 `61da352f...defc`, 573,824 bytes) by the deployer, then
  `set-buffer-authority` to UV (CLI accepted a PDA as new buffer authority; `show` confirmed it).
- A 2-of-3 Squads proposal (members `upg_founder`, `upg_friend` approve; `upg_recovery` executes) ran the BPF Loader Upgradeable `Upgrade` instruction with UV as signer.
  Execute tx `1q3e7ZwJzuy7xfF3MVscCHTwD4m9b2T1qF1zN9XMM3hAStW1fwJajFU197exHfaHxLzQw3QEZiTixBeQsmeFCeY`, err null.
- After: last-deployed slot moved 514124563 -> 514133249 (the upgrade really executed); ProgramData length unchanged (700,045 account bytes);
  `program dump` (700,000 bytes): **sha256 of the first 573,824 bytes = `61da352f...defc` = B**, remaining 126,176 bytes all zero.
- Governance after the upgrade: a no-op `set_release_delay(86400)` through the governance multisig succeeded (tx `w6w4kPZU...U1ca`, accounts `[config w, GV s, GV s]`);
  a native `set_pause` was still refused with Custom 6001. Config afterwards: 819 bytes, funding paused, max_trade/max_escrow/outstanding 0, governance_vault GV.
- Scope note: this upgraded to the SAME binary, so it proves the mechanism (buffer authority, multisig execution, authority retention, state preserved), not behaviour of a changed binary or a layout change.

## 2. Time lock - PASS, behaviour recorded

Third throwaway 2-of-3 multisig `GjrgWyfgkrzBc3M1dcmy9XqBnk6febdtGJDjPtnUTWMK` (vault `2RN52XKLz8uG9YYfF7jDvrUEzEmQMX54LmPd9DS9Fr5X`), members tl_a, tl_b, tl_c, `timeLock = 120`,
config authority default, created by tx `2tgBYTje...4dApk`. Governed instruction: a 0-lamport system transfer signed by the vault PDA (a true no-op).

| Event (cluster clock) | Result |
|---|---|
| Proposal approved (2nd approval) | status `Approved`, timestamp 1792731562; earliest execute 1792731682 |
| Execute attempt at +8 s (tx `2svcECbo...AFcGLd`) | **refused**: `Custom 6021` = Squads `TimeLockNotReleased` ("Proposal time lock has not been released", `vault_transaction_execute.rs:70`) |
| Execute attempt at +140 s after waiting (tx `36UuhLgK...gNqzh`) | **succeeded**, err null |

Only two attempts were made, so the exact boundary (+120 s versus later) was not probed. A refused execute still lands on chain and costs its fee (it was sent with `skipPreflight`).
The lock counts from the approval that made the proposal Approved, not from proposal creation.

## 3. Runbook updated (`solana-p1b.md` section 11)

Step 3 now uses direct inventory before deploy (no `init-v2 --dry-run`, which cannot run before deploy); Squads transactions from `multisig.instructions.*` only; members compared as a set;
time lock is a founder decision with default 24 h (86,400 s) for mainnet upgrade multisigs; about 9 SOL peak budget for step 4; and the proven upgrade procedure is written into step 8.

## Proven vs still unverified

Proven (devnet cluster, agave 4.4.0-beta.1): the buffer/authority/multisig upgrade path end to end for an identical binary; state, authority and hash preserved; governance unaffected;
Squads enforces `timeLock` with a clear error and releases it after the interval.

Not verified: an upgrade to a DIFFERENT binary or layout; the upgrade multisig itself being time-locked (the lock was tested on a separate multisig, and the governance/upgrade
multisigs here still have `timeLock = 0`); execution wrapped by a relayer/batch; failed-upgrade recovery (closing an unused buffer); mainnet fees/limits; Squads UI behaviour;
`integrated.mjs` and the database-backed funding gate (unchanged from D3); the 24 h default is a recommendation awaiting the founder's decision.
