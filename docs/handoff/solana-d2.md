# D2 — devnet program finalisation, local only

2026-10-23, `track/payment-security`. Supersedes the R3-01 documented acceptance in `solana-p1c.md` section 8.
No external network, deployment, faucet request or external transaction. Local validators ran in rootless network namespaces
containing only loopback. Heavy jobs ran sequentially. No key material was printed or committed.

## Status

**STOP before deployment. Independent R4 is next. No deployment or devnet action is approved by this document.**
Byte proof: **the ACCEPTED encoded-ID normalization proof PASSES** (founder decision, D2-finish). The earlier strict "contiguous
32-byte occurrences only" result is recorded below as **superseded, with reason**. Source diff A to B is exactly the two requested ID lines.

## Commits and source identity

- `48bd02a`: exact requested limiter in AGENT_RULES.md section 2b, committed separately.
- `32a15c3`: R3-01 guard, on-chain regression/fixture tests, byte-proof CLI, and devnet Anchor entry at the original ID (build A).
- `f373b4d`: build B; ONLY `declare_id!` and `[programs.devnet].flexsoar_settlement` change.
- Later test/evidence commit: see Git history. No program source changed after `f373b4d`.

`git diff 32a15c3 f373b4d` shows exactly two files, two replaced lines. Cargo manifests, lockfile, toolchain, build path and flags
were identical. The harness reads `declare_id!` locally so it exercises each binary at its own ID without changing harness code.
The `[programs.localnet]` and workspace metadata addresses remain historical values to preserve the requested two-line B delta;
the explicit local-validator harness does not use those Anchor settings. Do not use them as a deployment manifest.

The supplied `program.json` was checked locally with `solana-keygen pubkey`; it returned
`HRqab2EMDcJKfkc4J88sxc4GVZyq5m3gNU43WMsa5Ve1`. The keypair itself was neither printed nor copied.

## R3-01 and path coverage

The only missing program guard was in `rotate_governance`: it now checks nonzero `governance_vault` against the proposed members,
using the existing `vault_conflicts` predicate, before the existing pending-vault check or any assignment. Error is the existing
`VaultConflict` **6017**. No error is added, reordered or renumbered; no account layout or instruction signature changes.

| State-writing path | Invariant and evidence |
|---|---|
| `initialize_v2` | Fresh init assigns validated members and explicitly zeros both vault slots. Existing init/read-back assertions cover that state. An active vault is not an input to init. |
| `rotate_governance` | New active-vault check plus existing pending-vault check. Each of three seats refused with **6017**, with no proposal and with a different pending vault. All three pending-vault seat conflicts also assert **6017**. Whole config unchanged after each refusal. |
| `propose_governance_vault` | Existing shared exclusion retained. Each native seat is assigned the candidate first; proposal via active-vault CPI then fails **6017** and leaves the config unchanged. |
| `accept_governance_vault` | Existing activation-time exclusion retained. Three deliberately invalid genesis configs put the proposed vault in each native seat. Correct controller, signer, direct CPI and revision still fail **6017**. Repairing the members through `rotate_governance` makes the same acceptance succeed. |
| `cancel_governance_vault_proposal` | Only clears the pending slot; cannot introduce an active/member conflict. Existing cancellation assertions unchanged. |
| `configure` (roles only) | Existing active-vault/operational-role exclusion preserved, including error **6001**, with a new exact-code regression. Pending-vault exclusion stays **6017**. |

The genesis fixtures also put the current active vault in another dormant seat. Re-submitting that member set through rotation
fails **6017**: the active vault cannot **remain** in the dormant list. A clean member set repairs the invalid fixture through the
real instruction. Fixtures are test-only state injection at validator genesis, not a claim that normal instructions can create it.
Each fixture validator starts only after the preceding validator exits.

All existing assertions remain unchanged. After the first B run exposed web3.js rejecting confirmation with a raw chain error
(`{InstructionError:[1,{Custom:6002}]}` thrown instead of returned), the harness was hardened. No assertion was weakened or replaced.

**Audit of the confirmation change (D2-finish).** The logic now lives in `settle(signature, confirm)` in `local-v2.mjs`:
- It resolves ONLY after the try/catch, and only if `confirmation.value.err` is falsy. The `catch` block has two exits, both
  `throw`: (a) `LocalInstructionFailure` when the chain's recorded status for that signature holds an `InstructionError`; (b) the ORIGINAL
  error rethrown. It has no path that returns normally, so a thrown confirmation can never become success.
- Failed tx: the status holds the real error, so it reaches `rejectsWith`/`isInstructionFailure` with the true custom code. Never-landed tx:
  status is `null`, original error rethrown (fails any assertion expecting an instruction refusal). Timeout, transport and
  non-instruction status errors: original error rethrown, not an `InstructionFailure`, so they cannot satisfy a refusal assertion. If the
  status lookup itself throws, that also rejects.
- Residual: a confirmation that throws for a tx that actually SUCCEEDED is reported as a failure (rethrown), never as success (safe direction).
- **Self-test added** (6 groups, run inside the live-validator suite, counted in the totals): (1) a real known-failing `set_pause`
  (one governor) with a throwing confirmation still rejects with 6001 via the new path; (2) same with a resolving error; (3) a
  successful tx with a throwing confirmation rethrows the original error; (4) a never-landed tx (unknown blockhash, verified absent)
  with a throwing confirmation rethrows; (5) a non-instruction error is not reclassified; (6) the only resolving case is `err:null`.

## Artifacts and exhaustive byte comparison

| Artifact | Program ID | Bytes | SHA-256 |
|---|---|---:|---|
| P1c baseline | `CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF` | 573048 | `ec55c456643d4bb44486e6a292aeff4f826dffd00c2d9d15ca2b2c793fab8fba` |
| A (R3-01 fix) | `CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF` | **573824** | `bb24de401f2b940ed5aa5528186d5ab1c5dafe060e413b1d1ca4a9a41d0b57af` |
| B (fresh ID) | `HRqab2EMDcJKfkc4J88sxc4GVZyq5m3gNU43WMsa5Ve1` | **573824** | `61da352f0a316f8a20f0e0690bc659854b00af260761ade1f6538d1da411defc` |

Local binaries: `solana/target/d2/A/flexsoar_settlement.so` and `solana/target/d2/B/flexsoar_settlement.so` (ignored, not committed).
Never substitute a build-generated `*-keypair.json` for the founder's external `program.json`.

### Accepted proof (founder decision) and superseded strict result

- **ACCEPTED:** replacing every old-ID encoding in A (the raw 32-byte occurrence at 512715..512746 plus the 88 LDDW immediates)
  with the new-ID bytes reproduces B **byte for byte**; all 713 differing offsets are mapped; **0 unexplained**. Tool `pass:true`, exit 0.
- **Controls (all pass):** raw-ID-only synthetic change passes (accepted and strict); actual A/B passes accepted, fails strict;
  unrelated opcode flip in a synthetic copy fails both. `node solana/tests/program-id-diff.mjs ...` prints "3 byte-proof controls PASS".
- **SUPERSEDED (kept for the record):** the strict condition (only complete contiguous 32-byte occurrences differ) FAILS for the real
  builds (`strictPass:false`): only 31 of 713 differing bytes lie in the raw occurrence. Reason it was replaced: LLVM folds Pubkey
  comparisons into BPF LDDW immediates (ID fragments), so any ID change necessarily alters bytes outside a contiguous occurrence.
  The strict result is still computed and emitted as `strictPass`; it no longer drives the exit code.

The committed [exhaustive proof output](solana-d2-byte-proof.json) lists **every one of the 713 differing zero-based offsets**, its
A/B byte value, and its raw-occurrence or decoded-instruction mapping. Results:

- Equal sizes. One complete raw ID occurrence in each file at **512715..512746** inclusive; **31** bytes differ there (one ID byte agrees).
- **682** differing bytes outside that interval, all in the immediate fields of **88 BPF LDDW instructions**, each matching the same
  eight-byte slice of the old/new IDs. Instruction opcode/register/offset fields and the LDDW continuation headers are unchanged.
- `.text` starts at file offset 288 and is 511040 bytes. The tool reads this from the ELF64 section table, verifies BPF machine 247,
  and decodes each LDDW's low four bytes at instruction+4..7 and high four bytes at instruction+12..15.
- (Strict, superseded) Replacing only the raw 32-byte occurrence in an **in-memory copy** of A does **not** equal B: strict proof `pass:false`, CLI exit 1.
- Replacing the raw occurrence **and** all mapped ID immediates in memory equals B byte for byte. There are **zero unexplained
  differences**. No actual binary was patched. This is the accepted encoded-ID-only proof.
- Three verifier controls pass: a synthetic raw-ID-only change passes; actual A/B fail strict but pass the accepted proof;
  flipping an unrelated opcode in a synthetic copy fails both. Neither reviewed artifact is modified by these controls.

Reproduce (offline, installed dependencies only):

```text
node solana/scripts/verify-program-id-diff.mjs solana/target/d2/A/flexsoar_settlement.so solana/target/d2/B/flexsoar_settlement.so CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF HRqab2EMDcJKfkc4J88sxc4GVZyq5m3gNU43WMsa5Ve1
node solana/tests/program-id-diff.mjs solana/target/d2/A/flexsoar_settlement.so solana/target/d2/B/flexsoar_settlement.so CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF HRqab2EMDcJKfkc4J88sxc4GVZyq5m3gNU43WMsa5Ve1
```

Build environment: existing WSL Ubuntu, Agave 2.1.0, platform-tools v1.43 / SBF rustc 1.79.0, Anchor Rust crates 0.31.1,
same Linux-native source directory `/home/family/.cache/p1-new-src` for A and B. Repository Cargo.toml/Cargo.lock and Rust sources
copied there before each build, then `cargo-build-sbf --offline --jobs 1 --manifest-path <source>/programs/flexsoar-settlement/Cargo.toml
--sbf-out-dir <A-or-B> -- --locked`, under `unshare --user --map-root-user --net` and `CARGO_NET_OFFLINE=true`.
No SBF stack-frame diagnostic; existing deprecation warnings for `bpf_loader_upgradeable` and Anchor-generated `AccountInfo::realloc`.

## Verification results

All runs local, loopback-only namespace, one heavy job at a time, WSL Ubuntu. Same current harness for A and B (A was run with the
working-tree `declare_id!` temporarily set to A's ID and restored with `git checkout` of that file; lib.rs is unchanged in the tree).

| Check | Result |
|---|---|
| On-chain suite, **A** (`bb24de40...`) | **204** groups passed (198 + 6 harness self-test) + **12** genesis-fixture groups; exit 0; peak RSS **1,638,452 kB** (4:21) |
| On-chain suite, **B** (`61da352f...`) | **204** groups passed (198 + 6 self-test) + **12** genesis-fixture groups; exit 0; peak RSS **1,641,152 kB** (4:38) |
| Earlier B run (before the self-test, same assertions) | 198 + 12; peak RSS 1,640,496 kB |
| P1c baseline suite (baseline harness, baseline `.so`) | 185 groups |
| `cargo test --locked --offline --lib` | **18 passed**, 0 failed; peak RSS 320,272 kB |
| `npm test` (vitest) | **763 passed / 34 files** |
| `npx tsc --noEmit` | exit 0, no output |
| eslint on 3 touched .mjs files | 0 errors, 3 warnings (unused vars at `local-v2.mjs` lines 48/158/298, not in code changed here) |
| byte proof + 3 controls | pass (see above) |

### Compute units (whole-transaction, from the suite logs; baseline = P1c)

| Instruction | baseline | A | B |
|---|---:|---:|---:|
| `rotate_governance` (direct, with R3-01 guard) | 11,616 | **11,637** (+21 = guard) | 8,637 |
| `rotate_governance` (whole tx via mock CPI) | n/a | 15,783 | 12,783 |
| `configure` | 11,998 | 11,998 | 8,998 |
| `set_pause` | 10,857-10,865 | same | 7,857-7,865 |
| `set_release_delay` | 10,849 | 10,849 | 7,849 |
| `propose_governance_vault` | 11,314 | 11,314 | 8,314 |
| `cancel_governance_vault_proposal` | 10,870 | 10,870 | 7,870 |
| `accept_governance_vault` (via mock CPI) | 16,455 | 16,455 | 13,455 |
| `authorize_release` | 17,122-17,124 | same | 14,122-14,124 |
| `open_sale` / `buy_sale` | 49,459-61,459 / 49,661-55,294 | 50,959-62,959 / 49,661-62,794 | 52,459-61,459 / 45,161-54,161 |

- R3-01 guard cost: **+21 CU** on `rotate_governance` (A vs baseline); the other config-PDA instructions in A equal the baseline.
- **B is exactly 3,000 CU lower than A on every config-PDA instruction.** The ID change alters PDA bump derivation (each
  `find_program_address` bump iteration costs about 1,500 CU; this explanation is inferred from the exact deltas, not separately measured),
  so unchanged instructions have different CU at the new ID. `open_sale`/`buy_sale` ranges move run to run with derived sale/card
  PDAs, so those rows are not comparable across runs.

## Unverified / deliberately not performed

- The strict contiguous-32-byte condition fails and is superseded by the founder's encoded-ID normalization decision; R4 should
  confirm the accepted proof's soundness (it maps only old-ID raw and LDDW-immediate encodings, nothing else).
- `npm run build` (AGENT_RULES section 11) was not run in this task; no app code changed.
- The self-test was not mutation-tested against a deliberately broken `settle`.
- Fresh-ID devnet inventory, deploy/dump/hash equality and devnet runtime compatibility remain unverified. This task made no RPC call
  outside isolated loopback. The rehearsal reported devnet 4.4.0-beta.1; these local tests use Agave 2.1.0.
- Real Squads CPI depth, threshold/member permissions/config authority and ceremony remain unverified; mocks only.
- Privy signatures, seller UI/issuer worker integration, funding-gate DB adapter/enforcement, `integrated.mjs` and DB suites were not
  run here. No SQL, production database, mainnet configuration or app funding gate was changed.
- R3-02 remains the documented provisional-layout/version-1-baseline disposition from P1c/D1; D2 changes no layout.
- R4 has not occurred. No deployment approval is implied by passing tests or by the diagnostic byte comparison.

## Changed files and exports

- `AGENT_RULES.md`: task-scoped limiter, exact requested wording.
- `solana/programs/flexsoar-settlement/src/lib.rs`: active-vault member guard, predicate comment, fresh declared ID.
- `solana/Anchor.toml`: devnet program entry; B changes that entry's ID only.
- `solana/tests/local-v2.mjs`: source-derived ID, exact-code regressions, CU logging, sequential fixture invocation, `settle()` confirmation handling and its 6-group self-test.
- `solana/tests/vault-conflict-genesis.mjs`: accept-time and already-overlapping-state regressions with positive repair controls.
- `solana/scripts/verify-program-id-diff.mjs`: accepted encoded-ID normalization proof (drives the exit code); strict result reported as superseded `strictPass`.
- `solana/tests/program-id-diff.mjs`: positive and negative controls for the proof tool.
- `docs/handoff/solana-d2-byte-proof.json`: every differing offset and mapping.
- `docs/handoff/solana-d2.md`: this report, evidence, limitations and R4 stop.
- `docs/handoff/payment-security.md`: D2 handoff entry.

Exports added: **none**. New instruction signatures: **none**. New error codes: **none**. Outside-lane edits: **none**.
