//! payoff — SAHİBİ: Kişi 2. Yalnızca borçlu (has_one).
//!
//! İki iş yapar:
//! 1. Cezasız erken kapama (yalnızca Active): tutar program içinde hesaplanır =
//!    birikmiş gecikme bedeli + kalan anapara + bir dönem faizi (`math::final_installment`).
//!    Bölüşüm `repay` ile aynı (faizin platform/yedek payı ayrılır). Kredi PaidOff olur.
//!    Gecikmedeki (Late1/Late2) kredi önce `repay` ile Active'e dönmelidir; yoksa borçlu kaçırdığı
//!    dönemlerin faizini ödemeden kapatabilirdi.
//! 2. Teminat iadesi: PaidOff (repay'in son taksidi ya da 1. adım) veya Recovered (alacağı aşan
//!    teminat) kredide CollateralEscrow'un GERÇEK bakiyesi (bağış fazlalığı dahil) borçluya gider.
//!
//! Ödenecek ve iade edilecek bir şey yoksa `LoanNotServiceable`.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::GlassError;
use crate::lifecycle::events::LoanPaidOff;
use crate::lifecycle::provision::apply_provision_change;
use crate::lifecycle::state::loan_ext;
use crate::math;
use crate::nav::assert_vault_covers_idle;
use crate::state::{Loan, LoanStatus, Pool};

#[derive(Accounts)]
pub struct Payoff<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [LOAN_SEED, pool.key().as_ref(), &loan.id.to_le_bytes()],
        bump = loan.bump,
        has_one = pool @ GlassError::Unauthorized,
        has_one = borrower @ GlassError::Unauthorized,
    )]
    pub loan: Box<Account<'info, Loan>>,

    /// Ödemenin çıktığı ve teminatın iade edildiği hesap.
    #[account(
        mut,
        token::mint = pool.usdc_mint,
        token::authority = borrower,
    )]
    pub borrower_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [RESERVE_SEED, pool.key().as_ref()],
        bump = pool.reserve_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool,
    )]
    pub reserve: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        address = pool.platform_treasury @ GlassError::Unauthorized,
        token::mint = pool.usdc_mint,
    )]
    pub platform_treasury: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [COLLATERAL_SEED, loan.key().as_ref()],
        bump = loan.collateral_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool,
    )]
    pub collateral: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn payoff_handler(ctx: Context<Payoff>) -> Result<()> {
    let status = ctx.accounts.loan.status;
    require!(
        matches!(status, LoanStatus::Active | LoanStatus::PaidOff | LoanStatus::Recovered),
        GlassError::LoanNotServiceable
    );

    // ---- 1. erken kapama (yalnızca Active) ----
    let mut paid: u64 = 0;
    if status == LoanStatus::Active {
        let loan = &ctx.accounts.loan;
        let remaining = loan.remaining_principal;
        let late_fee = loan.late_fee_accrued;
        let rate = loan.rate_bps;
        let interest = math::interest_for_period(remaining, rate)?;
        paid = late_fee
            .checked_add(math::final_installment(remaining, rate)?)
            .ok_or(GlassError::MathOverflow)?;
        let (pool_interest, platform_share, reserve_share) = math::split_interest(interest, rate)?;
        let to_vault = late_fee
            .checked_add(pool_interest)
            .and_then(|x| x.checked_add(remaining))
            .ok_or(GlassError::MathOverflow)?;

        for (to, value) in [
            (ctx.accounts.vault.to_account_info(), to_vault),
            (ctx.accounts.reserve.to_account_info(), reserve_share),
            (ctx.accounts.platform_treasury.to_account_info(), platform_share),
        ] {
            if value == 0 {
                continue;
            }
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.borrower_usdc.to_account_info(),
                        to,
                        authority: ctx.accounts.borrower.to_account_info(),
                    },
                ),
                value,
            )?;
        }

        let pool = &mut ctx.accounts.pool;
        let loan = &mut ctx.accounts.loan;
        pool.idle_cash = pool.idle_cash.checked_add(to_vault).ok_or(GlassError::MathOverflow)?;
        pool.reserve_balance = pool
            .reserve_balance
            .checked_add(reserve_share)
            .ok_or(GlassError::MathOverflow)?;
        pool.total_outstanding = pool
            .total_outstanding
            .checked_sub(remaining)
            .ok_or(GlassError::InvariantViolation)?;
        let (pool_total, _) = apply_provision_change(pool.loss_provision, loan.provision_amount, 0)?;
        pool.loss_provision = pool_total;

        loan.remaining_principal = 0;
        loan.late_fee_accrued = 0;
        loan.provision_amount = 0;
        loan.paid_installments = loan.paid_installments.saturating_add(1);
        loan.last_processed_period = 0;
        loan.missed_installments = 0;
        loan_ext::set_interest_settled(loan, 0);
        loan.status = LoanStatus::PaidOff;
    }

    // ---- 2. teminat iadesi: gerçek bakiye (fazlalık dahil) ----
    let collateral_returned = ctx.accounts.collateral.amount;
    require!(paid > 0 || collateral_returned > 0, GlassError::LoanNotServiceable);
    if collateral_returned > 0 {
        let pool = &ctx.accounts.pool;
        let pool_id_bytes = pool.pool_id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[POOL_SEED, pool.admin.as_ref(), &pool_id_bytes, &[pool.bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.collateral.to_account_info(),
                    to: ctx.accounts.borrower_usdc.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer_seeds,
            ),
            collateral_returned,
        )?;
    }

    // ---- invariant'lar ----
    ctx.accounts.vault.reload()?;
    ctx.accounts.reserve.reload()?;
    ctx.accounts.collateral.reload()?;
    assert_vault_covers_idle(ctx.accounts.vault.amount, ctx.accounts.pool.idle_cash)?;
    require!(
        ctx.accounts.reserve.amount >= ctx.accounts.pool.reserve_balance,
        GlassError::InvariantViolation
    );
    require!(ctx.accounts.collateral.amount == 0, GlassError::InvariantViolation);

    emit!(LoanPaidOff {
        pool: ctx.accounts.pool.key(),
        loan: ctx.accounts.loan.key(),
        loan_id: ctx.accounts.loan.id,
        amount: paid,
        collateral_returned,
    });
    Ok(())
}
