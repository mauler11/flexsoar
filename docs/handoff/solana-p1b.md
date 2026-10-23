# P1b: R1 review fixes and devnet prerequisites

> **Superseded in part by `docs/handoff/solana-p1c.md` (R2 review fixes).** Where they differ, P1c wins: `accept_governance_vault` now takes the expected proposal
> revision and must be a direct CPI, the funding gate's API (pinned deployment and raw DB rows, no caller-supplied address), config offsets 691+ (revision then
> 120 reserved bytes), and runbook steps 6c, 6d and 9.

Branch `track/payment-security`, 2026-10-22, on top of P1 (`8b40a7c`). Responds to the independent review
`flexsoar-reviews\proposals-20261022\r1\p1-security-review.md` and founder decisions A-F. **Local only. Nothing was deployed, no network
was touched, no real key was used.** This document **supersedes** `solana-p1-upgrade.md` wherever they differ: account sizes
(section 1 there), vault enrollment (section 3) and the devnet runbook (section 8). The rest of that document stands.

## 1. What changed, against each finding and decision

| Ref | Change |
|---|---|
| R1-01 / A | Fresh deploy only. `ConfigV2` and `SaleV2` gain `layout_version` and reserved zero padding, so a future field takes space from `reserved` instead of needing a realloc. The init script refuses unless the program id owns **no** accounts. The LAYOUT RULE is written into `lib.rs` and section 3 below. |
| R1-02 / B | `install_governance_vault` is **removed**. Enrollment is two-phase: `propose_governance_vault` (current governance) then `accept_governance_vault` (the proposed vault itself, via CPI from the named controller program). Until accepted, native governance is unchanged. |
| R1-03 / C | `solana/scripts/init-v2.mjs`: pinned manifest, genesis check, mainnet refused, fresh-program inventory, `--dry-run`, and a field-by-field read-back after init. |
| D | `execute_outcome` re-checks `authenticated_at + release_delay <= Clock` at the moment money moves. |
| E | `tests/payment-integration/integrated.mjs` adapted (unverified until run); reviewed init script with `--dry-run`; Privy proof plan (section 7); negative-curve enrollment test; pre-funding gate `lib/solana/v2-funding-gate.ts`. |
| R1-04 / F | Requirements added to `docs/handoff/worker-setup-plan.md` section 6b, with a review checklist. |

## 2. Account layout

| Account | P1 (never deployed) | **P1b** | Appended after the P1 fields |
|---|---|---|---|
| `ConfigV2` | 594 | **819** | `pending_vault` @594, `pending_controller` @626, `pending_policy` @658, `layout_version u8` @690, `reserved [u8;128]` @691 |
| `SaleV2` | 993 | **1090** | `layout_version u8` @993, `reserved [[u8;32];3]` @994 (96 bytes) |

Every offset from the pre-P1 layout and from P1 is unchanged. `initialize_v2` sets `layout_version = 1`; `open_sale` sets it on the sale.
Reserved space is sized for foreseeable additions: config room for four more keys, sale room for three more 32-byte values or a dozen
8-byte counters. P1 sizes (594 / 993) never existed on any cluster, so the observers (`v2-observer.ts`, `v2-operation-observer.ts`) now
accept the pre-P1 sizes (961 / 586, for the existing fixtures) and the P1b sizes only.

## 3. The LAYOUT RULE (decision A3)

Accounts are typed, so any change to `ConfigV2` or `SaleV2` makes every account written under the old layout undeserializable, and this
program has no close or realloc instruction. Therefore:

1. A new field must come out of `reserved`; the account size must not change. A unit test pins both sizes (819 and 1090) so a change
   fails in `cargo test` before anything else runs.
2. A change that cannot fit must ship a **migration instruction and tests that run it on old-layout accounts** before the binary is
   upgraded on any cluster. No layout change is deployed on the strength of "it is only appended".
3. `LAYOUT_VERSION` is bumped whenever the meaning of reserved bytes changes.
4. This P1b layout is deployed **fresh only**. Before any deploy the init script inventories the program id; if it owns any account,
   deploy under a new program id. A new program id does not inherit the old program's escrow authority, so a program id that holds
   funds is never replaced this way: it is upgraded only with a tested migration.

## 4. Two-phase vault enrollment (R1-02)

```
propose_governance_vault(vault, controller, policy)      accounts: config(w), first(s), second(s)      [current governance]
accept_governance_vault()                                accounts: config(w), vault(s), instructions sysvar
```
- **Propose** needs current governance (native 2-of-3, or the current vault), funding paused, `vault` off-curve (the runtime curve
  syscall; a wallet-style key is refused), `controller` non-default and not the vault, `policy` non-zero, and the vault not a role
  key. It only writes the pending slot. Re-proposing replaces it. Nothing about who governs changes.
- **Accept** needs the proposed vault to be a **signer**, which only the program that derives that PDA can arrange through CPI, and
  the **top-level instruction's program id to equal the proposed controller** (read from the instructions sysvar), and funding
  paused. Then, once, the pending slot moves into `governance_vault` and `governance_policy` and is cleared. A second accept finds no
  pending vault and is refused.
- **Why both checks:** a signature proves the address is usable; it does not prove it belongs to the program you reviewed. A PDA of a
  permissive program would sign happily. Naming the controller in the proposal, which governors approve, and checking it at accept,
  closes that gap. The policy digest remains an audit reference (the program cannot read a Squads configuration); the check that
  matters is the human verification below.
- **Errors:** `Authority` 6001 (bad proposal inputs, wrong/absent signer address, nothing pending), `Paused` 6004, `WrongController`
  6014, `NoPendingVault` 6013 (defensive; unreachable today because the signer-address constraint refuses first). Runtime: an address
  nobody can sign for fails `AccountNotSigner` 3010 or `PrivilegeEscalation`.

### Ceremony: verify the Squads multisig off chain before the governors approve the proposal

Do this on devnet and again on mainnet, by someone other than the person who created the multisig, and attach the output to the
proposal record. Use Squads' own SDK (`@sqds/multisig`, a dependency not installed in this repo; request it through `DEPS.md` for a
reviewed version) or the Squads CLI to read the account; do not rely on the UI alone.

1. The multisig account is owned by the **Squads v4 program**. Confirm the program id against Squads' own published address (I could
   not verify it from here; the commonly cited id is `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`).
2. **threshold = 2**.
3. **Exactly the three expected members**, by public key, each with the permissions you intend (Initiate, Vote, Execute). No fourth
   member; no member that is also a role or ceremony key.
4. **Config authority is the multisig itself** (autonomous: the config authority field is the default address, so membership and
   threshold can change only through a multisig proposal), not an external key that could change members without a vote.
5. **Time lock** is the value you decided (record it). **Rent collector** is understood.
6. Recompute the vault PDA from `(multisig, vault index 0)` with the SDK's `getVaultPda` and confirm it equals the address in the
   proposal byte for byte; confirm `controller` equals the Squads program id from step 1.
7. `transaction_index` equals `stale_transaction_index` (no leftover queued transactions that could execute under the new vault).
8. Only then do the two governors approve; after acceptance read `governance_vault` and compare again.

## 5. `init-v2.mjs` (decision C and the fresh-deploy inventory of A2)

```
node solana/scripts/init-v2.mjs --manifest m.json --rpc <url> --dry-run
node solana/scripts/init-v2.mjs --manifest m.json --rpc <url> --keypair <bootstrap.json> [--commitment finalized]
```
Manifest (all fields required, no unknown fields): `cluster` (`devnet` or `localnet`), `genesisHash`, `programId`, `mint`, `domain`,
`policyDigest` (64 hex), `treasury`, `bootstrap`, `roles` (issuer, inventory, receiver, authenticator, reviewer, release, reconciler,
guardian), `governance` (3 native keys). Refuses, before anything is signed: an incomplete manifest or a duplicate or default key; a
`domain` that is not the pinned genesis hash; **RPC genesis different from the pinned one**; mainnet-beta (always); a program that is
not an upgradeable program or whose upgrade authority is not `bootstrap`; a mint that is not a 6-decimal token mint; **any account
owned by the program id** (STOP: use a fresh program id) or an existing config. `--dry-run` simulates and prints the exact accounts and
instruction data and needs no key. A real run signs only with the `--keypair` you name (never a default wallet), then reads the
config back at the chosen commitment and **refuses on any single differing field** (all 23 byte regions are tested).
`solana/scripts/init-v2.d.mts` types it for the TypeScript tests.

## 6. Pre-funding gate (`lib/solana/v2-funding-gate.ts`)

`checkFundingGate(rpc, program, configAddress, governanceModeRow, expectedGenesis)` reads the config at finalized commitment and fails
unless: layout version 1; domain equals the pinned genesis; no vault proposal pending; on-chain `release_delay` is **at least** the
database `release_delay_seconds`; and, for `solo`, delay >= 86,400 s, the vault is active (native governance gone) and the database
has exactly 2 governors. It reports all failures at once and treats a missing, foreign, wrong-size or wrong-type account as a failure.
**It is a function, not yet a wired step**: the worker milestone (section 6b of the worker plan) must call it before any funding-enable
approval. Until then, run it by hand.

## 7. Privy `signMessage` proof plan (decision E; STOP if Privy wraps messages)

The seller signs 61 raw bytes. The program needs a plain Ed25519 signature over **exactly** those bytes. Privy embedded Solana wallets
expose `signMessage`; whether it signs the bytes as given (no prefix, no domain wrapping, no UTF-8 re-encoding) is unverified.

1. In a Privy development app (test environment, a throwaway embedded wallet, no funds), build the vector message with
   `encodeListing` (the shared vector: inputs `[1;32] [2;32] [3;32] [4;32]`, generation 5, floor 1,000,000, expiry 1,900,000,000;
   61 bytes, SHA-256 `f7125fc0f364c4134469517178192ce16d44875818d6cd30e5768cdf28de9830`).
2. Call the wallet's `signMessage` with those bytes as a `Uint8Array`. Do not pass a string.
3. Verify with `verifyListingSignature(walletPublicKey, messageBytes, signature)`. **PASS only if it returns true for the unmodified
   61 bytes.**
4. Negative control: verify the same signature against the bytes prefixed with `"\xffsolana offchain"` and against the hex string of
   the message. Both must be false (this shows the check can fail).
5. Repeat with a message containing bytes `0x00`, `0xff` and a leading `0x00`, to catch UTF-8 or string coercion.
6. Run one full local pass: feed the signature to `openSaleWithListing` and confirm the Ed25519 precompile accepts it on the local
   validator (the harness already does this with a local key).
7. **STOP if step 3 fails, or if any variant passes only after re-encoding.** Do not "fix" it by changing what the program verifies. A
   wrapping wallet means the seller flow cannot use that signing method; the options are a different Privy signing API, a different
   wallet connector, or an offchain-message-format change to the program, which is a layout/contract change and needs its own review.

## 8. `execute_outcome` recheck (decision D)

`authorize_release` already enforced the delay. `execute_outcome` now also requires `now >= authenticated_at + release_delay` when the
decision is a release (`ReleaseDelay` 6011), so the guarantee holds at the moment tokens move even if the Clock regressed between the
two. Refunds are not subject to it. **Test coverage, honestly:** the on-chain suite proves the recheck does not block a legitimate
release (every release outcome in the suite passes through it) and the Rust unit test `release_is_rechecked_against_the_clock_at_execution`
proves the predicate, including the equality boundary and overflow failing closed. There is **no** on-chain negative test: an honest
instruction sequence cannot authorize a release before the delay (`authorize_release` refuses), so the only state that would trip the
recheck needs the Clock to move backwards, which a validator test cannot produce.

## 9. Results

Verified on the **committed tree `7c56f73`** (program, script, app and tests; this document is the only later change), nothing else
running:

| Check | P1 (`8b40a7c`) | **P1b** |
|---|---|---|
| Rust unit tests (`cargo test --locked --lib`) | 14 | **16** pass (2 new: execution recheck, layout/size pin) |
| Local-validator on-chain groups | 137 | **165** pass, `RUN_EXIT=0`, process exits by itself |
| &nbsp;&nbsp;of which | 84 original + 53 new | 84 original + **12 init-script** (9 refusals, dry run, real run + read-back, second-run refusal) + **69 new** |
| `npm test` | 645 | **677** pass, 32 files (+32: 25 init script, 7 funding gate) |
| `tsc --noEmit`, eslint on touched files | clean | clean |
| Payment DB suites / migration 083 | container `T083_RUN_PASS` | unchanged and **not re-run** (P1b changes no SQL) |

- **`.so`:** sha256 `0e4c710c221b4f1599a3af6303d18fb9f32c0f6e2910480f0b0bde122f4902dd`, rebuilt from the committed tree and equal to the
  build used for the earlier runs. (551,656 bytes; P1 was `437c0c7b...64ecda`, 553,896 bytes.) No SBF stack-frame diagnostics.
- **Peak memory of the suite:** 1,628,984 kB resident (the validator), 3 min 41 s wall. Earlier P1b runs peaked at 1.62-1.66 GB.
- **A note on a process leak found on the way:** the successful P1 verification run and one P1b run did not exit by themselves (the
  web3.js websocket client retries a stopped validator forever, 1,000+ `ws error` lines) and sat holding memory until killed; I stopped
  both. `local-v2.mjs` now ends with `process.exit(0)` on success, and the committed-tree run above exited on its own.

**On-chain groups added (69), each refusal asserting the program's own custom code:** the 53 P1 groups, with the vault section replaced
by: proposal refusals (funding live, on-curve key = the **negative-curve** test, zero policy, zero controller, controller = vault, one
governor; all `Authority` 6001 and none changes state); **typo/unsignable address**: proposed, pending slot set, `governance_vault`
still zero, native `set_release_delay`/`set_pause` still work, accept refused (`AccountNotSigner` 3010, then runtime
`PrivilegeEscalation` when a program offers to sign for it); **vault that never accepts**: native governance works; **wrong controller**:
valid vault signature from the wrong top-level program (`WrongController` 6014); **wrong program**: the named controller cannot sign for
a PDA it does not own (`PrivilegeEscalation`), and its own PDA is not the pending vault (`Authority` 6001); accept while funding is live
(`Paused` 6004); accept succeeds once, pending slot cleared, policy stored; replay refused; every native governed instruction then
refused; natives cannot re-propose; vault + one native key refused; vault unpauses; guardian pauses alone with the vault installed;
natives cannot unpause; vault sets the delay. Also: layout version and zero reserved bytes asserted on the config after init and on a
sale after open. "Nothing pending" is refused with `Authority` 6001 from the signer-address constraint, **not** `NoPendingVault` 6013
(unreachable while the constraint exists; kept as a defensive check).

### Compute units (local validator; whole transaction)

| Instruction | P1 committed-tree run | P1b committed-tree run | Note |
|---|---|---|---|
| `open_sale` | 48,250 - 60,250 (6) | 49,461 - 61,461 (6) | +1,211 on each of the three matched sale ids in this pair of runs |
| `buy_sale` | 49,658 - 55,291 (5) | 52,613 - 56,746 (5) | winner varies per run |
| `authorize_release` | 15,915 - 15,917 (3) | **17,125 - 17,127 (3)** | **+1,210, stable across both P1b runs** |

Read these with the noise in mind: `open_sale` and `buy_sale` spend CU on PDA bump searches that depend on keys generated fresh each
run, and the same unchanged P1 program measured 52,750 in one run and 57,250 in another for the first sale. A mid-development P1b run
gave 52,461 for that sale (-289 against P1), the final run 53,961 (+1,211). **No `open_sale`/`buy_sale` change attributable to P1b can be
claimed from this.** `authorize_release` has no PDA search and was identical in both P1b runs, so its +1,210 CU (about 7.6%) is real;
the likely cause is reading and writing the 97 extra bytes of `SaleV2`, which I did not verify. All figures are far under the 200,000 default.
`execute_outcome` was not measured before or after.

## 10. Existing tests changed because the new contract forces it

Everything not listed is untouched. No existing TypeScript test file was edited; no SQL, migration or DB test changed.

| File | Change | Why |
|---|---|---|
| `lib.rs` test `account_sizes_only_grew_at_the_tail` | constants 594/993 -> 819/1090 | the layout fields and reserved padding change the sizes (forced) |
| `lib.rs` test `fault_codes_are_append_only` | two codes added to the table | `NoPendingVault` 6013, `WrongController` 6014 (extends; no code moved) |
| `lib.rs` test `release_delay_is_bounded_and_snapshotted_per_sale` | the `ConfigV2` literal gains the new fields | struct literal must name every field (forced) |
| `local-v2.mjs`, original groups | initialization goes through `init-v2.mjs` after its refusals are exercised; the first (refused, wrong bootstrap) raw call is kept | **a choice, not forced**: it makes the real script the thing the suite tests against the real program |
| `local-v2.mjs`, sale length | 993 -> 1090, plus `layout_version`/reserved assertions | forced by the layout |
| `local-v2.mjs`, governance section | rewritten for propose/accept; a second mock program; `FAULT` table gains 6013/6014 | `install_governance_vault` no longer exists (forced); these are P1-added scenarios, not original ones |
| `local-v2.mjs`, end of file | `process.exit(0)` after the `finally` | the suite otherwise never exits on success (see section 9) |
| `observers` (`v2-observer.ts`, `v2-operation-observer.ts`) | accepted sizes 993/594 -> 1090/819 | P1 sizes never existed; the old 961/586 fixtures still decode, so no observer test changed |
| `tests/payment-integration/integrated.mjs` | open as `[Ed25519 listing, open_sale]`, issuer pays, sysvar in the lookup table | the program refuses the bare instruction (forced) |

## 11. Devnet runbook (founder-run; replaces section 8 of `solana-p1-upgrade.md`)

Nothing below has been run. Use devnet-only deployer and role keys unless you are deliberately rehearsing the real ceremony. `STOP`
means do not continue until resolved.

0. **Build and pin.** Reproduce the `.so` (hash in section 9). Run `cargo test --locked --lib`, then
   `FLEXSOAR_MOCK_VAULT_SO=<mock_vault.so> bash solana/tests/run-local-v2.sh <so>`; all groups must pass.
1. **Keys.** Deployer `D` (about 10 devnet SOL; see the step 4 budget); eight distinct role keys; native ceremony keys `founder_hw`, `friend_hw`,
   `ceremony_key` (throwaway); the Squads **governance** multisig (2-of-3) and a **separate** Squads **upgrade** multisig (different
   members). Record the governance vault PDA `GV` and the upgrade vault PDA `UV`.
2. **Manifest.** Write the manifest (section 5): devnet genesis hash, program id, devnet USDC mint, `domain` = genesis hash.
   Have a second person read it against the sources of each value.
3. **Program id inventory (A2), BEFORE deploy (D3/D4: do NOT run `init-v2 --dry-run` here; it requires an already deployed program whose
   upgrade authority is the bootstrap key, so it refuses by design).** Use direct reads through the genesis guard: `getAccountInfo(programId)` must be
   null, `getProgramAccounts(programId)` must be empty, `getAccountInfo(config PDA)` must be null (D3: `devnet-d3-steps.mjs preflight`). The `--dry-run`
   belongs after step 4 (deployed, authority `D`). **STOP if the
   program owns any account** (any V2 config, card or sale). In that case deploy under a new program id (new keypair, `declare_id!`,
   `Anchor.toml`, rebuild, new hash) and re-run. Never reuse a program id that holds funds.
4. **Deploy with a buffer.** Budget about **9 SOL peak** for `--max-len 700000` (about 4.87 SOL programdata rent plus about 3.99 SOL buffer rent
   held until the deploy consumes it; about 3.6 SOL net after the buffer is closed), so fund the deployer with margin from the official faucet only.
   `solana program write-buffer`, then `solana program deploy --buffer <BUFFER> --program-id <keypair>
   --upgrade-authority D.json --max-len 700000 --url devnet`. `solana program dump` and compare the first bytes to the `.so`.
5. **Initialize.** Dry run again (the program now exists and the authority is `D`), then the real run with `--keypair D.json`. **STOP**
   unless the script prints `verified: true` (it has read the config back and every field matches). Read config offsets yourself:
   length 819, `layout_version` 1, funding paused, caps 0.
6. **Ceremony, funding paused, caps 0.** (D3/D4 corrections: build EVERY Squads transaction from `multisig.instructions.*` and send it with your own
   sender that waits for the recorded status (`solana/scripts/devnet-squads.mjs`); do NOT use `multisig.rpc.vaultTransactionCreate`, which failed from
   this client in D3. Compare multisig members as a SET: on-chain order is sorted by key. The **time lock is a founder decision**: record the value in the
   manifest; default **24 h (86,400 s) for mainnet upgrade multisigs**; D4 proved on devnet that a 120 s lock refuses early execution with Squads
   `TimeLockNotReleased` 6021 and allows it afterwards.)
   a. `set_release_delay(86400)` signed by two native governors (native governance still works).
   b. Verify the Squads multisig off chain (section 4 checklist) and record it.
   c. `propose_governance_vault(GV, <Squads program id>, policy)` signed by `founder_hw` + `friend_hw`. Read the pending slot back.
      Native governance must still work at this point (try a harmless `set_release_delay(86400)`).
   d. Through Squads, execute `accept_governance_vault` (accounts `config`, `GV` as signer, instructions sysvar). **STOP if it fails**:
      native governance is still in force and nothing is lost; fix the Squads side or re-propose.
   e. Verify: `governance_vault` equals `GV`, pending slot empty, native `set_pause` refused. Then destroy `ceremony_key`.
7. **Prove Squads compatibility with no funds at risk.** Through the multisig, execute `set_release_delay(86400)` (a no-op change)
   with accounts `[config (w), GV (s), GV (s)]`. If it fails, **STOP**: the fallback is a program change, not a workaround.
8. **Hand over the upgrade authority** (only now): `solana program set-upgrade-authority <ID> --new-upgrade-authority <UV>
   --skip-new-upgrade-authority-signer-check -k D.json --url devnet`; confirm with `solana program show`. Later upgrades follow the
   LAYOUT RULE and go through the upgrade multisig. **Proven procedure (D4, `devnet-d4.mjs upgrade`):** `write-buffer` with `D`; `solana program
   set-buffer-authority <BUFFER> --new-buffer-authority <UV>`; a 2-of-3 Squads vault transaction on the upgrade multisig executes the loader `Upgrade`
   instruction (accounts: programdata w, program w, buffer w, spill w, rent, clock, UV signer); then dump and compare the first bytes to the `.so` hash.
9. **Pre-funding gate.** With the database in the intended mode, run `checkFundingGate`; it must report no failures before any
   funding-enable approval.
10. **Privy proof** (section 7) before any seller flow is trusted; then the P1 rehearsal checklist of the earlier runbook.
11. **Abort at any step:** funding stays paused (the program starts paused); the guardian can `emergency_pause`; nothing here enables
    funding with real money.

## 12. Unverified

1. **The real Squads program, end to end.** Accept is proven only against a mock that signs a PDA through `invoke_signed` as the top-level
   instruction. Real Squads must make `accept_governance_vault` happen from `vault_transaction_execute`, which I expect is the top-level
   instruction (so the controller check holds) but have not seen run. If execution is ever wrapped by another program (a relayer or
   batch), the controller check fails closed with 6014. The devnet runbook steps 6d and 7 are the test.
2. **The Squads multisig checklist (section 4)** uses field names and the program id recalled from Squads' published documentation; I
   could not fetch or verify them from here. It tells the verifier to use Squads' own SDK, not my decoder.
3. **`init-v2.mjs` has run only against a fake RPC (25 unit tests) and a local validator.** Not against devnet: public RPCs may rate
   limit or restrict `getProgramAccounts`, which the fresh-program inventory relies on; confirm it works there during the dry run, and
   fall back to an indexed RPC rather than weakening the check.
4. **`integrated.mjs` was edited but not run** (needs the preserved integration containers). Authority-evidence matching is by program
   id, so the extra Ed25519 instruction should not disturb it; that is reading, not running.
5. **Privy `signMessage`** (section 7): a plan only. Nothing was run against Privy.
6. **The pre-funding gate is a function and a test, not a wired step.** Until the worker calls it, running it is a manual runbook step.
7. **The execute-time recheck has no on-chain negative test** (section 8); it is covered by a unit test of the predicate plus the
   on-chain proof that legitimate releases pass it.
8. **Reserved padding sizes (128 bytes config, 96 bytes sale) are judgments** about foreseeable fields, not measurements. The LAYOUT
   RULE, not the padding, is what protects future changes.
9. **Compute figures** are local and noisy for `open_sale`/`buy_sale` (section 9); `execute_outcome` is unmeasured. The `authorize_release`
   increase has a plausible but unverified cause.
10. **Carried over from P1, unchanged:** nothing was run on devnet or mainnet; migration 083 is container-tested only and no worker calls
    its RPCs; the real seller-UI flow does not exist yet (worker plan section 6b is its specification).
