# Solo-operator mode: design (S1, DESIGN ONLY)

Branch `track/payment-security` at `2ee96cb`, 2026-10-22. **No migration, program change or test is written here.** This is for
founder review before migration 082 (DB) and the program upgrade are authored. 081 is the separate cleanup.

## Founder decision (2026-10-22)

1. **One person may hold every operational role:** receiver, authenticator, reviewer, release. Inventory, reconciler and
   guardian already need only one key each.
2. **Governance requires exactly 2 distinct people:** the founder plus one trusted friend.
3. **Turning funding off or pausing stays a single-person action.**

**Ground rule:** a person is a person and a key is a key.
- `person_id` must never be faked. One human gets one `person_id`.
- One human may hold several *keys* (one per role). The program already separates by key, and that does not pretend to be
  separation by person.

---

## 1. Every check that changes, with today's code quoted

There are two classes of check:
- **(P)** separation by *person*, in the database;
- **(K)** separation by *key*, in the program and the database.

Solo mode relaxes only (P) for the operational roles, and adds compensating controls (§3). (K) stays, because one human can
legitimately hold distinct keys.

### 1.1 `payment_v2.funding_configuration` (P): `060_payment_v2_contracts.sql:19-27`

Today:
```sql
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['inventory','receiver','authenticator','reviewer','release','guardian','reconciler']) required(role)
 WHERE (SELECT count(1) FROM payment_v2.staff st WHERE st.role=required.role AND st.active)<>1)
 AND (SELECT count(1)=3 AND count(DISTINCT person_id)=3 FROM payment_v2.staff WHERE role='governor' AND active)
 AND (SELECT count(DISTINCT public_key)=10 FROM payment_v2.staff WHERE active)
 AND NOT EXISTS(SELECT 1 FROM payment_v2.staff WHERE active AND public_key=n.issuer)
 AND (SELECT count(DISTINCT person_id)=4 FROM payment_v2.staff WHERE active AND role IN('receiver','authenticator','reviewer','release')))
```

**Callers.** All three refuse when it is false:
- `fn_payment_v2_prepare_sale` (`060:109`; the live body is 060 plus 078's fragments);
- `fn_payment_v2_initiate` (live body `066:42`, which replaced `060:142`);
- `fn_payment_v2_authorize_attempt` (`060:164`).

**Proposed rule** (G = `governance_mode.governors_required`, §2):

| Clause | Today | Proposed |
|---|---|---|
| One active key per operational role (7 roles) | `<>1` refuses | **unchanged** |
| Governors | exactly 3 rows, 3 distinct persons | exactly **G** rows **and** G distinct persons (G ∈ {2,3}) |
| Distinct active keys | `=10` | `= 7 + G` (every role and governor key distinct; this is key separation and stays) |
| Issuer key is not a staff key | yes | **unchanged** |
| Receiver/authenticator/reviewer/release persons | `=4` | `separated` mode: **=4** (unchanged). `solo` mode: **≥1** (no person rule) |
| New: solo compensating control | — | `solo` ⇒ `release_delay_seconds >= 86400`, and the operational person is **not** both of the governors (§3) |

### 1.2 Release acceptance in settlement (P): `061_payment_v2_settlement.sql:67-70` (`fn_payment_v2_reconcile_event`)

Today:
```sql
   IF x.received_at IS NULL OR x.authentication<>'pass'
   OR NOT EXISTS(SELECT 1 FROM payment_v2.decisions ad JOIN payment_v2.attestations at ON at.decision_id=ad.id WHERE ad.escrow_id=x.id AND ad.action IN('authentication_pass','review_authentication_pass') AND ad.person_id<>d.person_id)
   OR EXISTS(SELECT 1 FROM payment_v2.decisions rd JOIN payment_v2.attestations rt ON rt.decision_id=rd.id WHERE rd.escrow_id=x.id AND rd.action='receipt' AND rd.person_id=d.person_id) THEN RAISE EXCEPTION 'PAYMENT_V2_ACCEPTANCE_REQUIRED';END IF;
```

**Proposed:**
- In `separated` mode, unchanged.
- In `solo` mode, compare `actor_staff` (the key) instead of `person_id`: the release key must differ from the authentication and
  receipt keys.
- **And**, in both modes, require that the release attestation's `executedAtSeconds` is at least the authentication pass
  attestation's `executedAtSeconds + release_delay_seconds`. This is defence in depth; record_decision (§1.3) and the program
  (§3.3) check it too.

### 1.3 Independent-person rule on decisions (P): live body `067_payment_v2_decision_column_alias.sql:32-34` (`fn_payment_v2_record_decision`)

Today:
```sql
 IF action IN('authentication_pass','authentication_fail','review_authentication_pass','review_authentication_fail','release') AND EXISTS(
  SELECT 1 FROM payment_v2.decisions prev JOIN payment_v2.attestations t ON t.decision_id=prev.id
  WHERE prev.escrow_id=x.id AND prev.person_id=st.person_id AND prev.action IN('receipt','authentication_pass','authentication_fail','review_authentication_pass','review_authentication_fail')) THEN RAISE EXCEPTION 'PAYMENT_V2_INDEPENDENT_PERSON_REQUIRED';END IF;
```

**Proposed:**
- `separated` mode: unchanged.
- `solo` mode: the same predicate on `prev.actor_staff=st.id` (key), raising `PAYMENT_V2_INDEPENDENT_KEY_REQUIRED`.
- **Plus**, for `action='release'`, refuse with `PAYMENT_V2_RELEASE_DELAY` unless the authentication pass attestation is at
  least `release_delay_seconds` old. This uses the same pattern as the existing 48 h rejection challenge (`067:38`).

### 1.4 Inventory enrolment needs two persons (P): `063_payment_v2_permissions_fences.sql:46` (`payment_v2.correspondence`, inventory branch; 078 changed only the mode fragment)

Today: `... AND a.role='inventory' AND b.role='reviewer' AND a.person_id<>b.person_id ...`

**Proposed:**
- `separated` mode: unchanged.
- `solo` mode: `a.id<>b.id` (distinct staff rows, therefore distinct keys).

The on-chain counterpart, `register_card`, already needs two *keys* (inventory + authenticator, `lib.rs:349-350`).

### 1.5 Refund governance (P): `061:148` and `061:169`

Today:
- `061:148`, in `fn_payment_v2_approve_refund`:
  `IF (SELECT count(DISTINCT person_id) FROM payment_v2.staff WHERE role='governor' AND active)<>3 THEN RAISE EXCEPTION 'PAYMENT_V2_THREE_GOVERNORS_REQUIRED';`
- `061:150`: ready at `>=2` distinct approving persons.
- `061:169`, in `fn_payment_v2_record_attestation` (refund family):
  `... count(DISTINCT person_id) FROM payment_v2.governance_approvals WHERE decision_id=d.id)<2 THEN RAISE EXCEPTION 'PAYMENT_V2_TWO_GOVERNORS_REQUIRED'`

**Proposed:**
- `<>3` becomes `<> G` (raise `PAYMENT_V2_GOVERNOR_SET_INCOMPLETE`).
- "≥2 distinct approving persons" is **unchanged**. With G=2, that means *both* governors must approve every refund and dispute
  resolution.
- `061:169` is unchanged.
- `governance_approvals UNIQUE(decision_id,person_id)` (`059:151-154`) still makes approval per person.

### 1.6 Unchanged on purpose

- **`payment_v2.staff_identity`** (`063:35`). One `user_id` or public key may never map to two `person_id`s, so a solo operator
  holding six roles has six staff rows with **one** `person_id`. This is the anti-faking guarantee.
- **`staff` is append-only:** no deletes, identity immutable (`059:217`, `063:35`). `decisions`, `attestations` and
  `governance_approvals` are immutable (`059:212-213`).
- **Program key checks:**
  - `Roles::validate`: 8 role keys + 3 governance keys, all distinct (`lib.rs:261-264`).
  - Authentication by a key other than the receipt key (`:146`).
  - Release by a key other than the authenticator, reviewer, receiver and issuer keys (`:150-155`).
  - Review by a key other than the authenticator and receiver keys (`:161`).

---

## 2. The mode is explicit, recorded and governed

**New owner-only table** in migration 082. A single row; no client grants.
```
payment_v2.governance_mode(
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  operational_separation text NOT NULL CHECK (operational_separation IN ('separated','solo')),
  governors_required smallint NOT NULL CHECK (governors_required IN (2,3)),
  release_delay_seconds integer NOT NULL CHECK (release_delay_seconds >= 0),
  CHECK (operational_separation='separated' OR (governors_required=2 AND release_delay_seconds>=86400))
)
```

**Initial value: `('separated', 3, 0)`.** That is exactly today's behaviour, so every existing test and fixture keeps passing.
The founder switches to solo **through governance**, not through the migration.

**Visible in audits:**
- `audit_configuration` (`063:30-31`) is attached to the new table, so every change lands in the immutable
  `configuration_history` with `before_value`, `after_value` and `actor_login`.
- Every decision row additionally records the mode in force: a new nullable `decisions.mode_at_decision` column, or the mode
  embedded in `payload`. *Decision D2 for the founder: a column (queryable) or payload (no schema change to an immutable table).
  Recommend the column.*

**Changeable only by the governors:** two new authenticated RPCs.
- **`fn_payment_v2_propose_governance_mode(p_separation, p_governors, p_delay)`:** the caller must be an active `governor`.
  Inserts an immutable proposal row.
- **`fn_payment_v2_approve_governance_mode(p_proposal)`:** a governor of a *different* `person_id` approves. On the approval
  that reaches the threshold, the row is applied.
  - The threshold is 2 distinct governor persons in either mode. It is not "G", because switching from 3 governors to 2 must
    not need the governor about to be removed.
- **Refused while any network has `funding_enabled`.** The mode changes only while funding is off, like 078 and 080.
- **Bootstrap.** Production has no staff rows yet. The founder (owner SQL) inserts the two governor staff rows: himself and the
  friend, two real `person_id`s. Then the two of them propose and approve `('solo', 2, 86400)`.

  The founder, as `postgres`, *could* bypass this. That is the existing database trust boundary (§3.5). The point of the
  RPCs is an honest, attributable record.

**Turning funding OFF stays single-person:**
- **On chain:** `emergency_pause` by the guardian key (`lib.rs:69-72`), unchanged.
- **DB:** new `fn_payment_v2_disable_funding()`. Any active guardian **or** governor may call it. It only ever sets
  `funding_enabled=false`, and it is audited.
- **Turning funding ON** in the DB becomes a propose/approve pair with the same 2-governor rule. Today it is owner SQL.

---

## 3. Compensating controls

### 3.1 Minimum delay between authentication and release: **24 h (86 400 s)**

- **Why 24 h:**
  - With no second human between authenticating and releasing, the only independent checks left are the buyer, the friend
    (who is notified, §3.4) and the founder's own second look.
  - 24 h matches the policy's existing `evidenceGraceSeconds` 86400 (`059:48`), and is shorter than its 48 h
    `rejectionChallengeSeconds`.
  - It costs the seller one day.
- **Enforced in three places:** `record_decision` (§1.3), reconcile (§1.2) and on chain (§3.3).
- In `separated` mode the delay is configurable and may be 0, which is today's behaviour.

### 3.2 Caps

The caps are **unchanged and on chain**: `max_trade` and `max_escrow` (`lib.rs:111,124-125`), set by governance (`configure`,
`lib.rs:32-41`, funding must be paused). The DB caps (`networks.max_trade_units`/`max_escrow_units`) mirror them. In solo mode,
caps are the main limit on what one person could do wrong at once, so keep the canary values from W1 decision 9.

### 3.3 Program changes (`solana/programs/flexsoar-settlement/src/lib.rs`)

1. **On-chain release delay:**
   - add `authenticated_at: i64` to `SaleV2`, set in `record_authentication` (and in `review_authentication` when it passes);
   - add `release_delay: i64` to `ConfigV2`, set only by `configure` (2-of-3 or the vault) while paused;
   - `authorize_release` requires `Clock::unix_timestamp >= authenticated_at + release_delay`.

   Both account sizes change. **This is safe only before mainnet**: no v2 accounts exist on mainnet. Devnet and local
   rehearsals redeploy.
2. **Two-person governance without a program change:**
   - `initialize_v2` still needs 3 distinct governance keys.
   - Ceremony, with funding paused (the program starts paused, `lib.rs:26`):
     1. initialize with `[founder_hw, friend_hw, ceremony_key]`;
     2. in the same ceremony, founder and friend call `install_governance_vault` with a **Squads 2-of-2** vault (founder +
        friend);
     3. destroy `ceremony_key`.
   - From then on `govern()` accepts only the vault (`lib.rs:221-223`). That covers `configure`, `set_pause`,
     `rotate_governance`, `update_future_terms`, `authorize_refund` and `resolve_dispute` (`:166`, `:179`). Every governance act
     then needs both people.
   - **Residual risk:** between steps 1 and 2, two of the three native keys are in the room. State this in the runbook, and do
     the steps back to back while paused, with caps at 0 (`lib.rs:28`).
   - *Alternative:* change `governance` to `[Pubkey;2]` with "both must sign". That is a program change. Not recommended,
     because the vault already does it.
3. **Seller-signed listing floor:** §5.

### 3.4 Immutable audit trail and notification

- **Audit trail, already in place:**
  - Who did each step is recorded immutably in `decisions(actor_staff, person_id, created_at)`, `attestations` (signature,
    slot, actor, executedAtSeconds) and `governance_approvals`.
  - Retained chain evidence is stored too (`verified_chain_evidence`, 068/069).
  - Staff and network changes are recorded in `configuration_history`.
- **Add:** `mode_at_decision` (§2).
- **Add:** an outbox notification to **both governors** on every `authentication_pass` and `release` decision while in solo
  mode. The friend sees each release with 24 h to object; he cannot stop it alone, but he can call the founder or the guardian
  can pause.
- **Add:** a daily report of releases where the authenticating and releasing `person_id` are the same.

### 3.5 Honest limits

- In solo mode **the database cannot stop the founder.** He holds `postgres` and every operational key.
- What actually holds:
  - **on chain:** a release needs distinct keys plus the 24 h delay, and **refunds, cap changes and unpausing need the friend's
    signature through the vault**;
  - **caps** bound the exposure;
  - **the audit trail** is immutable and also exists on chain.
- Solo mode is a **declared** reduction of separation of duties, not an equivalent of it.

---

## 4. Tests that encode the 4+3 rule, and how each would change

**Finding:** no existing test asserts a separation rule *negatively*. Nothing asserts `INDEPENDENT_PERSON_REQUIRED`,
`ACCEPTANCE_REQUIRED`, `THREE_GOVERNORS_REQUIRED`, `TWO_GOVERNORS_REQUIRED`, or a `funding_configuration` refusal (checked
by grep across `tests/`). The rule is encoded only implicitly, by fixtures that build a compliant staff set. With the initial mode
`('separated',3,0)` those fixtures stay valid, so **no existing assertion changes.**

| Test | What it encodes | Change |
|---|---|---|
| `tests/payment-db/01_fixtures.sql` (`fixture()` staff loop) | 10 staff: 7 roles + 3 governors, every one a distinct person and key | **None** (separated mode). |
| `02_attestation_fixture.sql:6-13` | a second, different governor approves refunds | **None.** |
| `10_contracts.sql:37-50` | receipt, authentication and release by distinct staff/persons | **None.** |
| `20_outcomes_recovery.sql`, `35_workers_setup.sql`, `50_races_setup.sql` | refund paths through `attest()` with 2-of-3 approval | **None.** |
| `36-40` worker logins | DB-role separation only, no person rule | **None.** |
| `90_final_acceptance.sql` | the checkpoint set | **None.** A new checkpoint for the solo suite is *added* (`repairs` 2 → 3), with the same pattern as 08/09. |
| `tests/payment-integration/integrated.mjs:53,115,280` | 3 local governors, refund approved by a second | **None** (separated). A solo rehearsal is a *new* scenario. |
| `tests/invariants.test.ts` | none | none |

**New tests.** A new file `tests/payment-db/83_solo_mode.sql` covers both modes, and the first block also covers the current
gaps:
- In separated mode (today), each refusal **fires**: `INDEPENDENT_PERSON_REQUIRED`, `ACCEPTANCE_REQUIRED`,
  `THREE_GOVERNORS_REQUIRED` and the `funding_configuration` refusal.
- The mode change is refused for one governor, refused while funding is on, and audited in `configuration_history`.
- In solo mode, one person holding every operational role is accepted **only** with distinct keys. The same *key* reused is
  refused (`INDEPENDENT_KEY_REQUIRED`). Release before 24 h is refused (`RELEASE_DELAY`). A refund still needs both governors.
- With G=2, a third governor row makes `funding_configuration` false.

The program needs Rust tests for `release_delay` and the seller floor (§5), plus `local-v2.mjs` scenarios.

---

## 5. Seller-signed listing price (program change, design only)

**The problem:**
- `open_sale` is signed by the issuer alone (`lib.rs:354-362`). Today it pins seller, ATA, card, generation and revision.
- **But price is not bound at open:** `same_sale` (`protocol.rs:27-35`) leaves out `total`, `net` and `fee`. The issuer chooses
  `total` per attempt, in the permit it co-signs at `buy_sale` (`lib.rs:108-114`).
- So a leaked issuer key can sell any registered card at any price up to `max_trade`.

**The design:**
- At listing time the seller's wallet (the registered `card.owner`) signs, off chain and with no SOL needed, a canonical
  **listing message**:
  ```
  "FSOARV2-LIST\0" || domain || program || card || sale_id || generation || min_total_u64_le || list_expires_at_i64_le
  ```
  `min_total` is the floor in USDC base units. The app computes it at listing time from the MYR price, minus a stated FX
  tolerance (proposed 2%), and shows it to the seller before they sign.
- **`open_sale`** requires an **Ed25519 precompile instruction** in the same transaction, verifying that message under
  `card.owner`. It is checked through the instructions sysvar, the same mechanism the program already uses in
  `standalone_financial_instruction`, `lib.rs:227-240`. It then stores `min_total` and `list_expires_at` in `SaleV2`.
- **`buy_sale`** additionally requires `p.total >= sale.min_total` and `now < sale.list_expires_at`.
- **If FX moves outside the tolerance,** the sale is revoked and re-listed with a new seller signature. The `revise_sale` and
  `revoke_sale` flow already exists (`lib.rs:99-107`).
- **DB side:**
  - store the signed message and signature in `payment_v2.sales.issuer_terms` (immutable terms, 063);
  - `prepare_sale` verifies the signature app-side (Ed25519 is not available in SQL), and the worker refuses to open a sale
    without one;
  - `authorize_attempt` refuses a quote below `min_total`.
- **Effect:** an issuer leak can no longer under-price. The worst it can do is open sales the seller already signed for.
- `register_card` (inventory + authenticator keys) remains the point that fixes `card.owner`. Under solo mode both of those keys
  belong to one person; that is covered by the caps and the audit trail.
- **Size and compatibility:** `SaleV2` grows (as in §3.3.1). This must ship **in the same pre-mainnet program build**.

---

## Decisions for the founder

1. **Accept solo mode with these exact changes** (§1). Recommend: yes, with the initial mode `separated` and the switch to solo
   done through the governor RPCs (§2).
2. **`mode_at_decision`:** recommend a new column on `decisions` rather than payload.
3. **Release delay:** recommend **24 h**, enforced in the DB *and* on chain.
4. **Governance:** recommend a Squads 2-of-2 vault (founder + friend) installed in the initialization ceremony, with no program
   change for governance. Accept the stated ceremony window.
5. **Funding on:** recommend making enabling a 2-governor DB action too (today it is owner SQL). Turning it off stays
   single-person.
6. **Seller-signed floor:** recommend yes, with a 2% FX tolerance, shipped in the same pre-mainnet build as the release delay.
7. **Order of work:**
   - 082: DB solo mode + the missing negative tests;
   - a program upgrade: release delay + seller floor + Rust tests;
   - a devnet rehearsal in solo mode;
   - then W1 milestones M7 onwards.

## Not verified

- Squads 2-of-2 vault compatibility with `install_governance_vault` (an off-curve PDA signing through CPI, as `lib.rs:221-223`
  expects).
- The compute budget of an extra Ed25519 precompile instruction in `open_sale`.
- Whether Privy embedded wallets expose `signMessage` for arbitrary bytes. The wallet-link flow already uses it
  (`privy.ts`), which suggests yes.
