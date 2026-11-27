//! confirm_title: yalnızca title_agent, deadline'dan ÖNCE. LoanEscrow'daki fiyat satıcıya,
//! açılış ücretinin yarısı Reserve'e, yarısı platform hazinesine gider. `reserve_pending`
//! sayacı `reserve_balance`'a aktarılır (karar 1). Funded → Active.
//!
//! cancel_funding: deadline geçmişse HERKES çağırabilir. Fonlanan anapara vault'a döner,
//! peşinat + ücret + teminat alıcıya iade edilir, `reserve_pending` düşer. Funded → Cancelled.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::GlassError;
use crate::events::{FundingCancelled, TitleConfirmed};
use crate::math;
use crate::nav::{assert_escrow_covers, assert_vault_covers_idle};
use crate::state::*;

// ------------------------------------------------------------------ confirm_title

#[derive(Accounts)]
pub struct ConfirmTitle<'info> {
    pub title_agent: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump,
        has_one = title_agent @ GlassError::Unauthorized
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [LOAN_SEED, pool.key().as_ref(), &loan.id.to_le_bytes()],
        bump = loan.bump,
        constraint = loan.pool == pool.key() @ GlassError::Unauthorized
    )]
    pub loan: Box<Account<'info, Loan>>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, loan.key().as_ref()],
        bump = loan.escrow_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool
    )]
    pub loan_escrow: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = seller_usdc.mint == pool.usdc_mint @ GlassError::Unauthorized,
        constraint = seller_usdc.owner == loan.seller @ GlassError::Unauthorized
    )]
    pub seller_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [RESERVE_SEED, pool.key().as_ref()],
        bump = pool.reserve_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool
    )]
    pub reserve_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        address = pool.platform_treasury @ GlassError::Unauthorized,
        token::mint = pool.usdc_mint
    )]
    pub platform_treasury: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn confirm_title_handler(ctx: Context<ConfirmTitle>) -> Result<()> {
    require!(
        ctx.accounts.loan.status == LoanStatus::Funded,
        GlassError::InvalidStatus
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now < ctx.accounts.loan.title_deadline,
        GlassError::TitleDeadlinePassed
    );

    let price = ctx.accounts.loan.price;
    let fee = math::origination_fee(ctx.accounts.loan.principal)?;
    let reserve_share = fee / 2;
    let platform_share = fee - reserve_share;
    // Funded escrow ≥ fiyat + ücret (bağış fazlalık olabilir); yalnızca bu tutar çıkar.
    let payout = price.checked_add(fee).ok_or(GlassError::MathOverflow)?;
    let escrow_before = ctx.accounts.loan_escrow.amount;
    assert_escrow_covers(escrow_before, payout)?;

    let pool_id_bytes = ctx.accounts.pool.pool_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        POOL_SEED,
        ctx.accounts.pool.admin.as_ref(),
        &pool_id_bytes,
        &[ctx.accounts.pool.bump],
    ]];
    for (to, amount) in [
        (ctx.accounts.seller_usdc.to_account_info(), price),
        (ctx.accounts.reserve_vault.to_account_info(), reserve_share),
        (ctx.accounts.platform_treasury.to_account_info(), platform_share),
    ] {
        if amount == 0 {
            continue;
        }
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.loan_escrow.to_account_info(),
                    to,
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;
    }

    let pool = &mut ctx.accounts.pool;
    pool.reserve_pending = pool
        .reserve_pending
        .checked_sub(reserve_share)
        .ok_or(GlassError::InvariantViolation)?;
    pool.reserve_balance = pool
        .reserve_balance
        .checked_add(reserve_share)
        .ok_or(GlassError::MathOverflow)?;

    let next_due = now
        .checked_add(pool.period_seconds)
        .ok_or(GlassError::MathOverflow)?;
    let loan = &mut ctx.accounts.loan;
    loan.status = LoanStatus::Active;
    loan.next_due = next_due;

    // invariant'lar: escrow'dan tam olarak ödenen tutar çıktı (fazlalık kalır);
    // Reserve token'ı ≥ reserve_balance.
    ctx.accounts.loan_escrow.reload()?;
    ctx.accounts.reserve_vault.reload()?;
    require!(
        ctx.accounts.loan_escrow.amount == escrow_before - payout,
        GlassError::InvariantViolation
    );
    require!(
        ctx.accounts.reserve_vault.amount >= ctx.accounts.pool.reserve_balance,
        GlassError::InvariantViolation
    );

    emit!(TitleConfirmed {
        pool: ctx.accounts.pool.key(),
        loan: ctx.accounts.loan.key(),
        loan_id: ctx.accounts.loan.id,
        paid_to_seller: price,
        reserve_balance: ctx.accounts.pool.reserve_balance,
        next_due,
    });
    Ok(())
}

// ------------------------------------------------------------------ cancel_funding

#[derive(Accounts)]
pub struct CancelFunding<'info> {
    /// Herkes çağırabilir; yalnızca tx ücretini öder.
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [LOAN_SEED, pool.key().as_ref(), &loan.id.to_le_bytes()],
        bump = loan.bump,
        constraint = loan.pool == pool.key() @ GlassError::Unauthorized
    )]
    pub loan: Box<Account<'info, Loan>>,

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
        seeds = [ESCROW_SEED, loan.key().as_ref()],
        bump = loan.escrow_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool
    )]
    pub loan_escrow: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [COLLATERAL_SEED, loan.key().as_ref()],
        bump = loan.collateral_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool
    )]
    pub collateral_escrow: Box<Account<'info, TokenAccount>>,

    /// Kapatılan token hesaplarının rent'i buraya döner.
    /// CHECK: adres `loan.borrower` ile sabitlenir; yalnızca lamport alır.
    #[account(mut, address = loan.borrower @ GlassError::Unauthorized)]
    pub borrower: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = borrower_usdc.mint == pool.usdc_mint @ GlassError::Unauthorized,
        constraint = borrower_usdc.owner == loan.borrower @ GlassError::Unauthorized
    )]
    pub borrower_usdc: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn cancel_funding_handler(ctx: Context<CancelFunding>) -> Result<()> {
    require!(
        ctx.accounts.loan.status == LoanStatus::Funded,
        GlassError::InvalidStatus
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ctx.accounts.loan.title_deadline,
        GlassError::TitleDeadlineNotReached
    );

    let principal = ctx.accounts.loan.principal;
    let fee = math::origination_fee(principal)?;
    let reserve_share = fee / 2;

    let escrow_amount = ctx.accounts.loan_escrow.amount;
    let collateral_amount = ctx.accounts.collateral_escrow.amount;
    assert_escrow_covers(
        escrow_amount,
        ctx.accounts
            .loan
            .price
            .checked_add(fee)
            .ok_or(GlassError::MathOverflow)?,
    )?;
    // peşinat + ücret borçluya, anapara vault'a.
    let to_borrower = escrow_amount
        .checked_sub(principal)
        .ok_or(GlassError::InvariantViolation)?;

    let pool_id_bytes = ctx.accounts.pool.pool_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        POOL_SEED,
        ctx.accounts.pool.admin.as_ref(),
        &pool_id_bytes,
        &[ctx.accounts.pool.bump],
    ]];

    let transfers = [
        (
            ctx.accounts.loan_escrow.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            principal,
        ),
        (
            ctx.accounts.loan_escrow.to_account_info(),
            ctx.accounts.borrower_usdc.to_account_info(),
            to_borrower,
        ),
        (
            ctx.accounts.collateral_escrow.to_account_info(),
            ctx.accounts.borrower_usdc.to_account_info(),
            collateral_amount,
        ),
    ];
    for (from, to, amount) in transfers {
        if amount == 0 {
            continue;
        }
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from,
                    to,
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;
    }
    for account in [
        ctx.accounts.loan_escrow.to_account_info(),
        ctx.accounts.collateral_escrow.to_account_info(),
    ] {
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account,
                destination: ctx.accounts.borrower.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer_seeds,
        ))?;
    }

    let pool = &mut ctx.accounts.pool;
    pool.idle_cash = pool
        .idle_cash
        .checked_add(principal)
        .ok_or(GlassError::MathOverflow)?;
    pool.total_outstanding = pool
        .total_outstanding
        .checked_sub(principal)
        .ok_or(GlassError::InvariantViolation)?;
    pool.reserve_pending = pool
        .reserve_pending
        .checked_sub(reserve_share)
        .ok_or(GlassError::InvariantViolation)?;

    ctx.accounts.loan.status = LoanStatus::Cancelled;

    ctx.accounts.vault.reload()?;
    assert_vault_covers_idle(ctx.accounts.vault.amount, ctx.accounts.pool.idle_cash)?;

    emit!(FundingCancelled {
        pool: ctx.accounts.pool.key(),
        loan: ctx.accounts.loan.key(),
        loan_id: ctx.accounts.loan.id,
        returned_to_vault: principal,
    });
    Ok(())
}
