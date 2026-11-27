//! record_recovery — SAHİBİ: Kişi 2. Yetki: pool.recovery_agent (has_one).
//!
//! Temerrüde düşmüş (Defaulted) kredinin teminatı (ev/araç) satılınca çağrılır.
//!
//! 1. Alt sınır: gelir < min(fiyat, değer) × min_recovery_bps ise `co_signer` zorunludur ve
//!    `pool.admin` olmalıdır. co_signer verilirse her durumda admin olmalıdır.
//! 2. Alacak = kalan anapara + temerrütten bu yana biriken faiz (vadesi geçmiş dönem sayısı ×
//!    dönem faizi) + birikmiş gecikme bedeli.
//! 3. Zarar sırası (`lifecycle::waterfall`): teminat → satış geliri → (stake yok) →
//!    FirstLossVault → Reserve → senior. Her basamak GERÇEK token transferiyle vault'a girer;
//!    senior'un payı nakitsiz, total_outstanding düşerek yansır.
//! 4. Gelirin yalnızca alacağı karşılayan kısmı `recovery_source`'tan çekilir; fazlası
//!    ajanın hesabında kalır (zincir dışında borçluya iade edilir). Alacağı aşan teminat
//!    CollateralEscrow'da kalır; borçlu `payoff` ile alır.
//! 5. Kredi Defaulted → Recovered; kalan anapara, karşılık ve gecikme sayaçları kapanır.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::GlassError;
use crate::instructions::crank_loan::expected_collateral;
use crate::lifecycle::events::RecoveryRecorded;
use crate::lifecycle::provision::{apply_provision_change, bps_floor};
use crate::lifecycle::schedule::missed_installments;
use crate::lifecycle::state::loan_ext;
use crate::lifecycle::waterfall::{apply_waterfall, WaterfallInput};
use crate::math;
use crate::nav::{assert_escrow_covers, assert_vault_covers_idle};
use crate::state::{Loan, LoanStatus, Pool};

#[derive(Accounts)]
pub struct RecordRecovery<'info> {
    pub recovery_agent: Signer<'info>,

    /// Alt sınırın altındaki gelirlerde zorunlu ikinci imza (pool.admin). Gerekmezse verilmez.
    pub co_signer: Option<Signer<'info>>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump,
        has_one = recovery_agent @ GlassError::Unauthorized,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [LOAN_SEED, pool.key().as_ref(), &loan.id.to_le_bytes()],
        bump = loan.bump,
        has_one = pool @ GlassError::Unauthorized,
    )]
    pub loan: Box<Account<'info, Loan>>,

    /// Satış gelirinin çıktığı hesap (recovery_agent'ın USDC hesabı).
    #[account(
        mut,
        token::mint = pool.usdc_mint,
        token::authority = recovery_agent,
    )]
    pub recovery_source: Box<Account<'info, TokenAccount>>,

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
        seeds = [COLLATERAL_SEED, loan.key().as_ref()],
        bump = loan.collateral_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool,
    )]
    pub collateral: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [FIRST_LOSS_SEED, pool.key().as_ref()],
        bump = pool.first_loss_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool,
    )]
    pub first_loss: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [RESERVE_SEED, pool.key().as_ref()],
        bump = pool.reserve_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool,
    )]
    pub reserve: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

/// `proceeds`: satış/icra sonrası net gelir (micro-USDC). Alacağı aşan kısmı çekilmez.
pub fn record_recovery_handler(ctx: Context<RecordRecovery>, proceeds: u64) -> Result<()> {
    let pool = &ctx.accounts.pool;
    let loan = &ctx.accounts.loan;
    require!(loan.status == LoanStatus::Defaulted, GlassError::LoanNotServiceable);

    // ---- 1. alt sınır ve ikinci imza ----
    if let Some(co) = &ctx.accounts.co_signer {
        require_keys_eq!(co.key(), pool.admin, GlassError::InvalidCoSigner);
    }
    let value = loan.price.min(loan.appraised_value);
    let floor = bps_floor(value, pool.min_recovery_bps)?;
    if proceeds < floor {
        require!(ctx.accounts.co_signer.is_some(), GlassError::RecoveryBelowFloor);
    }

    // ---- 2. alacak ve zarar sırası ----
    let now = Clock::get()?.unix_timestamp;
    let periods = missed_installments(now, loan.next_due, pool.grace_seconds, pool.period_seconds)?;
    let accrued_interest = math::interest_for_period(loan.remaining_principal, loan.rate_bps)?
        .checked_mul(periods)
        .ok_or(GlassError::MathOverflow)?;
    let collateral_available = expected_collateral(loan)?.min(ctx.accounts.collateral.amount);
    let w = apply_waterfall(&WaterfallInput {
        remaining_principal: loan.remaining_principal,
        accrued_interest,
        late_fees: loan.late_fee_accrued,
        collateral: collateral_available,
        proceeds,
        first_loss_available: pool.first_loss_balance,
        reserve_available: pool.reserve_balance,
    })?;

    // ---- 3. transferler ----
    // Satış geliri: ajan imzalı, yalnızca kullanılan kısım.
    if w.proceeds_used > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.recovery_source.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.recovery_agent.to_account_info(),
                },
            ),
            w.proceeds_used,
        )?;
    }
    // Teminat, ilk zarar kasası, yedek fon: Pool PDA imzalı.
    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[POOL_SEED, pool.admin.as_ref(), &pool_id_bytes, &[pool.bump]]];
    for (from, value) in [
        (ctx.accounts.collateral.to_account_info(), w.collateral_used),
        (ctx.accounts.first_loss.to_account_info(), w.first_loss_used),
        (ctx.accounts.reserve.to_account_info(), w.reserve_used),
    ] {
        if value == 0 {
            continue;
        }
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from,
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer_seeds,
            ),
            value,
        )?;
    }

    // ---- 4. sayaçlar ----
    let into_vault = w
        .collateral_used
        .checked_add(w.proceeds_used)
        .and_then(|x| x.checked_add(w.first_loss_used))
        .and_then(|x| x.checked_add(w.reserve_used))
        .ok_or(GlassError::MathOverflow)?;
    let pool = &mut ctx.accounts.pool;
    let loan = &mut ctx.accounts.loan;
    let remaining = loan.remaining_principal;

    pool.idle_cash = pool.idle_cash.checked_add(into_vault).ok_or(GlassError::MathOverflow)?;
    pool.total_outstanding = pool
        .total_outstanding
        .checked_sub(remaining)
        .ok_or(GlassError::InvariantViolation)?;
    pool.late_default_principal = pool
        .late_default_principal
        .checked_sub(remaining)
        .ok_or(GlassError::InvariantViolation)?;
    pool.first_loss_balance -= w.first_loss_used;
    pool.reserve_balance -= w.reserve_used;
    let (pool_total, _) = apply_provision_change(pool.loss_provision, loan.provision_amount, 0)?;
    pool.loss_provision = pool_total;

    let deducted = loan_ext::collateral_deducted(loan)
        .checked_add(w.collateral_used)
        .ok_or(GlassError::MathOverflow)?;
    loan_ext::set_collateral_deducted(loan, deducted);
    loan.remaining_principal = 0;
    loan.late_fee_accrued = 0;
    loan.provision_amount = 0;
    loan.status = LoanStatus::Recovered;

    // ---- 5. invariant'lar ----
    ctx.accounts.vault.reload()?;
    ctx.accounts.first_loss.reload()?;
    ctx.accounts.reserve.reload()?;
    ctx.accounts.collateral.reload()?;
    assert_vault_covers_idle(ctx.accounts.vault.amount, ctx.accounts.pool.idle_cash)?;
    require!(
        ctx.accounts.first_loss.amount >= ctx.accounts.pool.first_loss_balance,
        GlassError::InvariantViolation
    );
    require!(
        ctx.accounts.reserve.amount >= ctx.accounts.pool.reserve_balance,
        GlassError::InvariantViolation
    );
    assert_escrow_covers(ctx.accounts.collateral.amount, expected_collateral(&ctx.accounts.loan)?)?;

    emit!(RecoveryRecorded {
        pool: ctx.accounts.pool.key(),
        loan: ctx.accounts.loan.key(),
        loan_id: ctx.accounts.loan.id,
        proceeds: w.proceeds_used,
        collateral_used: w.collateral_used,
        loss: w.loss,
        first_loss_used: w.first_loss_used,
        reserve_used: w.reserve_used,
        senior_loss: w.senior_loss,
    });
    Ok(())
}
