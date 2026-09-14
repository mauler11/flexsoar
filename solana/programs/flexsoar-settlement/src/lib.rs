//! flexsoar-settlement — non-custodial USDC settlement for FlexSoar cards.
//!
//! Design authority lives off-chain: the Postgres ledger remains the record
//! of WHO owns which card (Item != Card, append-only). This program moves
//! MONEY only — buyer USDC splits to seller + FlexSoar treasury atomically
//! inside `buy`. No escrow persists between instructions, so no balance of
//! user funds is ever held: there is nothing to license as e-money.
//!
//! Roles:
//!   - admin    — FlexSoar multisig. Initializes config, pauses/unpauses,
//!                is the program upgrade authority (set at deploy).
//!   - treasury — USDC account receiving the 8% fee. Set at initialize,
//!                changeable only by admin.
//!   - seller   — lists (owns a listing PDA), cancels, receives net.
//!   - buyer    — pays the quoted total; receives nothing on-chain (the
//!                card moves off-chain via /api/solana/settle after this
//!                transaction verifies).
//!
//! Money math (USDC = 6 decimals, all u64): fee = price * 800 / 10000
//! (integer division, dust < 1 base unit favours the seller), seller gets
//! price - fee. MAX_PRICE_USDC caps pre-audit launch volume per trade.
//!
//! BUILD NOTE: no Rust/Solana toolchain exists on the Windows build box
//! (checked 2026-09-14) and Anchor does not support native Windows builds.
//! Build + deploy on WSL2/Linux with the Solana CLI + Anchor 0.31.x:
//!   anchor build && anchor deploy --provider.cluster devnet
//! then record the program id in DEPS.md / Vercel env (SOLANA_PROGRAM_ID).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("FSxSettle1111111111111111111111111111111111");

/// 8% platform fee in basis points. Matches the off-chain flat fee.
pub const FEE_BPS: u64 = 800;
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

    /// Freeze new buys (cancels still work). Admin only.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    /// Move the fee sink. Admin only.
    pub fn set_treasury(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.config.treasury = ctx.accounts.treasury.key();
        Ok(())
    }

    /// Open a listing PDA for one card. Seller-signed. The off-chain
    /// backend gates the List button on ledger ownership first — this
    /// instruction trusts the signer, the PLATFORM trusts the ledger.
    pub fn list_card(ctx: Context<ListCard>, price: u64, vault_ref: [u8; 32]) -> Result<()> {
        require!(price > 0, SettleError::InvalidPrice);
        require!(
            price <= MAX_PRICE_BASE_UNITS,
            SettleError::OverTradeCap
        );
        let listing = &mut ctx.accounts.listing;
        listing.seller = ctx.accounts.seller.key();
        listing.price = price;
        listing.vault_ref = vault_ref;
        listing.bump = ctx.bumps.listing;
        Ok(())
    }

    /// Atomic sale: buyer -> seller (net) + buyer -> treasury (fee), then
    /// the listing PDA closes and its rent returns to the seller. The fee
    /// is recomputed HERE from the listing price — a client cannot smuggle
    /// a different split past this instruction.
    pub fn buy(ctx: Context<Buy>) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, SettleError::Paused);

        let price = ctx.accounts.listing.price;
        require!(price > 0, SettleError::InvalidPrice);

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
        // `close = seller` on the listing account (see Buy struct) returns
        // the rent automatically when this instruction succeeds.
    }

    /// Seller reclaims an unsold listing. Anyone may invoke; lamports go
    /// to the seller recorded in the PDA, never the caller.
    pub fn cancel(_ctx: Context<Cancel>) -> Result<()> {
        Ok(())
        // `close = seller` handles the reclaim.
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

#[account]
pub struct Listing {
    pub seller: Pubkey,
    pub price: u64,
    /// Opaque link to the off-chain card/item (e.g. sha256 of the card id).
    /// Lets indexers join chain events to vault inventory without PII.
    pub vault_ref: [u8; 32],
    pub bump: u8,
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
#[instruction(price: u64, vault_ref: [u8; 32])]
pub struct ListCard<'info> {
    #[account(
        init,
        payer = seller,
        space = 8 + 32 + 8 + 32 + 1,
        seeds = [b"listing", vault_ref.as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,
    #[account(mut)]
    pub seller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(
        mut,
        close = seller,
        seeds = [b"listing", listing.vault_ref.as_ref()],
        bump = listing.bump,
        has_one = seller @ SettleError::WrongSeller
    )]
    pub listing: Account<'info, Listing>,
    /// CHECK: receives rent + net; constrained by has_one on the listing.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    pub buyer: Signer<'info>,
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

/// USDC mint, passed as a constraint helper so the one address lives in a
/// single place. Devnet default below; mainnet
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

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(
        mut,
        close = seller,
        seeds = [b"listing", listing.vault_ref.as_ref()],
        bump = listing.bump,
        has_one = seller @ SettleError::NotSeller
    )]
    pub listing: Account<'info, Listing>,
    /// CHECK: rent destination; constrained by has_one on the listing.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
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
    #[msg("caller is not the listing seller")]
    NotSeller,
    #[msg("seller account mismatch")]
    WrongSeller,
    #[msg("token account owner mismatch")]
    WrongTokenOwner,
    #[msg("token account is not USDC")]
    WrongMint,
    #[msg("fee arithmetic overflowed")]
    MathOverflow,
}
