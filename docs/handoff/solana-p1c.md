# P1c: fixes for every R2 finding

Branch `track/payment-security`, 2026-10-22, on top of P1b (`52f7bac`). Responds to the independent review
`flexsoar-reviews\proposals-20261022\r2\p1b-security-review.md`. **Local only. Nothing was deployed, no network was touched, no real key
was used.** This document **supersedes** `solana-p1b.md` where they differ: the `accept_governance_vault` signature and checks, the
funding gate's API, the config layout (section 2) and runbook steps 6c-6d and 9. The next step is an independent R3 review, then devnet.

## 1. Disposition of each R2 finding

| Ref | Fix | Proof |
|---|---|---|
| R2-01 MEDIUM nested CPI | `accept_governance_vault` additionally requires `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1`. The top-level program id still must equal the controller. | On-chain negatives (both `NotDirectCall` 6015): **C -> D -> settlement** with D's own PDA, and **C -> D forwarding C's vault signer** to settlement. In both the top-level program IS the named controller and the vault genuinely signs. The direct-CPI positive is kept and passes. |
| R2-05 LOW no cancel, no proposal identity | `cancel_governance_vault_proposal` (current governance; clears all three pending fields). `proposal_revision` (u64, config offset 691, out of `reserved`; size still 819) increments on every propose, never on cancel or accept, and never decreases. `accept_governance_vault(expected_revision)` refuses a different revision. | A **policy-only** re-proposal makes the old accept fail (`StaleProposal` 6016); cancel then accept fails; cancel with nothing pending fails (`NoPendingVault` 6013); one governor cannot cancel; natives cannot cancel once a vault governs; revisions asserted strictly increasing across propose, cancel, re-propose. |
| R2-04 LOW stale role exclusion | One predicate, `vault_conflicts(roles, governance, vault)`, used by `propose` (already did), **`accept` (new)**, **`configure` (refuses any role set that includes the pending vault)** and **`rotate_governance` (refuses a native member equal to the pending vault)**. New error `VaultConflict` 6017. | Both orders on chain: pending first, then `configure`/`rotate_governance` assigns it (refused); role or native member first, then `propose` (refused). Unit test over all 11 role and native keys. **Accept's own re-check is not reachable on chain** (configure and rotate now refuse first); it is defence in depth, covered by the unit test of the shared predicate. |
| R2-02 MEDIUM gate input | `parseGovernanceModeRows` validates the DB projection at runtime: exactly one row, exactly the three fields, `operational_separation` in the enum, `governors_required` the number 2 or 3, `release_delay_seconds` a non-negative safe integer number (seconds), and the table's own solo rule. No coercion, no defaults. | 33 malformed-shape tests, including the review's partial row `{release_delay_seconds: 0}`, `""`/`false` (which `BigInt()` would coerce to 0), negatives, fractions, `NaN`, `Infinity`, bigints, strings, extra and misspelled fields. A malformed row stops the gate **before any RPC call**. |
| R2-03 MEDIUM gate cluster binding | `checkFundingGate(rpc, {genesisHash, programId}, rawRows)`: calls `getGenesisHash` and requires the pinned value; derives the config PDA itself (no caller-supplied address); requires the program executable and loader-owned and the config `executable === false`; strict 0/1 boolean decoding; discriminator; pending fields and reserved bytes zero; returns `{ok, failures, target:{genesis, program, config, slot}, config, mode}`; any RPC error or malformed reply returns `ok:false`, never throws. | A cloned cluster carrying a compliant config is refused after one RPC call; the config address asked for is asserted to be the derived one; an RPC error at each call is a refusal; bad booleans (2, 255), executable config, foreign owner, wrong size, wrong or mutated discriminator, nonzero pending controller/policy/reserved are each refused; the decision carries the observed slot. |
| R2-06 LOW init read-back | `decodeConfig`/`verifyConfig` validate the `ConfigV2` discriminator, and the read-back requires `executable === false`; `proposal_revision` must be 0 after init. | Fixture now uses the real `SHA-256("account:ConfigV2")[0..8]`; a **header-mutation test flips each of the 8 bytes** and a zeroed header (what the old fixture accepted) is refused; an executable read-back is refused. |

Also fixed from the review's notes: the init script's header comment claimed every manifest key is checked as distinct and non-default;
only the eight roles and three native governors are (treasury, mint, program and bootstrap are valid-key checks only). Use
`--commitment finalized` for ceremony evidence (the default); a weaker commitment weakens the read-back.

## 2. Layout (unchanged size)

`ConfigV2` is still **819 bytes**: `layout_version` @690, **`proposal_revision u64` @691**, `reserved [u8;120]` @699 (was 128 bytes at 691).
`SaleV2` unchanged (1090). A unit test pins both sizes. Per the LAYOUT RULE the new field came out of `reserved`; P1b was never deployed,
so the 8 bytes moving from "reserved" to a named field cannot affect any existing account. The observers decode the same sizes as before.

## 3. Direct CPI, and what to expect from Squads

`accept_governance_vault` now means: *the named controller program, as the top-level instruction, itself called settlement, signing
for the vault.* Anything else is refused: a different top-level program (`WrongController` 6014), a deeper call (`NotDirectCall` 6015),
a stale proposal (`StaleProposal` 6016), a vault that now collides with a role or native member (`VaultConflict` 6017).

**Squads `vault_transaction_execute` is expected to be a direct CPI** into the settlement program (the Squads program is the top-level
instruction and invokes the target once with the vault PDA as signer). That is my expectation from how Squads executes, **not something I
have seen run**; it is verified on devnet at runbook step 6d. If real execution turns out to be deeper (for example through a wrapper
or a batch), accept fails closed with 6015 and nothing is lost: native governance stays in force and the proposal can be cancelled.

## 4. Results

Verified on the **committed tree `4caf1b5`** (program, script, gate and tests; this document is the only later change), nothing else running:

| Check | P1b (`52f7bac`) | **P1c** |
|---|---|---|
| Rust unit tests (`cargo test --locked --lib`) | 16 | **18** pass (new: the shared vault-conflict predicate over all 11 role and native keys; revision arithmetic and size pin) |
| Local-validator on-chain groups | 165 | **185** pass, `RUN_EXIT=0`, process exits by itself |
| &nbsp;&nbsp;of which | 84 original + 12 init-script + 69 P1 | 84 original + 12 init-script + **89 P1/P1b/P1c scenarios** |
| `npm test` | 677 | **722** pass, 32 files (+45: gate 50 tests, up from 7; init script 27, up from 25) |
| `tsc --noEmit`, eslint on touched files | clean | clean |

- **`.so`:** sha256 `ec55c456643d4bb44486e6a292aeff4f826dffd00c2d9d15ca2b2c793fab8fba`, 573,048 bytes (P1b `0e4c710c...4902dd`, 551,656 bytes),
  rebuilt from the committed tree and equal to the build used in earlier runs. No SBF stack-frame diagnostics. I also rebuilt the P1b
  sources from git to measure against: they reproduce `0e4c710c...` exactly, so the comparison below is between the two real binaries.
- **Peak memory of the suite:** 1,637,948 kB resident (the validator), 4 min 18 s wall. Earlier runs of this suite: 1.62-1.66 GB.
- **DB / migration 083:** untouched by P1c and not re-run.

### Error codes (appended only)

`NotDirectCall` 6015, `StaleProposal` 6016, `VaultConflict` 6017, after `NoPendingVault` 6013 and `WrongController` 6014. A unit test pins
all 18 codes. Every on-chain refusal added here asserts its specific code; where only the runtime can refuse it asserts the runtime's
error by name (`PrivilegeEscalation`) or the Anchor code (`AccountNotSigner` 3010).

### Compute units: P1b binary vs P1c binary (same harness flows, whole transaction, local validator)

| Instruction | P1b | **P1c** | Delta |
|---|---|---|---|
| `authorize_release` | 17,125 - 17,127 (3) | 17,122 - 17,124 (3) | **-3** (nothing in this path changed) |
| `set_release_delay` (governed) | 10,804 (7, all equal) | 10,849 (8, all equal) | **+45** |
| `set_pause` (governed, native keys) | 10,812 - 10,820 (17) | 10,857 - 10,865 (18) | **+45** on every matched sample |
| `propose_governance_vault` | 11,228 (3, all equal) | 11,314 (7, all equal) | **+86** (revision increment, role/native exclusion) |
| `accept_governance_vault`, whole tx via the mock CPI | 17,619 (1) | 17,955 (1) | **+336** (stack-height syscall, revision check, exclusion re-check; includes the mock's own cost) |
| `cancel_governance_vault_proposal` (new) | n/a | 10,870 (2, all equal) | new |

These governed instructions have no PDA bump search that varies with random keys, so their numbers are stable and the deltas are real.
The uniform +45 on instructions whose logic did not change is most likely the larger `ConfigV2` struct to read and write (8-byte
revision plus a shorter reserved array); I did not verify that. `open_sale` (49,459 - 61,459) and `buy_sale` (49,661 - 56,794) were not
the subject of this change and carry the same key-dependent noise as before; no claim is made about them. All figures are far under
the 200,000 default. The CU for `accept` was measured on the mock's whole transaction, so the real Squads cost will differ.

### Governance and layout scenarios added in this task (each asserting its code)

- **R2-01:** `C -> D -> settlement` with D's own PDA, and `C -> D` forwarding C's vault signer: both `NotDirectCall` 6015, with the
  top-level program equal to the named controller and the vault genuinely signing; the pending slot and active vault unchanged after each.
  The direct-CPI accept still activates.
- **R2-05:** re-proposal with only the policy digest changed: the accept prepared for the old revision fails `StaleProposal` 6016; one
  governor cannot cancel (`Authority` 6001); cancel clears all pending fields and leaves the revision unchanged; accept after cancel is
  refused (`Authority` 6001: nothing pending, so no signer can match); a second cancel is `NoPendingVault` 6013; after a new proposal
  both older revisions are stale; revisions are asserted strictly increasing; natives can neither propose nor cancel once a vault governs.
- **R2-04, both orders:** pending vault first, then `configure` giving it to a role and `rotate_governance` giving it to a native seat
  (both `VaultConflict` 6017); a role (and separately a native seat) holding the key first, then `propose` (6017); the original roles
  and native members are restored and read back after each.

## 5. Existing tests changed because the new contract forces it

No original test assertion changed. Everything not listed is untouched; no SQL, migration or DB test changed, and no other existing
TypeScript test file was edited.

| File | Change | Why |
|---|---|---|
| `lib.rs` test `fault_codes_are_append_only` | three codes added to the table | `NotDirectCall`, `StaleProposal`, `VaultConflict` (extends; no code moved) |
| `lib.rs` test `release_delay_is_bounded_and_snapshotted_per_sale` | the `ConfigV2` literal gains `proposal_revision` and a 120-byte `reserved` | struct literal must name every field (forced) |
| `local-v2.mjs`, P1 governance section | extended with the R2 scenarios; `accept` helpers take the expected revision; `FAULT` table gains 6015-6017 | `accept_governance_vault` now has an argument (forced); these are P1-added scenarios, not original ones |
| `local-v2.mjs`, CU logging | also logs `propose`, `cancel`, `set_release_delay`, `set_pause`, and tags the direct-CPI accept | to measure the governance instructions you asked for |
| `tests/solana-funding-gate.test.ts` | rewritten for the new API | the old signature took a caller-supplied config address, which R2-03 removes (forced); this is my P1b test file, not an original test |
| `tests/solana-init-v2.test.ts` | fixture uses the real discriminator; reserved-offset cases move 691 -> 699 and add `proposal_revision`; the fake connection reports `executable` | R2-06 and the layout change (forced) |

## 6. Runbook amendments (apply to `solana-p1b.md` section 11)

- **Step 6c:** `propose_governance_vault` now increments `proposal_revision`. Read it back (config offset 691) together with the pending
  slot. It is the number the accept must quote.
- **Step 6d:** the Squads transaction calls `accept_governance_vault(expected_revision)` with that revision, accounts `config` (w),
  the vault (signer), instructions sysvar. If a second proposal was made in between, the queued accept fails with 6016 and a new one
  must be built for the new revision. To abandon a proposal at any point: `cancel_governance_vault_proposal` (current governance,
  accounts as `set_pause`), then read back that the pending slot is empty.
- **Step 6c, extra check:** before approving the proposal confirm the proposed vault is not any current role key or native member
  (`propose` and `accept` enforce it; do not rely on that alone).
- **Step 9:** call `checkFundingGate(rpc, {genesisHash, programId}, rows)` with the pinned values from the manifest and the raw
  `governance_mode` projection; require `ok === true` and record the returned `target` (genesis, program, config, slot) in the
  approval record. Any exception counts as a refusal.

## 7. Unverified

1. **Squads is expected to call accept as a direct CPI; not seen.** If real `vault_transaction_execute` is deeper (a wrapper, a batch, or a
   multisig that is itself a member of another), accept fails closed with 6015 and native governance stays in force. Devnet step 6d is
   the test. Nothing here was run against the real Squads program, only against mocks that sign a PDA through `invoke_signed`.
2. **Two guards are unreachable on chain by honest sequences and are covered by unit tests only:** accept's own `VaultConflict`
   re-check (configure and rotate_governance now refuse first) and accept's `NoPendingVault` (the signer-address constraint refuses
   first with 6001). They are defence in depth.
3. **The funding gate is a function and a test, not a wired step.** No DB adapter or caller exists, so the real `governance_mode`
   projection has never been fed to it; the units contract (seconds) is enforced by type and range, but it cannot detect an adapter that
   labels hours as seconds. It checks that the program is an executable upgradeable program, not its binary hash. A malicious RPC that
   fabricates every reply is outside its model. The decision is a snapshot at `target.slot`; nothing makes the funding-enable action
   consume it atomically.
4. **Still open from R2, not changed here (not in this task's scope):** R1-01 is a fresh-deploy mitigation, not a migration (the typed
   accounts still cannot read an older layout); R1-04 remains a specification, no seller UI or issuer worker exists; the observers do not
   check the layout-version bytes (sale 993, config 690); the claim that no intermediate-size account (993/594) was ever deployed is
   still unverified; the Squads ceremony checklist's field names and program id are still from memory.
5. **Carried over unchanged:** `init-v2.mjs` has run only against a fake RPC and a local validator; `integrated.mjs` is edited but
   unrun; the Privy `signMessage` proof is a plan; the execute-time delay recheck has no on-chain negative test; padding sizes are
   judgments; `execute_outcome` CU is unmeasured; migration 083 is container-tested only and no worker calls its RPCs.
6. **CU:** the cause of the uniform +45 is a hypothesis; the `accept` figure includes the mock program's cost.
7. **Process note:** to get matched numbers I built the P1b sources from git and ran a temporary copy of the P1b harness with CU logging
   added. That copy was deleted and is not committed; the P1b binary reproduced its recorded hash.
