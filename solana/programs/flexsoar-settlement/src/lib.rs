//! flexsoar-settlement — non-custodial USDC settlement for FlexSoar cards.
//!
//! Design authority lives off-chain: the Postgres ledger remains the record
//! of WHO owns which card (Item != Card, append-only). This program moves
//! MONEY only — buyer USDC splits to seller + FlexSoar treasury atomically
//! inside `buy`. No escrow persists between instructions, and NO listing
//! state exists on-chain at all: there is deliberately no listing PDA, so
//! sellers never sign anyone onto anything and pay no rent. Delisting,
//! ownership, and eligibility live in the ledger; the backend quote +
//! settle paths (which reject non-public listings) are what stop a stale
//! buy from moving a card. An on-chain `buy` against a delisted card would
//! move USDC to the seller and treasury while settling nothing —
//! self-harming for the caller, never an exploit against anyone else.
//!
//! Roles:
//!   - admin    — FlexSoar multisig. Initializes config, pauses/unpauses,
//!                is the program upgrade authority (set at deploy).
//!   - treasury — USDC account receiving the 5% fee. Set at initialize,
//!                changeable only by admin.
//!   - seller   — receives net. Never signs, never pays rent.
//!   - buyer    — the ONLY signer. Pays the quoted total; receives nothing
//!                on-chain (the card moves off-chain via /api/solana/settle
//!                after this transaction verifies).
//!
//! Money math (USDC = 6 decimals, all u64): fee = price * 500 / 10000
//! (integer division, dust < 1 base unit favours the seller), seller gets
//! price - fee. MAX_PRICE_BASE_UNITS caps pre-audit launch volume per trade.
//!
//! BUILD NOTE: no Rust/Solana toolchain exists on the Windows build box
//! (checked 2026-09-14) and Anchor does not support native Windows builds.
//! Build + deploy on WSL2/Linux with the Solana CLI + Anchor 0.31.x:
//!   anchor build && anchor deploy --provider.cluster devnet
//! then record the program id in DEPS.md / Vercel env (SOLANA_PROGRAM_ID).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF");

/// 5% platform fee in basis points. Matches the off-chain flat fee.
/// Undercuts card-rail marketplaces: sub-cent Solana fees make 5% viable.
pub const FEE_BPS: u64 = 500;
/// Pre-audit per-trade cap: 500 USDC, in base units.
pub const MAX_PRICE_BASE_UNITS: u64 = 500_000_000;

#[program]
pub mod flexsoar_settlement {
    use super::*;

    /// One-time config: admin (pause authority) + treasury (fee sink).
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.treasury = ctx.accounts.treasury.key();
        config.paused = false;
        Ok(())
    }

    /// Freeze new buys. Admin only. The kill-switch: with no on-chain
    /// listing state, pausing `buy` halts all money movement at once.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    /// Move the fee sink. Admin only.
    pub fn set_treasury(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.config.treasury = ctx.accounts.treasury.key();
        Ok(())
    }

    /// Atomic sale for a quoted total: buyer -> seller (net) + buyer ->
    /// treasury (fee). The fee is recomputed HERE from the price argument
    /// — a client cannot smuggle a different split past this instruction.
    /// `vault_ref` is opaque linkage (sha256 of the off-chain card id,
    /// computed by the TS SDK) so indexers can join chain events to vault
    /// inventory without PII on-chain.
    pub fn buy(ctx: Context<Buy>, price: u64, vault_ref: [u8; 32]) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, SettleError::Paused);

        require!(price > 0, SettleError::InvalidPrice);
        require!(
            price <= MAX_PRICE_BASE_UNITS,
            SettleError::OverTradeCap
        );

        let fee = price
            .checked_mul(FEE_BPS)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(SettleError::MathOverflow)?;
        let net = price
            .checked_sub(fee)
            .ok_or(SettleError::MathOverflow)?;

        // Buyer -> seller (net).
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_ata.to_account_info(),
                    to: ctx.accounts.seller_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            net,
        )?;
        // Buyer -> treasury (fee).
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_ata.to_account_info(),
                    to: ctx.accounts.treasury_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            fee,
        )?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub paused: bool,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 32 + 1,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: stored as the fee sink; validated as a USDC account in Buy.
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump,
        has_one = admin @ SettleError::NotAdmin
    )]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
    /// CHECK: new fee sink; validated as a USDC account on first Buy.
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    pub buyer: Signer<'info>,
    /// CHECK: net recipient. Constrained below via seller_ata.owner, and
    /// the backend quote binds the ONLY seller wallet the ledger will
    /// settle for — a mismatched destination settles nothing off-chain.
    pub seller: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = buyer_ata.owner == buyer.key() @ SettleError::WrongTokenOwner,
        constraint = buyer_ata.mint == config_mint() @ SettleError::WrongMint
    )]
    pub buyer_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = seller_ata.owner == seller.key() @ SettleError::WrongTokenOwner,
        constraint = seller_ata.mint == config_mint() @ SettleError::WrongMint
    )]
    pub seller_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = treasury_ata.owner == config.treasury @ SettleError::WrongTokenOwner,
        constraint = treasury_ata.mint == config_mint() @ SettleError::WrongMint
    )]
    pub treasury_ata: Account<'info, TokenAccount>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub token_program: Program<'info, Token>,
}

/// USDC mint, single place. Devnet default below; mainnet
/// EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v is set at deploy via the
/// USDC_MINT env consumed by the TS client + settle verifier — the program
/// itself is redeployed per cluster with this constant updated.
#[cfg(feature = "mainnet")]
pub fn config_mint() -> Pubkey {
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        .parse()
        .unwrap()
}

#[cfg(not(feature = "mainnet"))]
pub fn config_mint() -> Pubkey {
    "4zMMC9srt5Ri5X14GAgXhaHii3L6VUHdfBMqBGE3ter"
        .parse()
        .unwrap()
}

#[error_code]
pub enum SettleError {
    #[msg("price must be positive")]
    InvalidPrice,
    #[msg("price exceeds the pre-audit per-trade cap")]
    OverTradeCap,
    #[msg("marketplace is paused")]
    Paused,
    #[msg("caller is not the admin")]
    NotAdmin,
    #[msg("token account owner mismatch")]
    WrongTokenOwner,
    #[msg("token account is not USDC")]
    WrongMint,
    #[msg("fee arithmetic overflowed")]
    MathOverflow,
}
