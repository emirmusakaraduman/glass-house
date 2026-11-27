//! crank_loan — SAHİBİ: Kişi 2. İzinsiz (herkes çağırabilir; demoda "yabancı" cüzdan).
//!
//! Durum sayaç artırarak değil zamandan türetilir:
//!   kaçırılan = (şimdi − next_due − grace) / period + 1   (grace içindeyse 0)
//! `last_processed_period` = en son işlenen adım (0..=3). Bu çağrı yalnızca
//! (last_processed_period, min(kaçırılan, 3)] adımlarını uygular; yeni adım yoksa
//! `PeriodAlreadyProcessed` ile reddedilir (aynı dönem iki kez işlenmez).
//!
//! Adımlar:
//!   1 → Late1:     gecikme bedeli (taksidin %2'si) late_fee_accrued'a eklenir.
//!   2 → Late2:     bir taksit CollateralEscrow'dan kesilir ve ödeme gibi uygulanır
//!                  (gecikme bedeli → faiz → anapara; faizin platform/yedek payı ayrılır).
//!   3 → Defaulted: karşılık max(provision_bps[3] × kalan; kalan + faiz − teminat − k × değer).
//! Her çağrının sonunda kredinin karşılığı hedefe çekilir ve fark pool.loss_provision'a yazılır;
//! gecikmedeki anapara pool.late_default_principal'da izlenir (fund_loan freni bunu okur).
//!
//! Kredi tekrar Active'e dönerse (repay), repay `last_processed_period`'ı sıfırlar ve
//! `next_due`'yu ileri alır; crank buna dokunmaz.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::GlassError;
use crate::lifecycle::events::LoanCranked;
use crate::lifecycle::provision::{apply_provision_change, target_provision, DefaultInputs};
use crate::lifecycle::schedule::{
    late_fee, missed_installments, pending_steps, status_for_missed, unpaid_accrued_interest,
};
use crate::lifecycle::state::loan_ext;
use crate::math;
use crate::nav::{assert_escrow_covers, assert_vault_covers_idle};
use crate::state::{Loan, LoanStatus, Pool};

#[derive(Accounts)]
pub struct CrankLoan<'info> {
    /// Herkes çağırabilir; yalnızca tx ücretini öder.
    pub cranker: Signer<'info>,

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
    )]
    pub loan: Box<Account<'info, Loan>>,

    #[account(
        mut,
        seeds = [COLLATERAL_SEED, loan.key().as_ref()],
        bump = loan.collateral_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool,
    )]
    pub collateral: Box<Account<'info, TokenAccount>>,

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

    pub token_program: Program<'info, Token>,
}

/// CollateralEscrow'da bulunması gereken teminat: 3 taksit − şimdiye kadar kesilen.
/// Bakiyeden değil sayaçlardan türetilir (bağış fazlalığı sayılmaz).
pub fn expected_collateral(loan: &Loan) -> Result<u64> {
    math::collateral_amount(loan.installment)?
        .checked_sub(loan_ext::collateral_deducted(loan))
        .ok_or_else(|| error!(GlassError::InvariantViolation))
}

fn is_late(status: LoanStatus) -> bool {
    matches!(status, LoanStatus::Late1 | LoanStatus::Late2 | LoanStatus::Defaulted)
}

pub fn crank_loan_handler(mut ctx: Context<CrankLoan>) -> Result<()> {
    let old_status = ctx.accounts.loan.status;
    require!(
        matches!(old_status, LoanStatus::Active | LoanStatus::Late1 | LoanStatus::Late2),
        GlassError::LoanNotServiceable
    );

    let now = Clock::get()?.unix_timestamp;
    let (grace, period) = (ctx.accounts.pool.grace_seconds, ctx.accounts.pool.period_seconds);
    let missed = missed_installments(now, ctx.accounts.loan.next_due, grace, period)?;
    let steps = pending_steps(ctx.accounts.loan.last_processed_period, missed);
    require!(!steps.is_empty(), GlassError::PeriodAlreadyProcessed);
    let last_step = *steps.end();

    let collateral_before = ctx.accounts.collateral.amount;
    assert_escrow_covers(collateral_before, expected_collateral(&ctx.accounts.loan)?)?;

    let old_remaining = ctx.accounts.loan.remaining_principal;
    let mut collateral_used: u64 = 0;

    for step in steps {
        match step {
            1 => {
                let fee = late_fee(ctx.accounts.loan.installment)?;
                let loan = &mut ctx.accounts.loan;
                loan.late_fee_accrued = loan
                    .late_fee_accrued
                    .checked_add(fee)
                    .ok_or(GlassError::MathOverflow)?;
            }
            2 => {
                let used = deduct_installment_from_collateral(&mut ctx)?;
                collateral_used = collateral_used.checked_add(used).ok_or(GlassError::MathOverflow)?;
            }
            _ => { /* 3: Defaulted — yalnızca durum ve karşılık */ }
        }
    }

    // ---- durum, sayaçlar ----
    let new_status = status_for_missed(last_step);
    let pool = &mut ctx.accounts.pool;
    let loan = &mut ctx.accounts.loan;
    loan.status = new_status;
    loan.missed_installments = u16::try_from(missed).unwrap_or(u16::MAX);
    loan.last_processed_period = last_step;

    // Gecikmedeki anapara: eski katkı çıkar, yeni katkı girer.
    let before = if is_late(old_status) { old_remaining } else { 0 };
    let after = if is_late(new_status) { loan.remaining_principal } else { 0 };
    pool.late_default_principal = pool
        .late_default_principal
        .checked_sub(before)
        .ok_or(GlassError::InvariantViolation)?
        .checked_add(after)
        .ok_or(GlassError::MathOverflow)?;

    // ---- karşılık ----
    let remaining_collateral = collateral_before
        .checked_sub(collateral_used)
        .ok_or(GlassError::InvariantViolation)?
        .min(expected_collateral(loan)?);
    let accrued_interest = unpaid_accrued_interest(
        math::interest_for_period(loan.remaining_principal, loan.rate_bps)?,
        missed.min(3),
        loan_ext::interest_settled(loan),
    )?;
    let target = target_provision(
        new_status,
        loan.remaining_principal,
        &pool.provision_bps,
        DefaultInputs {
            accrued_interest,
            collateral: remaining_collateral,
            value: loan.price.min(loan.appraised_value),
            recovery_coeff_bps: pool.recovery_coeff_bps,
        },
    )?;
    let (pool_total, delta) = apply_provision_change(pool.loss_provision, loan.provision_amount, target)?;
    pool.loss_provision = pool_total;
    loan.provision_amount = target;

    // ---- invariant'lar ----
    ctx.accounts.vault.reload()?;
    ctx.accounts.reserve.reload()?;
    ctx.accounts.collateral.reload()?;
    assert_vault_covers_idle(ctx.accounts.vault.amount, ctx.accounts.pool.idle_cash)?;
    require!(
        ctx.accounts.reserve.amount >= ctx.accounts.pool.reserve_balance,
        GlassError::InvariantViolation
    );
    assert_escrow_covers(ctx.accounts.collateral.amount, expected_collateral(&ctx.accounts.loan)?)?;

    emit!(LoanCranked {
        pool: ctx.accounts.pool.key(),
        loan: ctx.accounts.loan.key(),
        loan_id: ctx.accounts.loan.id,
        cranker: ctx.accounts.cranker.key(),
        old_status: old_status as u8,
        new_status: new_status as u8,
        missed_installments: ctx.accounts.loan.missed_installments,
        collateral_used,
        provision_amount: target,
        provision_delta: delta,
    });
    Ok(())
}

/// Late2 adımı: bir taksit teminattan kesilir ve borca uygulanır
/// (gecikme bedeli → faiz → anapara). Dönüş: teminattan çıkan tutar.
fn deduct_installment_from_collateral(ctx: &mut Context<CrankLoan>) -> Result<u64> {
    let loan = &ctx.accounts.loan;
    // Yalnızca beklenen teminattan kes; bağış fazlalığı borçluya aittir.
    let available = expected_collateral(loan)?.min(ctx.accounts.collateral.amount);
    let amount = loan.installment.min(available);
    if amount == 0 {
        return Ok(0);
    }
    let split = math::split_payment(amount, loan.remaining_principal, loan.rate_bps, loan.late_fee_accrued)?;
    let applied = amount - split.unapplied;
    let (pool_interest, platform_share, reserve_share) = math::split_interest(split.interest, loan.rate_bps)?;
    let to_vault = split
        .late_fee
        .checked_add(pool_interest)
        .and_then(|x| x.checked_add(split.principal))
        .ok_or(GlassError::MathOverflow)?;

    let pool_id_bytes = ctx.accounts.pool.pool_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        POOL_SEED,
        ctx.accounts.pool.admin.as_ref(),
        &pool_id_bytes,
        &[ctx.accounts.pool.bump],
    ]];
    for (to, value) in [
        (ctx.accounts.vault.to_account_info(), to_vault),
        (ctx.accounts.reserve.to_account_info(), reserve_share),
        (ctx.accounts.platform_treasury.to_account_info(), platform_share),
    ] {
        if value == 0 {
            continue;
        }
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.collateral.to_account_info(),
                    to,
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer_seeds,
            ),
            value,
        )?;
    }

    let pool = &mut ctx.accounts.pool;
    pool.idle_cash = pool.idle_cash.checked_add(to_vault).ok_or(GlassError::MathOverflow)?;
    pool.reserve_balance = pool
        .reserve_balance
        .checked_add(reserve_share)
        .ok_or(GlassError::MathOverflow)?;
    pool.total_outstanding = pool
        .total_outstanding
        .checked_sub(split.principal)
        .ok_or(GlassError::InvariantViolation)?;

    let loan = &mut ctx.accounts.loan;
    loan.late_fee_accrued -= split.late_fee;
    loan.remaining_principal -= split.principal;
    let deducted = loan_ext::collateral_deducted(loan)
        .checked_add(applied)
        .ok_or(GlassError::MathOverflow)?;
    loan_ext::set_collateral_deducted(loan, deducted);
    // Teminattan ödenen faiz: temerrütte birikmiş faizden düşülür (aynı ay iki kez sayılmasın).
    let settled = loan_ext::interest_settled(loan)
        .checked_add(split.interest)
        .ok_or(GlassError::MathOverflow)?;
    loan_ext::set_interest_settled(loan, settled);
    Ok(applied)
}
