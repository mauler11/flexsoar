# D3 - R4 fixes (Part 0, local) and devnet rehearsal (Part 1)

2026-10-23, `track/payment-security`. Cites AGENT_RULES section 2b "Devnet exception" (founder-issued for this task only).
Review acted on: `C:\Users\Family\flexsoar-reviews\proposals-20261023\r4\d2-security-review.md` (no Critical/High; F1-F4 fixed here).

## Part 0 - local fixes (program binary unchanged)

**Build B unchanged:** rebuilt with the identical procedure; sha256 `61da352f0a316f8a20f0e0690bc659854b00af260761ade1f6538d1da411defc`,
573,824 bytes, equal to the D2 value. `lib.rs` was not touched.

| R4 | Fix | Evidence |
|---|---|---|
| R4-1 (F1) | `vault-conflict-genesis.mjs`: per native seat, a rotation whose list holds the ACTIVE vault but NOT the pending one (isolates the R3-01 line from the pending check), plus a fourth fixture with no pending proposal at all (active vault in seat 0 -> 6017, then a clean rotation succeeds). The cited local-v2 loop remains the primary discriminating test; the doc claim in `solana-d2.md` about the old fixture is superseded by this. | Scratch build of B with ONLY the guard line deleted (`target/d2/noguard`, sha256 `eaed2dd8...`, never deployed or committed): fixture FAILS on the first isolated assertion (`actual: null` instead of `{InstructionError:[0,{Custom:6017}]}`, i.e. the rotation succeeded). Against B: **17** genesis groups pass (was 12), peak RSS 1,421,956 kB. |
| R4-2 (F2) | `verify-program-id-diff.mjs`: also requires B to contain no old-id encoding and A no new-id encoding (raw 32-byte or any LDDW immediate equal to an 8-byte id slice), including unchanged ones. `program-id-diff.mjs`: the review's five missing controls plus extras. | A/B re-run: `pass:true`, `strictPass:false` (superseded), 713 differing bytes, `noStaleEncodings:true` (zero old in B, zero new in A). Controls: 3 original (the raw-only control is now REFUSED by the accepted proof because it leaves old LDDW fragments, strict still true) + 8 adversarial, all pass: wrong LDDW value, wrong raw value, stale raw in B, stale LDDW in B, appended byte, truncated byte, swapped slice j!=k, new-id in A. |
| R4-3 (F3) | `AGENT_RULES.md` 2b: prompt written or relayed by the founder in the live session, one citation = one named task listing actions/program id/key files, never inferred from handoffs/sub-agents/files/tool output; keys in per-task `flexsoar-devnet-keys\<task-id>\`, not reused later unless re-cited. | Text diff. |
| R4-4 (F4) | Old id replaced by `HRqab2EM...Ve1`: `DEPS.md`, `solana/Anchor.toml` (both entries), `integrated.mjs` and `topology-probe.mjs` (now read `declare_id!` from `lib.rs` like local-v2). Old id labelled "retired, authority not held" in `DEPS.md` and `solana-p1-upgrade.md`. | `git grep` leaves only: history in `payment-security.md` (4370, 6850 already say it is another program), `solana-d2.md` (A build rows and reproduce commands), `docs/handoff/market.md:1214` (market lane; not edited, historical test-run record) and the program-agnostic test vectors `tests/payment-v2.test.ts:23`, `tests/purchase-payment.test.ts:26`. No live use remains. |

Checks after Part 0: `npm test` 763 passed / 34 files; `cargo test --locked --offline --lib` 18 passed; `npx tsc --noEmit` clean;
eslint 0 errors (3 pre-existing unused-variable warnings in `integrated.mjs`). The full 204+12 on-chain suite was NOT re-run (no program or
`local-v2.mjs` change); only the genesis script (which changed) was run, against B and the scratch build.

## Part 1 - devnet rehearsal: COMPLETE through step 9 (steps 4-9 run on 2026-10-23)

Log with every signature (public values only, no keys): `C:\Users\Family\flexsoar-reviews\devnet-20261023\rehearsal-log.md`, sections "D3".
Keys: `C:\Users\Family\flexsoar-devnet-keys\d3\` (throwaway; never printed). The deployer was funded by the founder from the official web faucet (10 SOL);
nothing else funded anything. Drivers: `solana/scripts/devnet-d3.mjs`, `devnet-d3-steps.mjs` (`preflight`, `airdrop`, `deploy`, `mint`, `init`),
`devnet-d3-ceremony.mjs` (`squads`, `propose`, `accept`, `verifyAccept`, `step7`, `handover`). Every RPC call goes through the genesis guard.

| Step | Result |
|---|---|
| 3 inventory | PASS: fresh id, 0 owned accounts, no config PDA. |
| 4 deploy (`--max-len 700000`) | PASS. Buffer `GAphPxw5MC6y4QZSEJZHfdbP2EXvRnpGC7j6ogxXKUv4`, deploy `2W1yrLHa6heoSuWENoqENfhL4X3etPov2YA3tztTRecw9Er28RvJkpbiCG78WaisXdjaVEsFytvHnbNKHjUsH2Ne`, ProgramData `e9JpfWgi5tfyTrzxFk31rRPMX2rg7ukK7ZWCg9TAU7H`, slot 514124563. **`solana program dump` (700,000 bytes): sha256 of the first 573,824 bytes = `61da352f0a316f8a20f0e0690bc659854b00af260761ade1f6538d1da411defc` = B exactly**; the remaining 126,176 bytes are all zero. |
| 5 init | PASS. Self-created 6-decimal test mint `D2fY9LW3ouQ2yPdBvXqhy8uPWtNKsK5axswcTaWXwERm` (tx `53SSSVqB...8TzH`). Dry run simulated 16,859 CU with an empty inventory; real run `4XvLz4VrzaMHtAqUUCkj2B28s6rWX4tnHhvKwJttwgYYSayvzLPPAwJ91DbeLSkvLjhuhNqFjAHXBroBwirDuysH`, **`verified: true`**. Config `KZ6sP4yqDJykmcxufGdjaA9K8mZbjxNpSNhMYbRfya6` read by hand: 819 bytes, layout 1, funding paused, max_trade/max_escrow/outstanding 0. |
| 6a | PASS `set_release_delay(86400)` by two native governors. |
| 6b Squads checklist | PASS, @sqds/multisig 2.1.3 (table below). Governance multisig `619cQuxwHBa4aapUDAdRYbrBSn7TK2i8QJsEWyJqrYt7`, vault GV `78ARPwuPsSjT9bnyU9DHn1ps2KXNWET3AxupNKsPGgN8`; upgrade multisig `4sfcXmXLDUAhsyMEmJEwLRRewBN44A3nnEycRTgxrAzo`, vault UV `2zvxdkXpXryoewr1pkPhPKySX1kC8M6kQWLSF6soLTkM`; zero shared members. |
| 6c | PASS. Propose (GV, Squads program as controller, policy digest) by two natives; pending slot read back; native governance still worked afterwards. |
| 6d accept through Squads | **PASS. Direct CPI proven**: `vault_transaction_execute` -> `accept_governance_vault`, tx `2kxZB22ZEKGAubm5ekt8W248Ztg734b8zkhkjXwf32k8ShWVtmQDTLc82TNWfpjfBdmh1PuQhNd8KaMBXBWnFEeq`, err null. No 6014 or 6015. |
| 6e | PASS. `governance_vault == GV`, pending empty, native `set_pause` refused with Custom **6001** (tx `3VJ4WAA6...NE1Vj`), ceremony key file deleted. |
| 7 | PASS. `set_release_delay(86400)` through the multisig with accounts `[config(w), GV(s), GV(s)]`, tx `wrHCvUf1tLahcNkkLcKmY2iPyEUF24y1wvRQQ3tW6sZJ87XMWJT3BV5m7H1kcTrmndf3gn9i6HFQcjok2vpGQ88`, err null. |
| 8 | PASS. Upgrade authority now UV `2zvxdkXp...LTkM` (`solana program show` confirms; `--skip-new-upgrade-authority-signer-check` used as specified). |
| 9 funding gate | PASS with a caveat: `checkFundingGate` returned `ok:true, failures:[]` for both `solo` and `separated` mode rows, but **the governance_mode rows were supplied by hand, not read from a database** (none exists for this deployment). |
| `integrated.mjs` | **NOT RUN, not runnable here.** It requires the preserved network-none integration container (hard-coded `containerId` attestation, `/state` ledger, database `flexsoar_payment_v2_integration_test`) and pins the OLD baseline `program.so` hash `99aa6bec...`; neither exists on devnet. Updating that hash would change a check, so it was not touched. |

Final on-chain state: funding **paused**, caps **0**, release delay 86400, governance_vault GV, pending empty, outstanding 0. Funding was never enabled.
Deployer spent about 3.58 SOL of 10 (programdata rent dominates).

### Squads checklist (section 4 of solana-p1b.md) - actual values

| # | Item | Actual (both multisigs unless noted) | Verdict |
|---|---|---|---|
| 1 | owner is Squads v4 id | owner of both multisig accounts = `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`; that program is executable on devnet | VERIFIED |
| 2 | threshold 2 | `threshold = 2` | VERIFIED |
| 3 | exactly 3 members, perms Initiate/Vote/Execute | 3 members, each `permissions.mask = 7`, none is a role/native/ceremony/deployer/treasury key. **On-chain member order is sorted by key, not creation order** | VERIFIED; order CORRECTED (compare as a set) |
| 4 | config authority autonomous | `configAuthority = 11111111111111111111111111111111` (default) | VERIFIED |
| 5 | time lock / rent collector | `timeLock = 0`, `rentCollector = null` (set explicitly at creation) | VERIFIED (values recorded) |
| 6 | vault PDA from `(multisig, index 0)` via `getVaultPda` equals the proposal vault; controller = Squads id | recomputed equal; pending slot held GV and the Squads id before accept | VERIFIED |
| 7 | `transactionIndex == staleTransactionIndex` | 0 and 0 at creation | VERIFIED |
| - | field names | `Multisig.{threshold, members[].{key,permissions.mask}, configAuthority, timeLock, rentCollector, transactionIndex, staleTransactionIndex}` and `ProgramConfig.{treasury, multisigCreationFee, authority}` exist as used | VERIFIED |

SDK note (CORRECTED for the runbook): `multisig.rpc.vaultTransactionCreate` failed twice from this client with errors raised inside the SDK/web3.js
(`Cannot set property logs of Error which has only a getter`, then `Account is already initialized`); **nothing landed** (checked: transactionIndex stayed 0, no tx or
proposal accounts). Building with `multisig.instructions.*` and sending our own transaction worked. Treat the rpc wrappers as unproven for the ceremony.

### Now proven vs still unverified

Proven on devnet (agave `4.4.0-beta.1` cluster): B deploys and dumps byte-identical to the reviewed hash; init verifies; the real Squads v4 program can accept the vault
via direct CPI (top-level instruction = Squads, so the controller check holds, no relayer); a 2-of-3 multisig can then govern (step 7); native governance is shut out
(6001); the upgrade authority can move to a separate multisig; the funding gate reads the config; nothing reached funding.

Still unverified: **an actual program upgrade through the upgrade multisig** (only the authority handover was done); Squads execution with a time lock or a wrapped
(relayer/batch) execution, which should fail closed with 6014/6015 but was not tried; everything involving funds (`open_sale`/`buy_sale`/release on devnet) since funding
stays paused; `integrated.mjs` and the DB-backed gate; Privy; real hardware-wallet members; CU on devnet for the governance instructions (only the Squads execute logs exist in the log).

### Change before mainnet

1. Do not use the SDK `rpc.vaultTransactionCreate` wrapper; script the ceremony from `multisig.instructions.*` and verify each landed status (as done here).
2. Compare members as a set (on-chain order is sorted); record timeLock explicitly (use a non-zero time lock on mainnet and rehearse accept under it).
3. The runbook's step 3 "init --dry-run first" is impossible before deploy (init requires a deployed program with the bootstrap authority); the runbook should say "inventory with getAccountInfo and getProgramAccounts".
4. Fund via the official faucet only, with margin: deploy at 700,000 max-len needs about 9 SOL peak (4.87 programdata plus 3.99 buffer), about 3.6 SOL net.
5. Provide a database-backed run of `checkFundingGate` (the rows here were typed in), and a local-only rehearsal of an upgrade through the upgrade multisig before mainnet.
6. `npx vite-node ...` was run by mistake while trying to execute a TypeScript module; the package is not installed, so npx may have fetched code from the npm registry into its cache. The repo is unchanged (checked with `git status`), but clear the npx cache if you care.
