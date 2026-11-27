//! repay — SAHİBİ: Kişi 2.
//! Taksit ödemesi. Herkes ödeyebilir (Blink "taksidini öde"); para `payer_usdc`'den çıkar.
//!
//! Kurallar:
//! - Ödeme sırası: gecikme bedeli → faiz (bir dönem) → anapara (`math::split_payment`).
//! - Tutar en fazla `late_fee_accrued + final_installment(kalan)` olabilir (kalan + o dönemin
//!   faizi + gecikme bedeli); fazlası `InvalidPaymentAmount`. Böylece kredi tam sıfırla kapanır.
//! - Bir çağrı en fazla BİR dönemi kapatır: gecikme bedeli tamamen ödenmiş ve faiz + anapara
//!   ≥ min(taksit, kalan + faiz) ise `paid_installments` +1, `next_due` += period. Daha küçük
//!   ödemeler borca uygulanır ama vade ilerlemez. Fazlası erken anapara ödemesidir.
//! - Faizin havuz payı vault'ta kalır, platform payı `platform_treasury`'ye, yedek fon payı
//!   `reserve`'e gider (`math::split_interest`).
//! - Gecikmedeki kredi (Late1/Late2) ödeme sonrası vadesi geçmiş taksidi kalmazsa Active'e döner:
//!   `last_processed_period` = 0, karşılık 0. Teminattan kesilen tutar `loan_ext` sayacında
//!   kalır (teminat yeniden doldurulmaz; stretch).
//! - Kalan anapara 0 olunca kredi PaidOff olur. Teminat iadesi borçlunun imzasıyla `payoff`'tadır.
//! - Defaulted krediye ödeme alınmaz (record_recovery'nin işi).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::GlassError;
use crate::lifecycle::events::LoanRepaid;
use crate::lifecycle::provision::{apply_provision_change, target_provision, DefaultInputs};
use crate::lifecycle::schedule::missed_installments;
use crate::math;
use crate::nav::assert_vault_covers_idle;
use crate::state::{Loan, LoanStatus, Pool};

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

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
        token::mint = pool.usdc_mint,
        token::authority = payer,
    )]
    pub payer_usdc: Box<Account<'info, TokenAccount>>,

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

fn is_late(status: LoanStatus) -> bool {
    matches!(status, LoanStatus::Late1 | LoanStatus::Late2 | LoanStatus::Defaulted)
}

/// `amount`: ödenen micro-USDC.
pub fn repay_handler(ctx: Context<Repay>, amount: u64) -> Result<()> {
    require!(amount > 0, GlassError::ZeroAmount);
    let old_status = ctx.accounts.loan.status;
    require!(
        matches!(old_status, LoanStatus::Active | LoanStatus::Late1 | LoanStatus::Late2),
        GlassError::LoanNotServiceable
    );

    let loan = &ctx.accounts.loan;
    let rate = loan.rate_bps;
    let remaining_before = loan.remaining_principal;
    let late_fee_due = loan.late_fee_accrued;

    // ---- tutar ----
    let max_due = late_fee_due
        .checked_add(math::final_installment(remaining_before, rate)?)
        .ok_or(GlassError::MathOverflow)?;
    require!(amount <= max_due, GlassError::InvalidPaymentAmount);

    let split = math::split_payment(amount, remaining_before, rate, late_fee_due)?;
    require!(split.unapplied == 0, GlassError::InvalidPaymentAmount);
    let (pool_interest, platform_share, reserve_share) = math::split_interest(split.interest, rate)?;
    let to_vault = split
        .late_fee
        .checked_add(pool_interest)
        .and_then(|x| x.checked_add(split.principal))
        .ok_or(GlassError::MathOverflow)?;

    // Bu ödeme bir dönemi kapatıyor mu?
    let interest_due = math::interest_for_period(remaining_before, rate)?;
    let period_due = loan
        .installment
        .min(remaining_before.checked_add(interest_due).ok_or(GlassError::MathOverflow)?);
    let covers_period = split.late_fee == late_fee_due
        && split.interest.checked_add(split.principal).ok_or(GlassError::MathOverflow)? >= period_due;

    // ---- transferler (payer imzalı) ----
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
                    from: ctx.accounts.payer_usdc.to_account_info(),
                    to,
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            value,
        )?;
    }

    // ---- sayaçlar ----
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool;
    let loan = &mut ctx.accounts.loan;

    pool.idle_cash = pool.idle_cash.checked_add(to_vault).ok_or(GlassError::MathOverflow)?;
    pool.reserve_balance = pool
        .reserve_balance
        .checked_add(reserve_share)
        .ok_or(GlassError::MathOverflow)?;
    pool.total_outstanding = pool
        .total_outstanding
        .checked_sub(split.principal)
        .ok_or(GlassError::InvariantViolation)?;

    loan.late_fee_accrued -= split.late_fee;
    loan.remaining_principal -= split.principal;

    if covers_period {
        loan.paid_installments = loan.paid_installments.saturating_add(1);
        loan.next_due = loan
            .next_due
            .checked_add(pool.period_seconds)
            .ok_or(GlassError::MathOverflow)?;
    }

    // ---- durum ----
    let missed_after = missed_installments(now, loan.next_due, pool.grace_seconds, pool.period_seconds)?;
    let new_status = if loan.remaining_principal == 0 {
        LoanStatus::PaidOff
    } else if is_late(old_status) && missed_after == 0 {
        LoanStatus::Active
    } else {
        old_status
    };
    // Gecikmeden çıkış ya da kapanış: crank adım sayacı sıfırlanır. Hâlâ gecikmedeyse
    // crank'in işlediği adım korunur (aynı adım tekrar işlenmez).
    let cured = is_late(old_status) && new_status == LoanStatus::Active;
    if cured || new_status == LoanStatus::PaidOff {
        loan.last_processed_period = 0;
        loan.missed_installments = 0;
    } else if is_late(new_status) {
        loan.missed_installments = u16::try_from(missed_after).unwrap_or(u16::MAX);
    }
    loan.status = new_status;

    // Gecikmedeki anapara: eski katkı çıkar, yeni katkı girer.
    let before = if is_late(old_status) { remaining_before } else { 0 };
    let after = if is_late(new_status) { loan.remaining_principal } else { 0 };
    pool.late_default_principal = pool
        .late_default_principal
        .checked_sub(before)
        .ok_or(GlassError::InvariantViolation)?
        .checked_add(after)
        .ok_or(GlassError::MathOverflow)?;

    // Karşılık: yeni durum ve kalan anapara üzerinden (Defaulted burada oluşmaz).
    let target = target_provision(new_status, loan.remaining_principal, &pool.provision_bps, DefaultInputs::default())?;
    let (pool_total, _) = apply_provision_change(pool.loss_provision, loan.provision_amount, target)?;
    pool.loss_provision = pool_total;
    loan.provision_amount = target;

    // ---- invariant'lar ----
    ctx.accounts.vault.reload()?;
    ctx.accounts.reserve.reload()?;
    assert_vault_covers_idle(ctx.accounts.vault.amount, ctx.accounts.pool.idle_cash)?;
    require!(
        ctx.accounts.reserve.amount >= ctx.accounts.pool.reserve_balance,
        GlassError::InvariantViolation
    );

    emit!(LoanRepaid {
        pool: ctx.accounts.pool.key(),
        loan: ctx.accounts.loan.key(),
        loan_id: ctx.accounts.loan.id,
        amount,
        late_fee: split.late_fee,
        interest: split.interest,
        principal: split.principal,
        remaining_principal: ctx.accounts.loan.remaining_principal,
        status: new_status as u8,
        next_due: ctx.accounts.loan.next_due,
    });
    Ok(())
}
