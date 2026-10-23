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
