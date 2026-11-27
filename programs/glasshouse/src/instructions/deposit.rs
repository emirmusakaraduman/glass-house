//! deposit: yatırımcı USDC'yi vault'a yatırır, pay alır.
//! Pay sayısı nav.rs'den; NAV içsel sayaçlardan (vault bakiyesinden değil).
//! Giriş ücreti havuzda kalır (idle_cash'e girer, mevcut payların değerini artırır).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::GlassError;
use crate::events::Deposited;
use crate::nav::{assert_vault_covers_idle, deposit_quote, pool_senior_nav};
use crate::state::*;

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        constraint = depositor_usdc.mint == pool.usdc_mint @ GlassError::Unauthorized,
        constraint = depositor_usdc.owner == depositor.key() @ GlassError::Unauthorized
    )]
    pub depositor_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [SHARES_SEED, pool.key().as_ref()],
        bump = pool.share_mint_bump,
        mint::authority = pool
    )]
    pub share_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = depositor_shares.mint == share_mint.key() @ GlassError::Unauthorized,
        constraint = depositor_shares.owner == depositor.key() @ GlassError::Unauthorized
    )]
    pub depositor_shares: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn deposit_handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, GlassError::ZeroAmount);
    require!(
        ctx.accounts.pool.status == PoolStatus::Active,
        GlassError::InvalidStatus
    );
    // Allowlist için yer (stretch): ALLOWLIST_ENABLED kapalı; açılırsa burada
    // depositor'ın izinli olduğu doğrulanır.
    debug_assert!(!ALLOWLIST_ENABLED);

    // NAV ve pay, yatırımdan ÖNCEKİ sayaçlarla hesaplanır.
    let pool = &ctx.accounts.pool;
    let nav = pool_senior_nav(pool)?;
    let (fee, shares) = deposit_quote(amount, pool.entry_exit_fee_bps, pool.total_shares, nav)?;
    // Ücret sonrası payı 0'a yuvarlanan yatırım reddedilir (para karşılıksız kalmasın).
    require!(shares > 0, GlassError::ZeroAmount);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.depositor_usdc.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount,
    )?;

    let pool_id_bytes = ctx.accounts.pool.pool_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        POOL_SEED,
        ctx.accounts.pool.admin.as_ref(),
        &pool_id_bytes,
        &[ctx.accounts.pool.bump],
    ]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.depositor_shares.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer_seeds,
        ),
        shares,
    )?;

    let pool = &mut ctx.accounts.pool;
    pool.idle_cash = pool
        .idle_cash
        .checked_add(amount)
        .ok_or(GlassError::MathOverflow)?;
    pool.total_shares = pool
        .total_shares
        .checked_add(shares)
        .ok_or(GlassError::MathOverflow)?;

    // invariant'lar: vault ≥ idle_cash; pay arzı ≤ sayaç. (Eşitlik DEĞİL: pay sahibi
    // kendi paylarını SPL burn ile yakabilir; eşitlik kontrolü bunu deposit DoS'una çevirirdi.)
    ctx.accounts.vault.reload()?;
    ctx.accounts.share_mint.reload()?;
    assert_vault_covers_idle(ctx.accounts.vault.amount, ctx.accounts.pool.idle_cash)?;
    require!(
        ctx.accounts.share_mint.supply <= ctx.accounts.pool.total_shares,
        GlassError::InvariantViolation
    );

    emit!(Deposited {
        pool: ctx.accounts.pool.key(),
        depositor: ctx.accounts.depositor.key(),
        amount,
        fee,
        shares_minted: shares,
        total_shares: ctx.accounts.pool.total_shares,
        senior_nav: pool_senior_nav(&ctx.accounts.pool)?,
    });
    Ok(())
}
