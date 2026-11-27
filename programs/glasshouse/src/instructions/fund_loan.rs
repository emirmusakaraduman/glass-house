//! fund_loan: PERMISSIONLESS (karar 6). Tüm koşullar zincirde kontrol edilir ve para
//! yalnızca vault → LoanEscrow'a gider; çağıran yalnızca tx ücretini öder, yetkisi aranmaz.
//!
//! Koşullar: durum Approved; LTV (tekrar); likidite tamponu; gecikme freni; yedek fon freni
//! (yeni kredi hariç, karar 1); %5 ilk zarar kuralı. Ücretin yedek yarısı (`fee/2`)
//! `reserve_pending` sayacına yazılır; token hâlâ LoanEscrow'dadır (confirm_title taşır).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::GlassError;
use crate::events::LoanFunded;
use crate::instructions::approve_loan::check_ltv;
use crate::math;
use crate::nav::{assert_escrow_covers, assert_vault_covers_idle, loan_escrow_expected, pool_senior_nav};
use crate::state::*;

#[derive(Accounts)]
pub struct FundLoan<'info> {
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

    pub token_program: Program<'info, Token>,
}

/// a × 10000 ≥ b_bps × c, u128 ile (taşma yok).
fn ratio_ge(a: u64, b_bps: u16, c: u64) -> bool {
    (a as u128) * (BPS_DENOM as u128) >= (b_bps as u128) * (c as u128)
}

pub fn fund_loan_handler(ctx: Context<FundLoan>) -> Result<()> {
    let pool = &ctx.accounts.pool;
    let loan = &ctx.accounts.loan;

    require!(pool.status == PoolStatus::Active, GlassError::InvalidStatus);
    require!(loan.status == LoanStatus::Approved, GlassError::InvalidStatus);

    let principal = loan.principal;

    // 1) LTV, approve_loan'daki kontrolün tekrarı.
    check_ltv(loan, loan.appraised_value, pool.max_ltv_bps)?;

    // 2) Likidite tamponu: idle_cash − principal ≥ buffer_bps × senior_nav.
    let nav = pool_senior_nav(pool)?;
    let idle_after = pool
        .idle_cash
        .checked_sub(principal)
        .ok_or(GlassError::LiquidityBufferBreached)?;
    require!(
        ratio_ge(idle_after, pool.buffer_bps, nav),
        GlassError::LiquidityBufferBreached
    );

    // 3) Gecikme freni: late_default_principal × 10000 ≤ brake_late_bps × total_outstanding.
    if pool.total_outstanding > 0 {
        require!(
            (pool.late_default_principal as u128) * (BPS_DENOM as u128)
                <= (pool.brake_late_bps as u128) * (pool.total_outstanding as u128),
            GlassError::BrakeLateRatio
        );
    }

    // 4) Yedek fon freni (yeni kredi hariç): reserve_balance + reserve_pending ≥ brake × outstanding.
    let reserve_total = pool
        .reserve_balance
        .checked_add(pool.reserve_pending)
        .ok_or(GlassError::MathOverflow)?;
    require!(
        ratio_ge(reserve_total, pool.brake_reserve_bps, pool.total_outstanding),
        GlassError::BrakeReserve
    );

    // 5) İlk zarar kuralı: first_loss_balance ≥ min_first_loss_bps × (outstanding + principal).
    let outstanding_after = pool
        .total_outstanding
        .checked_add(principal)
        .ok_or(GlassError::MathOverflow)?;
    require!(
        ratio_ge(
            pool.first_loss_balance,
            pool.min_first_loss_bps,
            outstanding_after
        ),
        GlassError::InsufficientFirstLoss
    );

    // Etkiler.
    let fee_half = math::origination_fee(principal)? / 2;
    let now = Clock::get()?.unix_timestamp;
    let title_deadline = now
        .checked_add(pool.title_timeout_seconds)
        .ok_or(GlassError::MathOverflow)?;

    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        POOL_SEED,
        pool.admin.as_ref(),
        &pool_id_bytes,
        &[pool.bump],
    ]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.loan_escrow.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            signer_seeds,
        ),
        principal,
    )?;

    let pool = &mut ctx.accounts.pool;
    pool.idle_cash = idle_after;
    pool.total_outstanding = outstanding_after;
    pool.reserve_pending = pool
        .reserve_pending
        .checked_add(fee_half)
        .ok_or(GlassError::MathOverflow)?;

    let loan = &mut ctx.accounts.loan;
    loan.status = LoanStatus::Funded;
    loan.funded_at = now;
    loan.title_deadline = title_deadline;

    // invariant'lar: vault ≥ idle_cash; escrow ≥ fiyat + ücret (bağış fazlalık olabilir).
    ctx.accounts.vault.reload()?;
    ctx.accounts.loan_escrow.reload()?;
    assert_vault_covers_idle(ctx.accounts.vault.amount, ctx.accounts.pool.idle_cash)?;
    assert_escrow_covers(
        ctx.accounts.loan_escrow.amount,
        loan_escrow_expected(
            LoanStatus::Funded,
            ctx.accounts.loan.price,
            ctx.accounts.loan.principal,
        )?,
    )?;

    emit!(LoanFunded {
        pool: ctx.accounts.pool.key(),
        loan: ctx.accounts.loan.key(),
        loan_id: ctx.accounts.loan.id,
        principal,
        title_deadline,
        idle_cash: ctx.accounts.pool.idle_cash,
        total_outstanding: ctx.accounts.pool.total_outstanding,
        reserve_pending: ctx.accounts.pool.reserve_pending,
    });
    Ok(())
}
