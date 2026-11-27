//! request_withdraw — SAHİBİ: Kişi 2.
//! Çekim talebi WithdrawRequest PDA'sında açılır (["wreq", pool, pool.withdraw_tail]);
//! `shares` kadar pay sahibinin hesabından havuzun `share_escrow`'una kilitlenir.
//! withdraw_tail 1 artar. Ödeme process_withdrawals'ta, işlem anındaki NAV ile yapılır
//! (talep anındaki fiyat sabitlenmez: gecikme/zarar sonradan da paya yansır).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::GlassError;
use crate::lifecycle::events::WithdrawRequested;
use crate::lifecycle::state::{seeds as lseeds, WithdrawRequest};
use crate::state::Pool;

#[derive(Accounts)]
pub struct RequestWithdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(seeds = [SHARES_SEED, pool.key().as_ref()], bump = pool.share_mint_bump)]
    pub share_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        token::mint = share_mint,
        token::authority = owner,
    )]
    pub owner_shares: Box<Account<'info, TokenAccount>>,

    /// Ödemenin gideceği USDC hesabı; talepte sabitlenir.
    #[account(token::mint = pool.usdc_mint)]
    pub destination: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = owner,
        seeds = [lseeds::SHARE_ESCROW, pool.key().as_ref()],
        bump,
        token::mint = share_mint,
        token::authority = pool,
    )]
    pub share_escrow: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = owner,
        space = 8 + WithdrawRequest::INIT_SPACE,
        seeds = [WITHDRAW_REQUEST_SEED, pool.key().as_ref(), &pool.withdraw_tail.to_le_bytes()],
        bump,
    )]
    pub withdraw_request: Box<Account<'info, WithdrawRequest>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn request_withdraw_handler(ctx: Context<RequestWithdraw>, shares: u64) -> Result<()> {
    require!(shares > 0, GlassError::ZeroAmount);

    // Paylar sahibinden havuzun share_escrow'una (sahip imzalı).
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.owner_shares.to_account_info(),
                to: ctx.accounts.share_escrow.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        shares,
    )?;

    let pool_key = ctx.accounts.pool.key();
    let seq = ctx.accounts.pool.withdraw_tail;
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.withdraw_request.set_inner(WithdrawRequest {
        pool: pool_key,
        owner: ctx.accounts.owner.key(),
        destination: ctx.accounts.destination.key(),
        seq,
        shares,
        created_at: now,
        bump: ctx.bumps.withdraw_request,
    });

    let pool = &mut ctx.accounts.pool;
    pool.withdraw_tail = seq.checked_add(1).ok_or(GlassError::MathOverflow)?;

    // Pay arzı değişmez (yalnızca yer değiştirdi); kural yine de kontrol edilir.
    require!(
        ctx.accounts.share_mint.supply <= ctx.accounts.pool.total_shares,
        GlassError::InvariantViolation
    );

    emit!(WithdrawRequested {
        pool: pool_key,
        request: ctx.accounts.withdraw_request.key(),
        owner: ctx.accounts.owner.key(),
        seq,
        shares,
    });
    Ok(())
}
