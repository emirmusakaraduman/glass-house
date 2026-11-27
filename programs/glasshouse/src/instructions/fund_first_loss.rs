//! fund_first_loss: yalnızca admin (platform) ilk zarar kasasını doldurur.
//! USDC admin → FirstLossVault; first_loss_balance güncellenir.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::GlassError;
use crate::events::FirstLossFunded;
use crate::nav::assert_vault_covers_idle;
use crate::state::*;

#[derive(Accounts)]
pub struct FundFirstLoss<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ GlassError::Unauthorized,
        seeds = [POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        constraint = admin_token_account.mint == pool.usdc_mint @ GlassError::Unauthorized,
        constraint = admin_token_account.owner == admin.key() @ GlassError::Unauthorized
    )]
    pub admin_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [FIRST_LOSS_SEED, pool.key().as_ref()],
        bump = pool.first_loss_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool
    )]
    pub first_loss_vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn fund_first_loss_handler(ctx: Context<FundFirstLoss>, amount: u64) -> Result<()> {
    require!(amount > 0, GlassError::ZeroAmount);
    require!(
        ctx.accounts.pool.status == PoolStatus::Active,
        GlassError::InvalidStatus
    );

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.admin_token_account.to_account_info(),
                to: ctx.accounts.first_loss_vault.to_account_info(),
                authority: ctx.accounts.admin.to_account_info(),
            },
        ),
        amount,
    )?;

    let pool = &mut ctx.accounts.pool;
    pool.first_loss_balance = pool
        .first_loss_balance
        .checked_add(amount)
        .ok_or(GlassError::MathOverflow)?;

    // invariant: kasa bakiyesi sayacı karşılar (doğrudan bağış fazlalık yaratır, açık değil).
    ctx.accounts.first_loss_vault.reload()?;
    assert_vault_covers_idle(
        ctx.accounts.first_loss_vault.amount,
        ctx.accounts.pool.first_loss_balance,
    )?;

    emit!(FirstLossFunded {
        pool: ctx.accounts.pool.key(),
        amount,
        first_loss_balance: ctx.accounts.pool.first_loss_balance,
    });
    Ok(())
}
