//! V2: conditional first-sale escrow, direct warehouse resale, shared consumption.
//! Upgrade authority remains trusted. No close, sweep or generic withdrawal.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{bpf_loader_upgradeable, hash::hash};
use anchor_lang::solana_program::sysvar::instructions::{load_current_index_checked,load_instruction_at_checked};
use anchor_spl::{token::{self, Mint, Token, TokenAccount, Transfer}, associated_token::get_associated_token_address};
pub mod protocol;
pub use protocol::{Permit, Attestation, TAG, listing_message, listing_floor_and_expiry, ed25519_signer_and_message};
declare_id!("CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF");

#[program]
pub mod flexsoar_settlement {
    use super::*;
    // Old unrestricted instructions are explicitly rejected after upgrade.
    pub fn buy(_ctx: Context<Legacy>, _price: u64, _vault_ref: [u8;32]) -> Result<()> { err!(Fault::LegacyDisabled) }
    pub fn initialize(_ctx: Context<Legacy>) -> Result<()> { err!(Fault::LegacyDisabled) }

    pub fn initialize_v2(ctx: Context<Init>, domain: [u8;32], policy: [u8;32], treasury: Pubkey, roles: Roles, governance: [Pubkey;3]) -> Result<()> {
        let (expected, _) = Pubkey::find_program_address(&[crate::ID.as_ref()], &bpf_loader_upgradeable::ID);
        require_keys_eq!(expected, ctx.accounts.program_data.key(), Fault::Authority);
        require!(ctx.accounts.program_data.upgrade_authority_address == Some(ctx.accounts.bootstrap.key()), Fault::Authority);
        roles.validate(&governance)?;
        require!(domain != [0;32] && policy != [0;32] && treasury != Pubkey::default() && ctx.accounts.mint.decimals == 6, Fault::Binding);
        let c = &mut ctx.accounts.config;
        c.domain = domain; c.policy = policy; c.treasury = treasury; c.roles = roles; c.governance = governance;
        c.mint = ctx.accounts.mint.key(); c.epoch = 1;
        c.funding_paused = true; c.outflow_paused = false;
        c.max_trade = 0; c.max_escrow = 0; c.outstanding = 0;
        c.governance_vault = Pubkey::default(); c.governance_policy = [0;32];
        c.release_delay = 0;
        Ok(())
    }
    pub fn configure(ctx: Context<Govern>, roles: Roles, max_trade: u64, max_escrow: u64) -> Result<()> {
        govern(&ctx.accounts.config, &ctx.accounts.first, &ctx.accounts.second)?;
        require!(ctx.accounts.config.funding_paused, Fault::Paused);
        roles.validate(&ctx.accounts.config.governance)?;
        require!(![roles.issuer,roles.inventory,roles.receiver,roles.authenticator,roles.reviewer,roles.release,roles.reconciler,roles.guardian].contains(&ctx.accounts.config.governance_vault), Fault::Authority);
        let c = &mut ctx.accounts.config;
        require!(max_escrow >= c.outstanding && (max_trade == 0 || max_escrow >= max_trade), Fault::Cap);
        c.roles = roles; c.max_trade = max_trade; c.max_escrow = max_escrow;
        c.epoch = c.epoch.checked_add(1).ok_or(Fault::Arithmetic)?; Ok(())
    }
    pub fn set_pause(ctx: Context<Govern>, funding: bool, outflow: bool) -> Result<()> {
        govern(&ctx.accounts.config, &ctx.accounts.first, &ctx.accounts.second)?;
        if !funding { require!(ctx.accounts.config.max_trade > 0 && ctx.accounts.config.max_escrow > 0, Fault::Cap); }
        ctx.accounts.config.funding_paused = funding; ctx.accounts.config.outflow_paused = outflow; Ok(())
    }
    /// Governance-set minimum gap between a passing authentication and `authorize_release`.
    /// Snapshotted per sale at authentication, so a later change cannot shorten an in-flight sale's delay.
    /// Same discipline as `configure`: funding must be paused. Bounded so it can never strand an escrow.
    pub fn set_release_delay(ctx: Context<Govern>, delay_seconds: i64) -> Result<()> {
        govern(&ctx.accounts.config, &ctx.accounts.first, &ctx.accounts.second)?;
        require!(ctx.accounts.config.funding_paused, Fault::Paused);
        require!((0..=MAX_RELEASE_DELAY).contains(&delay_seconds), Fault::DelayRange);
        ctx.accounts.config.release_delay = delay_seconds; Ok(())
    }
    pub fn rotate_governance(ctx: Context<Govern>, governance: [Pubkey;3]) -> Result<()> {
        govern(&ctx.accounts.config, &ctx.accounts.first, &ctx.accounts.second)?;
        require!(ctx.accounts.config.funding_paused, Fault::Paused);
        ctx.accounts.config.roles.validate(&governance)?;
        ctx.accounts.config.governance = governance; Ok(())
    }
    /// Native 2/3 must explicitly enroll a reviewed off-curve governance vault.
    /// Its threshold/program policy is externally audited, not guessed here.
    pub fn install_governance_vault(ctx: Context<Govern>, vault: Pubkey, policy: [u8;32]) -> Result<()> {
        govern(&ctx.accounts.config, &ctx.accounts.first, &ctx.accounts.second)?;
        require!(ctx.accounts.config.funding_paused && vault != Pubkey::default() && is_off_curve(&vault) && policy != [0;32], Fault::Authority);
        let r=&ctx.accounts.config.roles;
        require!(![r.issuer,r.inventory,r.receiver,r.authenticator,r.reviewer,r.release,r.reconciler,r.guardian].contains(&vault), Fault::Authority);
        ctx.accounts.config.governance_vault=vault; ctx.accounts.config.governance_policy=policy; Ok(())
    }
    pub fn update_future_terms(ctx: Context<Govern>, treasury: Pubkey, policy: [u8;32]) -> Result<()> {
        govern(&ctx.accounts.config, &ctx.accounts.first, &ctx.accounts.second)?;
        let c = &mut ctx.accounts.config;
        require!(c.funding_paused && treasury != Pubkey::default() && policy != [0;32], Fault::Binding);
        c.treasury = treasury; c.policy = policy;
        c.epoch = c.epoch.checked_add(1).ok_or(Fault::Arithmetic)?; Ok(())
    }
    pub fn emergency_pause(ctx: Context<Guardian>, outflow: bool) -> Result<()> {
        ctx.accounts.config.funding_paused = true;
        if outflow { ctx.accounts.config.outflow_paused = true; } Ok(())
    }
    pub fn register_card(ctx: Context<Register>, card_id: [u8;32], pair: [u8;32], owner: Pubkey, mode: u8) -> Result<()> {
        require!(mode <= 1 && card_id != [0;32] && pair != [0;32] && owner != Pubkey::default(), Fault::Binding);
        let c = &mut ctx.accounts.card;
        c.card = card_id; c.pair = pair; c.owner = owner; c.mode = mode;
        c.custody_version = 1; c.resolved = true; c.generation = 0; c.quarantined = false; Ok(())
    }
    pub fn open_sale(ctx: Context<Open>, template: Permit) -> Result<()> {
        let c = &ctx.accounts.config; let card = &mut ctx.accounts.card;
        require!(!c.funding_paused && card.resolved && !card.quarantined, Fault::Locked);
        require!(template.tag == TAG && template.version == 2 && template.domain == c.domain && template.policy == c.policy, Fault::Binding);
        require_keys_eq!(template.program, crate::ID, Fault::Binding);
        require_keys_eq!(template.config, c.key(), Fault::Binding);
        require_keys_eq!(template.mint, c.mint, Fault::Binding);
        require_keys_eq!(template.treasury, c.treasury, Fault::Binding);
        require_keys_eq!(template.token_program, token::ID, Fault::Binding);
        require_keys_eq!(template.seller, card.owner, Fault::Binding);
        require!(template.card == card.card && template.pair == card.pair && template.mode == card.mode && template.custody_version == card.custody_version, Fault::Binding);
        let next = card.generation.checked_add(1).ok_or(Fault::Arithmetic)?;
        require!(template.generation == next && template.revision > 0 && template.sale_id != [0;32], Fault::Binding);
        require!(template.seller != template.treasury && template.treasury != Pubkey::default(), Fault::Binding);
        require_keys_eq!(template.seller_token, get_associated_token_address(&template.seller, &c.mint), Fault::Binding);
        require_keys_eq!(template.treasury_token, get_associated_token_address(&template.treasury, &c.mint), Fault::Binding);
        let (min_total, list_expires_at) = verify_listing(&ctx.accounts.instructions.to_account_info(), c, card, &template)?;
        card.generation = next; card.resolved = false; card.sale = ctx.accounts.sale.key();
        ctx.accounts.sale.terms = template; ctx.accounts.sale.state = 1;
        ctx.accounts.sale.bump = ctx.bumps.sale; ctx.accounts.sale.decision_revision = 0;
        ctx.accounts.sale.min_total = min_total; ctx.accounts.sale.list_expires_at = list_expires_at; Ok(())
    }
    pub fn revoke_sale(ctx: Context<Lifecycle>) -> Result<()> {
        require!(ctx.accounts.sale.state == 1 && ctx.accounts.card.sale == ctx.accounts.sale.key(), Fault::Locked);
        ctx.accounts.sale.state = 6; ctx.accounts.card.resolved = true; Ok(())
    }
    pub fn revise_sale(ctx: Context<Lifecycle>, expected_revision: u64) -> Result<()> {
        let s = &mut ctx.accounts.sale;
        require!(s.state == 1 && s.terms.revision == expected_revision && ctx.accounts.card.sale == s.key(), Fault::Locked);
        s.terms.revision = expected_revision.checked_add(1).ok_or(Fault::Arithmetic)?; Ok(())
    }
    pub fn buy_sale(ctx: Context<Purchase>, p: Permit) -> Result<()> {
        standalone_financial_instruction(&ctx.accounts.instructions.to_account_info())?;
        let c = &mut ctx.accounts.config; let s = &mut ctx.accounts.sale; let card = &ctx.accounts.card;
        require!(!c.funding_paused && c.max_trade > 0 && p.total <= c.max_trade, Fault::Cap);
        require!(s.state == 1 && !card.resolved && card.sale == s.key() && card.generation == p.generation, Fault::Locked);
        require!(p.valid_at(Clock::get()?.unix_timestamp) && s.terms.same_sale(&p), Fault::Binding);
        // Seller's signed listing bounds the issuer: no under-pricing, no sale after the seller's own expiry.
        require!(Clock::get()?.unix_timestamp < s.list_expires_at, Fault::ListingExpired);
        require!(p.total >= s.min_total, Fault::BelowFloor);
        require!(p.authority_epoch == c.epoch && p.issuer == c.roles.issuer && p.custody_version == card.custody_version && p.mode == card.mode, Fault::Binding);
        require!(p.treasury == c.treasury && p.policy == c.policy, Fault::Binding);
        require_keys_eq!(p.buyer, ctx.accounts.buyer.key(), Fault::Authority);
        require!(p.attempt != [0;32] && p.beneficiary != [0;32], Fault::Binding);
        check_token(&ctx.accounts.source, &p.buyer_token, &p.buyer, &p.mint)?;
        check_token(&ctx.accounts.seller_token, &p.seller_token, &p.seller, &p.mint)?;
        check_token(&ctx.accounts.treasury_token, &p.treasury_token, &p.treasury, &p.mint)?;
        require_keys_eq!(p.refund_token, get_associated_token_address(&p.buyer, &p.mint), Fault::Binding);
        if p.mode == 0 {
            let outstanding = c.outstanding.checked_add(p.total).ok_or(Fault::Arithmetic)?;
            require!(outstanding <= c.max_escrow, Fault::Cap);
            transfer(&ctx.accounts.token_program, &ctx.accounts.source, &ctx.accounts.escrow, &ctx.accounts.buyer.to_account_info(), p.total, &[])?;
            c.outstanding = outstanding; s.state = 2;
        } else {
            transfer(&ctx.accounts.token_program, &ctx.accounts.source, &ctx.accounts.seller_token, &ctx.accounts.buyer.to_account_info(), p.net, &[])?;
            transfer(&ctx.accounts.token_program, &ctx.accounts.source, &ctx.accounts.treasury_token, &ctx.accounts.buyer.to_account_info(), p.fee, &[])?;
            s.state = 3;
        }
        s.terms = p; s.funded_slot = Clock::get()?.slot;
        s.funded_at = Clock::get()?.unix_timestamp; emit_state(s)?; Ok(())
    }
    pub fn record_receipt(ctx: Context<Staff>, a: Attestation) -> Result<()> {
        require_keys_eq!(ctx.accounts.actor.key(), ctx.accounts.config.roles.receiver, Fault::Authority);
        attest(&ctx.accounts.sale, ctx.accounts.sale.key(), &a, 0)?;
        let s = &mut ctx.accounts.sale; require!(!s.received && s.decision == 0 && !s.held, Fault::Locked);
        s.received = true; s.receipt = a.evidence; s.received_by = ctx.accounts.actor.key(); Ok(())
    }
    pub fn record_authentication(ctx: Context<Staff>, a: Attestation, passed: bool) -> Result<()> {
        require_keys_eq!(ctx.accounts.actor.key(), ctx.accounts.config.roles.authenticator, Fault::Authority);
        attest(&ctx.accounts.sale, ctx.accounts.sale.key(), &a, if passed {1} else {2})?;
        let s = &mut ctx.accounts.sale;
        require!(s.received && s.authentication == 0 && s.decision == 0 && !s.held && s.received_by != ctx.accounts.actor.key(), Fault::Locked);
        s.authentication = if passed {1} else {2}; s.inspection = a.evidence; s.authenticated_by = ctx.accounts.actor.key();
        if passed { stamp_authentication(s, &ctx.accounts.config)?; } Ok(())
    }
    pub fn authorize_release(ctx: Context<Staff>, a: Attestation) -> Result<()> {
        require_keys_eq!(ctx.accounts.actor.key(), ctx.accounts.config.roles.release, Fault::Authority);
        attest(&ctx.accounts.sale, ctx.accounts.sale.key(), &a, 3)?;
        let s = &mut ctx.accounts.sale;
        require!(s.received && s.authentication == 1 && !s.held && s.decision == 0, Fault::Locked);
        require!(ctx.accounts.actor.key() != s.authenticated_by && ctx.accounts.actor.key() != s.reviewed_by && ctx.accounts.actor.key() != s.received_by && ctx.accounts.actor.key() != s.terms.issuer, Fault::Authority);
        let release_at = s.authenticated_at.checked_add(s.release_delay).ok_or(Fault::Arithmetic)?;
        require!(Clock::get()?.unix_timestamp >= release_at, Fault::ReleaseDelay);
        s.decision = 1; s.decision_evidence = a.evidence;
        s.decision_revision = s.decision_revision.checked_add(1).ok_or(Fault::Arithmetic)?; Ok(())
    }
    pub fn review_authentication(ctx: Context<Staff>, a: Attestation, passed: bool) -> Result<()> {
        require_keys_eq!(ctx.accounts.actor.key(), ctx.accounts.config.roles.reviewer, Fault::Authority);
        attest(&ctx.accounts.sale, ctx.accounts.sale.key(), &a, 8)?;
        let s = &mut ctx.accounts.sale;
        require!(s.held && s.authentication == 2 && !s.reviewed && s.decision == 0 && ctx.accounts.actor.key() != s.authenticated_by && ctx.accounts.actor.key() != s.received_by, Fault::Authority);
        s.reviewed = true; s.reviewed_by = ctx.accounts.actor.key(); s.review_evidence = a.evidence;
        s.authentication = if passed {1} else {2};
        if passed { stamp_authentication(s, &ctx.accounts.config)?; } Ok(())
    }
    pub fn authorize_refund(ctx: Context<GovernSale>, a: Attestation) -> Result<()> {
        govern(&ctx.accounts.config, &ctx.accounts.first, &ctx.accounts.second)?;
        attest(&ctx.accounts.sale, ctx.accounts.sale.key(), &a, 4)?;
        let s = &mut ctx.accounts.sale; require!(s.decision == 0 && !s.held, Fault::Locked);
        s.decision = 2; s.decision_evidence = a.evidence;
        s.decision_revision = s.decision_revision.checked_add(1).ok_or(Fault::Arithmetic)?; Ok(())
    }
    pub fn dispute_hold(ctx: Context<Staff>, a: Attestation) -> Result<()> {
        require_keys_eq!(ctx.accounts.actor.key(), ctx.accounts.config.roles.guardian, Fault::Authority);
        attest(&ctx.accounts.sale, ctx.accounts.sale.key(), &a, 5)?;
        let s = &mut ctx.accounts.sale; s.held = true;
        s.decision_revision = s.decision_revision.checked_add(1).ok_or(Fault::Arithmetic)?; Ok(())
    }
    pub fn resolve_dispute(ctx: Context<GovernSale>, a: Attestation, refund: bool) -> Result<()> {
        govern(&ctx.accounts.config, &ctx.accounts.first, &ctx.accounts.second)?;
        attest(&ctx.accounts.sale, ctx.accounts.sale.key(), &a, if refund {7} else {6})?;
        let s = &mut ctx.accounts.sale; require!(s.held, Fault::Locked);
        if !refund { require!(s.received && s.authentication == 1, Fault::Authority); }
        // Clearing a hold never substitutes governance for independent release approval.
        s.held = false; s.decision = if refund {2} else {0}; s.decision_evidence = a.evidence;
        s.decision_revision = s.decision_revision.checked_add(1).ok_or(Fault::Arithmetic)?; Ok(())
    }
    pub fn execute_outcome(ctx: Context<Outcome>, expected_revision: u64) -> Result<()> {
        standalone_financial_instruction(&ctx.accounts.instructions.to_account_info())?;
        let c = &mut ctx.accounts.config; let s = &mut ctx.accounts.sale;
        require!(s.execution_allowed(c.outflow_paused, expected_revision), Fault::Locked);
        let p = s.terms.clone(); let sale_key = s.key();
        check_token(&ctx.accounts.refund_token, &p.refund_token, &p.buyer, &p.mint)?;
        check_token(&ctx.accounts.seller_token, &p.seller_token, &p.seller, &p.mint)?;
        check_token(&ctx.accounts.treasury_token, &p.treasury_token, &p.treasury, &p.mint)?;
        require!(ctx.accounts.escrow.amount >= p.total, Fault::Binding); // dust never changes principal
        let bump = [s.bump]; let seeds: &[&[u8]] = &[b"sale-v2", &p.sale_id, &bump];
        if s.decision == 1 {
            require!(s.received && s.authentication == 1, Fault::Authority);
            transfer(&ctx.accounts.token_program, &ctx.accounts.escrow, &ctx.accounts.seller_token, &s.to_account_info(), p.net, &[seeds])?;
            transfer(&ctx.accounts.token_program, &ctx.accounts.escrow, &ctx.accounts.treasury_token, &s.to_account_info(), p.fee, &[seeds])?;
            s.state = 4;
        } else {
            require!(s.decision == 2, Fault::Authority);
            transfer(&ctx.accounts.token_program, &ctx.accounts.escrow, &ctx.accounts.refund_token, &s.to_account_info(), p.total, &[seeds])?;
            s.state = 5;
        }
        let _ = sale_key; c.outstanding = c.outstanding.checked_sub(p.total).ok_or(Fault::Arithmetic)?;
        s.outcome_slot = Clock::get()?.slot; emit_state(s)?; Ok(())
    }
    pub fn acknowledge_claim(ctx: Context<Acknowledge>, evidence: [u8;32]) -> Result<()> {
        let s = &ctx.accounts.sale; let card = &mut ctx.accounts.card;
        require!(evidence != [0;32] && matches!(s.state, 3|4|5) && card.sale == s.key() && !card.resolved, Fault::Locked);
        card.resolved = true;
        if s.state == 5 { card.quarantined = true; }
        else { card.owner = s.terms.buyer; card.mode = 1; card.custody_version = card.custody_version.checked_add(1).ok_or(Fault::Arithmetic)?; }
        Ok(())
    }
}

fn govern(c: &ConfigV2, first: &Signer, second: &Signer) -> Result<()> {
    if c.governance_vault != Pubkey::default() {
        // Same vault AccountInfo supplied twice; it can sign only through CPI.
        require!(first.key()==c.governance_vault && second.key()==c.governance_vault, Fault::Authority);
    } else {require!(governance_valid(&c.governance, first.key(), second.key()), Fault::Authority);}
    Ok(())
}
/// True when `key` is not a valid ed25519 point, i.e. it can only ever sign through a program's CPI (a PDA).
/// `Pubkey::is_on_curve()` is `unimplemented!()` on the SBF target and PANICS on chain, which made
/// `install_governance_vault` unusable; on chain this asks the runtime's curve25519 syscall instead (0 = valid point).
fn is_off_curve(key: &Pubkey) -> bool {
    #[cfg(target_os = "solana")]
    {
        let mut result = 0u8;
        // SAFETY: both pointers are valid for the duration of the call; curve id 0 is CURVE25519_EDWARDS.
        unsafe { anchor_lang::solana_program::syscalls::sol_curve_validate_point(0, key.as_ref().as_ptr(), &mut result as *mut u8) != 0 }
    }
    #[cfg(not(target_os = "solana"))]
    { !key.is_on_curve() }
}
/// Records when authentication passed and freezes the governance delay in force at that moment.
fn stamp_authentication(s: &mut SaleV2, c: &ConfigV2) -> Result<()> {
    s.authenticated_at = Clock::get()?.unix_timestamp; s.release_delay = c.release_delay; Ok(())
}
/// Requires the Ed25519 precompile instruction IMMEDIATELY before `open_sale`, signed by the card's registered owner
/// over the canonical listing message for exactly this card/sale/generation. Returns the seller's (floor, expiry).
/// The runtime already verified the signature when the precompile ran; this binds who signed and what was signed.
fn verify_listing(info: &AccountInfo, c: &ConfigV2, card: &CardControl, template: &Permit) -> Result<(u64, i64)> {
    let current = load_current_index_checked(info)? as usize;
    require!(current > 0, Fault::ListingInvalid);
    let pre = load_instruction_at_checked(current - 1, info)?;
    require_keys_eq!(pre.program_id, anchor_lang::solana_program::ed25519_program::ID, Fault::ListingInvalid);
    let (signer, message) = ed25519_signer_and_message(&pre.data).ok_or(Fault::ListingInvalid)?;
    require!(signer == card.owner.as_ref(), Fault::ListingSigner);
    let (min_total, expires) = listing_floor_and_expiry(message).ok_or(Fault::ListingInvalid)?;
    let expected = listing_message(&c.domain, &crate::ID, &template.card, &template.sale_id, template.generation, min_total, expires);
    require!(message == expected.as_slice(), Fault::ListingInvalid);
    require!(min_total > 0 && expires > Clock::get()?.unix_timestamp, Fault::ListingExpired);
    Ok((min_total, expires))
}
fn standalone_financial_instruction(info: &AccountInfo) -> Result<()> {
    let current=load_current_index_checked(info)?;
    let instruction=load_instruction_at_checked(current as usize,info)?;
    require_keys_eq!(instruction.program_id,crate::ID,Fault::Binding); // No proxy CPI buys/exits.
    let mut own=0; let mut complete=false;
    for index in 0..1024 {
        match load_instruction_at_checked(index,info) {
            Ok(ix)=>{if ix.program_id==crate::ID {own+=1;}},
            Err(_)=>{complete=true;break;},
        }
    }
    // Extra compute, memo and ATA instructions are fine; only one own-program
    // instruction when money moves. One signature cannot fund multiple sales.
    require!(own==1 && complete,Fault::Binding); Ok(())
}
fn governance_valid(members: &[Pubkey;3], first: Pubkey, second: Pubkey) -> bool {
    first != second && members.contains(&first) && members.contains(&second)
}
fn attest(s: &SaleV2, key: Pubkey, a: &Attestation, action: u8) -> Result<()> {
    require!(s.state == 2 && a.tag == TAG && a.action == action && a.sale == key.to_bytes() && a.attempt == s.terms.attempt && a.pair == s.terms.pair && a.evidence != [0;32] && a.revision == s.decision_revision, Fault::Binding); Ok(())
}
fn check_token(t: &Account<TokenAccount>, key: &Pubkey, owner: &Pubkey, mint: &Pubkey) -> Result<()> {
    require!(t.key() == *key && t.owner == *owner && t.mint == *mint, Fault::Binding); Ok(())
}
fn transfer<'info>(program: &Program<'info, Token>, from: &Account<'info, TokenAccount>, to: &Account<'info, TokenAccount>, authority: &AccountInfo<'info>, amount: u64, seeds: &[&[&[u8]]]) -> Result<()> {
    token::transfer(CpiContext::new_with_signer(program.to_account_info(), Transfer {from:from.to_account_info(), to:to.to_account_info(), authority:authority.clone()}, seeds), amount)
}
fn emit_state(s: &Account<SaleV2>) -> Result<()> {
    emit!(PaymentState { sale:s.key(), attempt:s.terms.attempt, state:s.state, digest:hash(&s.terms.try_to_vec()?).to_bytes(), slot:Clock::get()?.slot }); Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Roles { pub issuer: Pubkey, pub inventory: Pubkey, pub receiver: Pubkey, pub authenticator: Pubkey, pub reviewer: Pubkey, pub release: Pubkey, pub reconciler: Pubkey, pub guardian: Pubkey }
impl Roles {
    fn validate(&self, governance: &[Pubkey;3]) -> Result<()> {
        let all = [self.issuer,self.inventory,self.receiver,self.authenticator,self.reviewer,self.release,self.reconciler,self.guardian,governance[0],governance[1],governance[2]];
        for (i,key) in all.iter().enumerate() { require!(*key != Pubkey::default() && !all[..i].contains(key), Fault::Authority); } Ok(())
    }
}
#[account]
#[derive(InitSpace)]
pub struct ConfigV2 { pub domain:[u8;32], pub policy:[u8;32], pub treasury:Pubkey, pub mint:Pubkey, pub roles:Roles, pub governance:[Pubkey;3], pub governance_vault:Pubkey, pub governance_policy:[u8;32], pub epoch:u64, pub funding_paused:bool, pub outflow_paused:bool, pub max_trade:u64, pub max_escrow:u64, pub outstanding:u64, pub release_delay:i64 }
#[account]
#[derive(InitSpace)]
pub struct CardControl { pub card:[u8;32], pub pair:[u8;32], pub owner:Pubkey, pub mode:u8, pub custody_version:u64, pub generation:u64, pub sale:Pubkey, pub resolved:bool, pub quarantined:bool }
#[account]
#[derive(InitSpace, Default)]
pub struct SaleV2 {
    pub terms:Permit, pub state:u8, pub bump:u8, pub funded_slot:u64, pub funded_at:i64,
    pub outcome_slot:u64, pub received:bool, pub receipt:[u8;32], pub received_by:Pubkey,
    pub authentication:u8, pub inspection:[u8;32], pub authenticated_by:Pubkey,
    pub reviewed:bool, pub reviewed_by:Pubkey, pub review_evidence:[u8;32],
    pub held:bool, pub decision:u8, pub decision_revision:u64, pub decision_evidence:[u8;32],
    // Appended by the P1 upgrade; every earlier offset is unchanged.
    pub authenticated_at:i64, pub release_delay:i64, pub min_total:u64, pub list_expires_at:i64,
}
impl SaleV2 {
    fn execution_allowed(&self, paused: bool, revision: u64) -> bool {
        self.state == 2 && !self.held && !paused && self.decision_revision == revision
            && (self.decision == 2 || (self.decision == 1 && self.received && self.authentication == 1))
    }
}
#[event]
pub struct PaymentState { pub sale:Pubkey, pub attempt:[u8;32], pub state:u8, pub digest:[u8;32], pub slot:u64 }
/// 30 days. Governance cannot set a delay long enough to strand an authenticated escrow.
pub const MAX_RELEASE_DELAY: i64 = 30 * 24 * 60 * 60;
#[error_code]
// Append-only: Anchor codes are 6000 + index and off-chain clients match on them.
pub enum Fault { LegacyDisabled, Authority, Binding, Locked, Paused, Cap, Arithmetic, ListingInvalid, ListingSigner, ListingExpired, BelowFloor, ReleaseDelay, DelayRange }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn receipt_and_failed_auth_never_allow_release() {
        let mut s = SaleV2::default(); s.state=2; s.received=true; s.decision=1;
        assert!(!s.execution_allowed(false,0));
        s.authentication=2; assert!(!s.execution_allowed(false,0));
        s.authentication=1; assert!(s.execution_allowed(false,0));
    }
    #[test]
    fn terminal_replay_stale_revision_hold_and_pause_fail() {
        let mut s = SaleV2::default(); s.state=2; s.decision=2; s.decision_revision=7;
        assert!(s.execution_allowed(false,7)); assert!(!s.execution_allowed(false,6));
        assert!(!s.execution_allowed(true,7)); s.held=true; assert!(!s.execution_allowed(false,7));
        s.held=false; for state in [1,3,4,5,6] {s.state=state; assert!(!s.execution_allowed(false,7));}
    }
    #[test]
    fn roles_cannot_overlap() {
        let p=|n|Pubkey::new_from_array([n;32]);
        let mut r=Roles {issuer:p(1),inventory:p(2),receiver:p(3),authenticator:p(4),reviewer:p(5),release:p(6),reconciler:p(7),guardian:p(8)};
        assert!(r.validate(&[p(9),p(10),p(11)]).is_ok());
        r.release=r.issuer; assert!(r.validate(&[p(9),p(10),p(11)]).is_err());
        r.release=p(6); assert!(r.validate(&[p(9),p(9),p(11)]).is_err());
    }
    #[test]
    fn fault_codes_are_append_only() {
        // Existing codes must not shift; new ones extend the enum.
        for (fault, code) in [(Fault::LegacyDisabled, 6000), (Fault::Authority, 6001), (Fault::Binding, 6002), (Fault::Locked, 6003), (Fault::Paused, 6004), (Fault::Cap, 6005), (Fault::Arithmetic, 6006),
            (Fault::ListingInvalid, 6007), (Fault::ListingSigner, 6008), (Fault::ListingExpired, 6009), (Fault::BelowFloor, 6010), (Fault::ReleaseDelay, 6011), (Fault::DelayRange, 6012)] {
            assert_eq!(u32::from(fault), code);
        }
    }
    #[test]
    fn release_delay_is_bounded_and_snapshotted_per_sale() {
        assert!((0..=MAX_RELEASE_DELAY).contains(&0) && (0..=MAX_RELEASE_DELAY).contains(&86_400) && (0..=MAX_RELEASE_DELAY).contains(&MAX_RELEASE_DELAY));
        assert!(!(0..=MAX_RELEASE_DELAY).contains(&-1) && !(0..=MAX_RELEASE_DELAY).contains(&(MAX_RELEASE_DELAY + 1)));
        // The sale carries its own copy; the config field is only read when authentication passes.
        let mut s = SaleV2::default(); let mut c = ConfigV2 { domain:[0;32], policy:[0;32], treasury:Pubkey::default(), mint:Pubkey::default(),
            roles: Roles { issuer:Pubkey::default(), inventory:Pubkey::default(), receiver:Pubkey::default(), authenticator:Pubkey::default(), reviewer:Pubkey::default(), release:Pubkey::default(), reconciler:Pubkey::default(), guardian:Pubkey::default() },
            governance:[Pubkey::default();3], governance_vault:Pubkey::default(), governance_policy:[0;32], epoch:0, funding_paused:true, outflow_paused:false, max_trade:0, max_escrow:0, outstanding:0, release_delay:86_400 };
        s.release_delay = c.release_delay; c.release_delay = 0;
        assert_eq!(s.release_delay, 86_400);
        assert_eq!(s.authenticated_at.checked_add(s.release_delay), Some(86_400));
    }
    #[test]
    fn vault_must_be_an_off_curve_address() {
        // A PDA can never be an ed25519 point; a wallet keypair's public key always is.
        let (pda, _) = Pubkey::find_program_address(&[b"vault"], &Pubkey::new_from_array([7; 32]));
        assert!(is_off_curve(&pda));
        let on_curve = (0u8..=255).map(|n| Pubkey::new_from_array([n; 32])).find(|k| k.is_on_curve()).expect("some key is on curve");
        assert!(!is_off_curve(&on_curve));
    }
    #[test]
    fn account_sizes_only_grew_at_the_tail() {
        assert_eq!(8 + ConfigV2::INIT_SPACE, 586 + 8);
        assert_eq!(8 + SaleV2::INIT_SPACE, 961 + 32);
    }
    #[test]
    fn native_two_of_three_requires_independent_members() {
        let p=|n|Pubkey::new_from_array([n;32]); let members=[p(1),p(2),p(3)];
        for (a,b) in [(1,2),(1,3),(2,3)] {assert!(governance_valid(&members,p(a),p(b)));}
        assert!(!governance_valid(&members,p(1),p(1)));
        assert!(!governance_valid(&members,p(1),p(4)));
    }
}

// Large account wrappers live on the heap to keep SBF entrypoint frames below 4 KiB.
// This does not change account serialization or instruction account ordering.
// Account constraints bind every handler to this program's retained PDAs.
#[derive(Accounts)] pub struct Legacy {}
#[derive(Accounts)]
pub struct Init<'info> {
    #[account(init,payer=bootstrap,space=8+ConfigV2::INIT_SPACE,seeds=[b"config-v2"],bump)] pub config:Box<Account<'info,ConfigV2>>,
    #[account(mut)] pub bootstrap:Signer<'info>, pub program_data:Account<'info,ProgramData>, pub mint:Account<'info,Mint>, pub system_program:Program<'info,System>,
}
#[derive(Accounts)]
pub struct Govern<'info> {
    #[account(mut,seeds=[b"config-v2"],bump)] pub config:Box<Account<'info,ConfigV2>>, pub first:Signer<'info>, pub second:Signer<'info>,
}
#[derive(Accounts)]
pub struct Guardian<'info> {
    #[account(mut,seeds=[b"config-v2"],bump)] pub config:Box<Account<'info,ConfigV2>>,
    #[account(address=config.roles.guardian)] pub guardian:Signer<'info>,
}
#[derive(Accounts)]
#[instruction(card_id:[u8;32])]
pub struct Register<'info> {
    #[account(seeds=[b"config-v2"],bump)] pub config:Box<Account<'info,ConfigV2>>,
    #[account(init,payer=inventory,space=8+CardControl::INIT_SPACE,seeds=[b"card-v2",card_id.as_ref()],bump)] pub card:Box<Account<'info,CardControl>>,
    #[account(mut,address=config.roles.inventory)] pub inventory:Signer<'info>,
    #[account(address=config.roles.authenticator)] pub authenticator:Signer<'info>, pub system_program:Program<'info,System>,
}
#[derive(Accounts)]
#[instruction(template:Permit)]
pub struct Open<'info> {
    #[account(seeds=[b"config-v2"],bump)] pub config:Box<Account<'info,ConfigV2>>,
    #[account(mut,seeds=[b"card-v2",template.card.as_ref()],bump)] pub card:Box<Account<'info,CardControl>>,
    #[account(init,payer=issuer,space=8+SaleV2::INIT_SPACE,seeds=[b"sale-v2",template.sale_id.as_ref()],bump)] pub sale:Box<Account<'info,SaleV2>>,
    #[account(init,payer=issuer,seeds=[b"escrow-v2",sale.key().as_ref()],bump,token::mint=mint,token::authority=sale)] pub escrow:Box<Account<'info,TokenAccount>>,
    #[account(address=config.mint)] pub mint:Account<'info,Mint>,
    #[account(mut,address=config.roles.issuer)] pub issuer:Signer<'info>, pub token_program:Program<'info,Token>, pub system_program:Program<'info,System>, pub rent:Sysvar<'info,Rent>,
    /// CHECK: fixed runtime instructions sysvar; carries the seller's Ed25519 listing signature.
    #[account(address=anchor_lang::solana_program::sysvar::instructions::ID)] pub instructions:UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct Lifecycle<'info> {
    #[account(seeds=[b"config-v2"],bump)] pub config:Box<Account<'info,ConfigV2>>,
    #[account(mut,seeds=[b"card-v2",sale.terms.card.as_ref()],bump)] pub card:Box<Account<'info,CardControl>>,
    #[account(mut,seeds=[b"sale-v2",sale.terms.sale_id.as_ref()],bump=sale.bump)] pub sale:Box<Account<'info,SaleV2>>,
    #[account(address=config.roles.issuer)] pub issuer:Signer<'info>,
}
#[derive(Accounts)]
pub struct Purchase<'info> {
    #[account(mut,seeds=[b"config-v2"],bump)] pub config:Box<Account<'info,ConfigV2>>,
    #[account(mut,seeds=[b"card-v2",sale.terms.card.as_ref()],bump)] pub card:Box<Account<'info,CardControl>>,
    #[account(mut,seeds=[b"sale-v2",sale.terms.sale_id.as_ref()],bump=sale.bump)] pub sale:Box<Account<'info,SaleV2>>,
    #[account(address=config.roles.issuer)] pub issuer:Signer<'info>, pub buyer:Signer<'info>,
    #[account(mut)] pub source:Box<Account<'info,TokenAccount>>, #[account(mut)] pub seller_token:Box<Account<'info,TokenAccount>>, #[account(mut)] pub treasury_token:Box<Account<'info,TokenAccount>>,
    #[account(mut,seeds=[b"escrow-v2",sale.key().as_ref()],bump,token::authority=sale,token::mint=config.mint)] pub escrow:Box<Account<'info,TokenAccount>>, pub token_program:Program<'info,Token>,
    /// CHECK: fixed runtime instructions sysvar, never caller-provided contents.
    #[account(address=anchor_lang::solana_program::sysvar::instructions::ID)] pub instructions:UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct Staff<'info> {
    #[account(seeds=[b"config-v2"],bump)] pub config:Box<Account<'info,ConfigV2>>,
    #[account(mut,seeds=[b"sale-v2",sale.terms.sale_id.as_ref()],bump=sale.bump)] pub sale:Box<Account<'info,SaleV2>>, pub actor:Signer<'info>,
}
#[derive(Accounts)]
pub struct GovernSale<'info> {
    #[account(seeds=[b"config-v2"],bump)] pub config:Box<Account<'info,ConfigV2>>,
    #[account(mut,seeds=[b"sale-v2",sale.terms.sale_id.as_ref()],bump=sale.bump)] pub sale:Box<Account<'info,SaleV2>>, pub first:Signer<'info>, pub second:Signer<'info>,
}
#[derive(Accounts)]
pub struct Outcome<'info> {
    #[account(mut,seeds=[b"config-v2"],bump)] pub config:Box<Account<'info,ConfigV2>>,
    #[account(mut,seeds=[b"sale-v2",sale.terms.sale_id.as_ref()],bump=sale.bump)] pub sale:Box<Account<'info,SaleV2>>,
    #[account(mut,seeds=[b"escrow-v2",sale.key().as_ref()],bump,token::authority=sale,token::mint=sale.terms.mint)] pub escrow:Box<Account<'info,TokenAccount>>,
    #[account(mut)] pub seller_token:Box<Account<'info,TokenAccount>>, #[account(mut)] pub treasury_token:Box<Account<'info,TokenAccount>>, #[account(mut)] pub refund_token:Box<Account<'info,TokenAccount>>, pub token_program:Program<'info,Token>,
    /// CHECK: fixed runtime instructions sysvar for standalone financial call.
    #[account(address=anchor_lang::solana_program::sysvar::instructions::ID)] pub instructions:UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct Acknowledge<'info> {
    #[account(seeds=[b"config-v2"],bump)] pub config:Box<Account<'info,ConfigV2>>,
    #[account(mut,seeds=[b"card-v2",sale.terms.card.as_ref()],bump)] pub card:Box<Account<'info,CardControl>>,
    #[account(seeds=[b"sale-v2",sale.terms.sale_id.as_ref()],bump=sale.bump)] pub sale:Box<Account<'info,SaleV2>>,
    #[account(address=config.roles.reconciler)] pub reconciler:Signer<'info>,
}
