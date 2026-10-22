# P1: single program upgrade (seller-signed floor, release delay, vault governance)

> **Superseded in part by `docs/handoff/solana-p1b.md` (R1 review fixes).** Where they differ, P1b wins: account sizes (now 819 / 1090), vault enrollment
> (`install_governance_vault` is removed in favour of propose/accept), and the devnet runbook. Everything else here stands.

Branch `track/payment-security`, 2026-10-22, built on `9cf20e2`. Implements the approved S1 design
(`docs/handoff/solo-operator-design.md` sections 3.3 and 5). **Local only. Nothing was deployed, no network was touched, no real
key was used or created.** Throwaway keypairs exist only in memory in the test harness; the SBF build wrote a throwaway
program keypair to a WSL cache directory outside the repo, which is not committed.

## 0. Read first: three things that differ from, or were not in, the approved design

1. **The listing message is 61 bytes, not 165.** The design signs the five bound fields inline
   (`tag || domain || program || card || sale_id || generation || min_total || expiry`). Measured with the real web3.js
   serializer, that makes the `open_sale` transaction **1,276 bytes against the 1,232-byte packet limit** (still 1,236 with the
   compute-budget instruction removed), so it cannot be sent at all. Shipped form:

   ```
   "FSOARV2-LIST\0" (13) || binding (32) || min_total u64le (8) || list_expires_at i64le (8)      = 61 bytes
   binding = SHA-256( domain || program || card || sale_id || generation u64le )
   ```
   It binds exactly the same five fields, so the security argument is unchanged; the transaction is **1,172 bytes (60 spare)**.
   The seller's wallet shows 61 opaque bytes instead of 165; both are unreadable to a human, so the app must show the price,
   floor and expiry itself (it computes them, so it can). **The `open_sale` transaction must be fee-paid by the issuer.** With a
   separate payer it is 1,268 bytes and fails to serialize.

   | `open_sale` transaction (v0, one lookup table) | bytes | vs 1,232 |
   |---|---|---|
   | before P1 (no listing), separate payer | 1,059 | fits |
   | 165-byte message, issuer pays | 1,276 | **over by 44** |
   | 165-byte message, issuer pays, no compute-budget ix | 1,236 | **over by 4** |
   | **61-byte message, issuer pays (shipped)** | **1,172** | fits, 60 spare |
   | 61-byte message, separate payer | 1,268 | over by 36 |

2. **`install_governance_vault` could never have run on chain.** It called `Pubkey::is_on_curve()`, which is
   `unimplemented!()` on the SBF target (the solana-pubkey 2.4.0 source in the local registry cache has `#[cfg(target_os = "solana")] unimplemented!();`). The program
   panics (`ProgramFailedToComplete`) whenever the instruction reaches that check. No earlier test called the instruction, so it
   was invisible, and the approved ceremony (design 3.3.2 step 2) would have failed at that step. The new local suite caught it.
   Fixed by `is_off_curve()`, which asks the runtime's `sol_curve_validate_point` syscall on chain (and `is_on_curve` natively).
   **This is a fix to code that was already in the reviewed baseline; review it as such.**
3. **Existing tests that necessarily changed.** The new `open_sale` requires the listing instruction and an extra account, and
   `SaleV2` grew, so `solana/tests/local-v2.mjs` changed in four places in its original scenarios: the `open_sale` call
   (listing instruction first, issuer pays, instructions sysvar added), the account-length assertion (961 -> 993, plus two
   assertions on the stored floor and expiry), `send()` gaining an optional fee-payer argument, and CU logging. Every other original assertion is untouched, all 84 original groups still pass, the 8 original Rust tests and all
   637 original TypeScript tests pass unchanged. `tests/payment-integration/integrated.mjs` is **not** updated and **will fail
   at `open_sale`** against this program until adapted (section 7).

## 1. What the program now does

| Change | Where | Behaviour |
|---|---|---|
| Seller-signed floor | `open_sale` | Needs an Ed25519 precompile instruction **immediately before** it, signed by `card.owner`, over the canonical 61-byte message for exactly this domain/program/card/sale/generation. Stores `min_total` and `list_expires_at` in the sale. `open_sale` instruction data is unchanged (still 698 bytes); the floor and expiry are read from the verified message, so they cannot disagree with what the seller signed. |
| Floor enforced | `buy_sale` | `now < list_expires_at` (else `ListingExpired`), then `p.total >= min_total` (else `BelowFloor`). A sale with no listing (`min_total = 0`, `list_expires_at = 0`) can never be bought: it fails closed. |
| Replay safety | both | The message names the sale id and the sale account can only be created once; the message names card, generation, network (domain) and program. A signature for sale A is refused on sale B (`ListingInvalid`). `revoke_sale` + a new sale id + a new signature is the re-list path, as designed. |
| Release delay | `record_authentication` (pass), `review_authentication` (pass), `authorize_release` | A passing authentication stamps `authenticated_at` and **snapshots `config.release_delay` into the sale**. `authorize_release` needs `now >= authenticated_at + sale.release_delay` (`ReleaseDelay`). Snapshotting means governance lowering the delay later cannot shorten an in-flight sale. A failed authentication starts no clock; a passing review does. |
| Governance sets the delay | `set_release_delay(i64)` (new) | Governed (`govern()`), funding must be paused, `0 <= delay <= 2,592,000` (30 days; `DelayRange`). A separate instruction, so `configure`'s arguments are unchanged. Initial value 0. |
| Vault install works | `install_governance_vault` | The on-curve check no longer panics (section 0.2). |

New error codes, appended after the originals (`fault_codes_are_append_only` pins all 13): `ListingInvalid` 6007,
`ListingSigner` 6008, `ListingExpired` 6009, `BelowFloor` 6010, `ReleaseDelay` 6011, `DelayRange` 6012.

Account growth (new fields appended, **every earlier offset unchanged**):

| Account | Before | After | Appended fields |
|---|---|---|---|
| `ConfigV2` | 586 | **594** | `release_delay i64` @586 |
| `SaleV2` | 961 | **993** | `authenticated_at i64` @961, `release_delay i64` @969, `min_total u64` @977, `list_expires_at i64` @985 |

This is safe only before mainnet (no v2 account exists there). **Any v2 account created by the old program is unreadable by this
one** (and the program has no close instruction), so a devnet program id that already holds a v2 config needs a new program id
(runbook step 0). The TypeScript observers (`v2-observer.ts`, `v2-operation-observer.ts`) accept both sizes so the old test
fixtures keep working; `SaleSnapshot.listing` is populated only for 993-byte accounts.

## 2. Results

| Check | Before | After |
|---|---|---|
| Rust unit tests (`cargo test --locked --lib`) | 8 | **14** pass (8 unchanged + 6 new) |
| Local-validator on-chain groups (`run-local-v2.sh`) | 84 | **137** pass (84 original + 53 new), incl. the CPI-signed vault path |
| TypeScript (`npm test`) | 637 | **645** pass, 30 files (8 new, in `tests/solana-listing-v2.test.ts`) |
| `tsc --noEmit`, eslint on touched files | clean | clean |
| Payment DB suite 83 (082) on top of 083 | 18 stages | **18 stages** unchanged |
| New DB suite 88 (083) | n/a | **6 stages** pass |

`.so`: baseline `99aa6bec4e949de3484bc7fef0b70a83b040bdf92a1060871fe4de8d4c64743c` (540,264 bytes, matches the recorded 081 hash,
so the baseline is reproducible); **P1 `437c0c7bc932213e299effd697db9147552c91138e4b5a49b30730862764ecda` (553,896 bytes)**.
No SBF stack-frame diagnostics. Test-only mock vault `.so`: `69b07759e42aeb15b3b54b18e7957118dbe97dd5ced7d7bd63258b1ba1824e4c`.

### Compute units (local Agave 2.1 validator, whole transaction, from `meta.computeUnitsConsumed`)

| Instruction | Before (min-max, n) | After (min-max, n) | Matched sale ids |
|---|---|---|---|
| `open_sale` | 47,551 - 55,051 (3) | 52,750 - 64,750 (6) | **+5,199 in all 3 matched cases** (+~10%) |
| `buy_sale` | 50,551 - 53,184 (3) | 51,158 - 56,791 (5) | **+607** for the same winner (+~1.2%) |
| `authorize_release` | 15,353 (1) | 15,915 - 15,917 (3) | +562 (+~3.7%) |

The spread inside a column is PDA bump search (it depends on the keys), and in `buy_sale` which racing buyer wins. The matched
comparison uses the same deterministic sale ids on both builds. The Ed25519 precompile is not metered as compute units (it is
charged as a signature fee), so it is absent from `open_sale`'s number. Every number is far inside the 200,000 default.

## 3. Governance with a Squads 2-of-3 vault, and a separate upgrade authority

`govern()` accepts exactly one thing once a vault is installed: **both `first` and `second` equal `governance_vault`**, as
CPI-signed accounts. Exact accounts and data for every governed instruction (discriminator = first 8 bytes of
`sha256("global:<name>")`):

| Instruction | Accounts, in order | Args |
|---|---|---|
| `set_pause` | `config` (w, PDA `["config-v2"]`), `vault` (s), `vault` (s) | `funding bool, outflow bool`. Unpausing funding needs `max_trade > 0 && max_escrow > 0` |
| `set_release_delay` | same | `delay_seconds i64`; funding must be paused |
| `configure` | same | `roles` (8 pubkeys: issuer, inventory, receiver, authenticator, reviewer, release, reconciler, guardian), `max_trade u64`, `max_escrow u64`; funding paused; bumps epoch |
| `update_future_terms` | same | `treasury Pubkey, policy [u8;32]`; funding paused; bumps epoch |
| `rotate_governance` | same | `[Pubkey;3]` native members; funding paused |
| `authorize_refund` | `config`, `sale` (w), `vault` (s), `vault` (s) | `Attestation` (145 bytes) |
| `resolve_dispute` | same | `Attestation, refund bool` |
| `install_governance_vault` (ceremony, **native** 2-of-3) | `config` (w), `first` (s), `second` (s) | `vault Pubkey` (off-curve, not a role key), `policy [u8;32]` (non-zero); funding paused |

**The guardian pauses alone, and nothing native can resume.** `emergency_pause(outflow bool)`: accounts `config` (w),
`guardian` (s); only `config.roles.guardian` may sign; it only ever sets `funding_paused = true` (and optionally
`outflow_paused`). Proven on the validator (section 4): the guardian paused with no governor present, an issuer key was refused,
**after the vault was installed** the guardian still paused alone, and native governors could not unpause (`Authority`).

Squads v4 shape for a governed call: the vault is the PDA `["multisig", <multisig>, "vault", <index u8>]` of the Squads
program. The governed instruction goes into a vault transaction (`vaultTransactionCreate`), then `proposalCreate`, two
`proposalApprove`, `vaultTransactionExecute`; on execute Squads signs the CPI with the vault seeds. The settlement
instruction lists the vault account **twice** (`first` and `second`); in a Squads message that is the same account key with
repeated indexes, which the runtime allows.

**Upgrade authority** is a separate Squads multisig (same three holders, **different key set**), as agreed. Two ordering rules:
`initialize_v2` requires `program_data.upgrade_authority_address == bootstrap` (so initialize **before** handing the authority
to the multisig), and a PDA cannot sign, so the hand-over uses `--skip-new-upgrade-authority-signer-check`.

## 4. What the new on-chain scenarios prove (53 groups)

Every refusal asserts the program's own custom error code, so a refusal cannot pass for an unrelated reason (the harness's old
`rejectsOnChain` only checks "some instruction failed").

- **Listing (`open_sale`), 13 refusals + forged + nothing-created:** no signature instruction; signature not adjacent
  (`ListingInvalid`); signed by a non-owner (`ListingSigner`); signed for another sale id, card, generation, network (domain),
  program; trailing byte; truncated; a signature valid for sale A replayed on sale B (all `ListingInvalid`); already expired and
  zero floor (`ListingExpired`); a forged signature is rejected by the runtime's precompile at instruction 1 before the program
  runs; no account is created by any refusal. Then the happy path stores exactly the signed floor and expiry, and the same
  signed listing cannot open a second account.
- **Floor (`buy_sale`):** totals 979,999, 940,000 and 1 refused (`BelowFloor`, state stays `1`); **exactly the floor is
  accepted**; after the seller's expiry a buy is refused (`ListingExpired`) even though the issuer co-signed.
- **Release delay:** `set_release_delay` refused while funding is live, with one governor, below 0 and above 30 days; boundary
  values accepted. Authentication stamps time and snapshots the delay; release refused immediately (`ReleaseDelay`); **governance
  lowering the delay to 0 does not help that sale**; release succeeds after the delay and the outcome pays 931,000/49,000.
  Reviewed path: failed authentication starts no clock; hold, reviewer pass and governance clear start it at the review; release
  refused, then accepted after the delay.
- **Governance:** non-guardian pause refused; guardian pause alone; `install_governance_vault` refused while funding is live,
  for an on-curve key, for a zero policy and with one governor; installed; every native governed instruction then refused
  (`Authority`); the vault account cannot be impersonated (no signature -> refused); with the **mock vault** (a PDA that signs through
  `invoke_signed`, listing itself twice): vault+one native key refused, vault alone unpauses, guardian pauses alone again, native
  governors cannot unpause, vault sets the 86,400 s delay.

The mock is `solana/test-programs/mock-vault` (own workspace and lockfile, test-only, never deployed). It proves the *runtime
mechanism* `govern()` relies on. **It is not the Squads program.**

## 5. Off-chain listing builder (`lib/solana/listing-v2.ts`)

`encodeListing`, `decodeListingMessage`, `listingBinding`, `listingFloor` (quoted total less 2%, **rounded up**),
`listingForSale`, `verifyListingSignature` (WebCrypto Ed25519; SQL cannot verify Ed25519), `listingSignatureInstruction`, and
`openSaleWithListing(open, listing, signature)` which returns `[ed25519, open_sale]` in the only accepted order and refuses a
mismatched card/sale/generation/program or a signature that does not verify for the card owner. One vector is pinned in Rust
(`listing_message_wire_vector`), TypeScript (`tests/solana-listing-v2.test.ts`) and SQL (`88_seller_listing_floor.sql`):
inputs `[1;32] [2;32] [3;32] [4;32]`, generation 5, floor 1,000,000, expiry 1,900,000,000 -> binding
`4f9cc374...784f`, message SHA-256 `f7125fc0f364c4134469517178192ce16d44875818d6cd30e5768cdf28de9830`.
`openSaleInstructionFromContext` now also adds the instructions sysvar account (data length still 698).

## 6. Migration 083 (DRAFT: container-tested, not staged, not applied anywhere)

`supabase/migrations/083_payment_v2_seller_listing_floor.sql`, sha256
`46e28411f31c0f6437992d1911177ab445f0067c26f0c03ea18a4750c83897b9`. Requires 082 and funding off. **Additive only; it edits no
existing function body**, and its postguard compares every pre-existing payment function (body, owner, ACL, security mode,
settings) before and after.

- `payment_v2.sale_listings` (immutable): the signed message and signature per sale. `payment_v2.listing_policy` singleton
  `(required=false, tolerance_bps=200)`, audited; changes refused while any network has funding on.
- `fn_payment_v2_record_listing(sale, message, signature)` (issuer role): SQL recomputes the binding from the sale row; refuses a
  floor outside `[ceil(quote * 98%), quote]`, a listing that lapses before the quote does, and a conflicting second listing.
  **It cannot verify the signature**; the issuer service must (`verifyListingSignature`) and the program re-verifies on chain.
- `fn_payment_v2_listing_for_open(sale)` (issuer role): what the worker needs to build `[ed25519, open_sale]`.
- Trigger `seller_floor` on `payment_v2.attempts` (insert, and the authorize update): below the floor or after the listing
  lapsed is refused; with `required=true` an attempt on a sale without a listing is refused.
- Container `6ef7375a8c4e` (network none, no ports, unprivileged, loopback only; `run_083_container.sh`): `T083_RUN_PASS`. 083
  refused without 082 and while funding is enabled (nothing created); applied; re-run refused; suite 88 stages V (wire vector),
  D (default policy changes nothing), R (10 refusals + boundary + retry + conflict), A, P, I all pass; suite 83 still 18 stages.
  Scratch databases were copies of `flexsoar_082_pre` inside that container, as `run_082_container.sh` does; the shared
  `flexsoar_payment_v2_integration_test` was not touched.
- **Not wired (worker/app, outside this lane):** nothing calls the two RPCs yet; the issuer worker must call `record_listing`
  and must not submit `open_sale` without the listing instruction (the program enforces that regardless). `required` stays
  false until the upgraded program is the one in use.

## 7. Unverified

1. **The real Squads program.** Duplicate-vault-signer through `vault_transaction_execute` is argued from the Squads message
   format and proven only against a mock that uses the same `invoke_signed` mechanism. Do the harmless dry run in runbook step 7
   on devnet before any funds.
2. **Privy `signMessage`.** That an embedded wallet signs the raw 61 bytes (no prefix or wrapping) and returns a plain Ed25519
   signature is unverified; `verifyListingSignature` will catch a mismatch before submission, but the seller UX is untried.
3. **`tests/payment-integration/integrated.mjs` is stale and was not run** (needs the preserved integration containers). To adapt:
   build `[listing, open_sale]` with `openSaleWithListing`, make the issuer the fee payer for that transaction (its `send()` fixes
   `payerKey` to the bootstrap key), expect `SaleV2` length 993, and wire `record_listing` if 083 is applied there.
4. **Nothing was run on devnet or mainnet.** Local Agave 2.1 only; compute numbers are local.
5. **Nothing cross-checks the on-chain delay against the DB mode.** 082 requires a DB delay >= 86,400 for `solo`, and the program
   holds its own `release_delay`. Nothing compares them. Until an observer does, read `config` offset 586 by hand before
   enabling funding (runbook step 6).
6. **083 on staging/production** (container only); the app wrappers for the new RPCs (`track/data`); notifications and the daily
   same-person report (worker milestone, unchanged from 082).
7. **Edge cases left to review:** a seller may sign an arbitrarily far listing expiry (the DB only requires it to outlive the
   quote); the Rust parser's "every index must be self" rule is unit-tested but the on-chain path with a non-self index is not
   exercised on a validator (the precompile itself rejects most such inputs first); `initialize_v2` has no maintained script
   (`solana/scripts/initialize.mjs` is intentionally disabled).
8. **Toolchain:** the build and tests ran in WSL Ubuntu (Agave 2.1.0, Anchor 0.31.1, platform-tools 1.43). The `.so` hash above is
   what that toolchain produced from this tree; it was not rebuilt on a second machine.

## 8. Devnet deploy runbook (founder-run; `STOP` points are deliberate)

Nothing below has been run. Use a devnet-only deployer and role keys unless you are deliberately rehearsing the real ceremony.

0. **Is the program id free on devnet?** `solana program show CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF --url devnet` and
   `solana account <config PDA ["config-v2"]> --url devnet`. If a v2 config exists, **STOP**: the account layouts changed and
   there is no close instruction. Generate a new program keypair, set it in `declare_id!`, `Anchor.toml`, and rebuild (the hash
   below then changes). You must hold the program keypair for the id you deploy.
1. **Build and pin.** (WSL) `cargo-build-sbf --manifest-path solana/programs/flexsoar-settlement/Cargo.toml --sbf-out-dir <out> -- --locked`
   and confirm `sha256sum <out>/flexsoar_settlement.so` equals `437c0c7b...64ecda`. Run `cargo test --locked --lib` (14 pass) and
   `FLEXSOAR_MOCK_VAULT_SO=<mock_vault.so> bash solana/tests/run-local-v2.sh <out>/flexsoar_settlement.so` (137 pass).
2. **Keys.** Deployer `D` (funded with ~10 devnet SOL: rent for a 700,000-byte program account plus the same again for the buffer, which is refunded); eight distinct role keys;
   governance ceremony keys `founder_hw`, `friend_hw`, `ceremony_key` (throwaway, destroyed in step 5); a Squads **governance**
   multisig (2-of-3: founder, friend, recovery) and a **separate** Squads **upgrade** multisig (different member keys). Record the
   governance vault PDA `GV` and upgrade vault PDA `UV`. The USDC mint must have 6 decimals (devnet Circle USDC does).
3. **Deploy with a buffer.** `solana program write-buffer flexsoar_settlement.so --url devnet -k D.json`, then
   `solana program deploy --buffer <BUFFER> --program-id <program-keypair.json> --upgrade-authority D.json --max-len 700000 --url devnet`.
   `--max-len` matters: by default the program account is sized to the first binary, so a larger later upgrade would fail; this
   one grew 2.5% over the previous build.
   Verify: `solana program dump <ID> dumped.so --url devnet`, and the first 553,896 bytes of the dump equal the `.so` (the dump is zero-padded to the ProgramData length). `solana program show <ID>` must show Authority = `D`.
4. **Initialize (bootstrap = `D`, still the upgrade authority).** `initialize_v2(domain = devnet genesis hash (32 bytes), policy = 32-byte
   policy digest, treasury, roles, governance = [founder_hw, friend_hw, ceremony_key])`, accounts
   `[config (w), bootstrap D (s,w), program_data, mint, system_program]`. The program starts paused with caps 0 and delay 0.
   Write and review a one-off script for this; the repo's initializer is intentionally disabled (`local-v2.mjs` shows the exact
   encoding). **STOP and read back `config`:** length 594, `funding_paused = 1`, caps 0.
5. **Ceremony, back to back, funding paused, caps 0** (residual risk: two of three native keys are present until step 5c):
   a. `set_release_delay(86400)`, signed by two native governors. (Do this *before* the vault: native governance can still do it.)
   b. `install_governance_vault(GV, policy)`, signed by `founder_hw` + `friend_hw`. `policy` = SHA-256 of the written Squads
      configuration (members, threshold 2, timelock) reviewed for this vault.
   c. Destroy `ceremony_key`. **Verify:** `set_pause` signed by native governors is refused; config offset 488 equals `GV`;
      offset 586 reads 86,400.
6. **Hand over the upgrade authority** (only now): `solana program set-upgrade-authority <ID> --new-upgrade-authority <UV>
   --skip-new-upgrade-authority-signer-check -k D.json --url devnet`; `solana program show` must show Authority = `UV`. Destroy
   or archive `D`. Later upgrades: `write-buffer`, `set-buffer-authority <BUFFER> --new-buffer-authority <UV>`, then a Squads
   program-upgrade transaction on the upgrade multisig. Read config offset 586 and compare it to the DB `governance_mode`
   delay before enabling funding anywhere (unverified item 5).
7. **Prove Squads compatibility with no funds at risk.** Through the governance multisig, execute `set_release_delay(86400)`
   (a no-op value change, funding paused) with accounts `[config (w), GV (s), GV (s)]`. If it succeeds, the duplicate-signer shape
   works with the real Squads program. If it fails, **STOP**: the fallback is a program change (a single governance signer
   account), not a workaround.
8. **Rehearse the P1 behaviours** with devnet USDC and tiny caps (`configure` and `set_pause`, both through the vault): list
   with a seller-signed floor; confirm a sub-floor buy, a post-expiry buy and an unsigned `open_sale` are refused with codes
   6010, 6009, 6007; authenticate and confirm `authorize_release` is refused with 6011 until 24 h pass; confirm the guardian's
   `emergency_pause` works with no governor present, and that only the vault can resume.
9. **Abort path at any step:** funding stays paused (the program starts paused); the guardian can `emergency_pause`
   (`outflow = true` also freezes outcomes); nothing in this runbook enables funding with real money.

## 9. Files

Program: `solana/programs/flexsoar-settlement/src/{lib.rs,protocol.rs}`. Harness: `solana/tests/local-v2.mjs`. Test-only:
`solana/test-programs/mock-vault/`. App: `lib/solana/listing-v2.ts`, `v2-context.ts`, `v2-observer.ts`,
`v2-operation-observer.ts`, `tests/solana-listing-v2.test.ts`. DB draft: `supabase/migrations/083_payment_v2_seller_listing_floor.sql`,
`tests/payment-db/88_seller_listing_floor.sql`, `tests/payment-db/run_083_container.sh`.

Run locally (WSL Ubuntu; from Git Bash prefix with `MSYS_NO_PATHCONV=1` or Git Bash rewrites the `/mnt/c` paths):
`cargo test --locked --lib` as in the 081 handoff; build and run as in section 8 step 1; DB:
`bash tests/payment-db/run_083_container.sh 6ef7375a8c4e flexsoar_082_pre <out-dir>` (the container must be running).

Mock vault (test-only), built offline from its own pruned lockfile:
`cargo-build-sbf --manifest-path solana/test-programs/mock-vault/Cargo.toml --sbf-out-dir <out> --offline` (it resolves to
`solana-program =2.3.0`, the same version as the production crate).
