//! approve_loan(decision, ...): underwriter tek instruction'la onaylar ya da reddeder
//! (karar 4 ve 5; ayrı reject instruction'ı yok).
//!
//! Approve: Pending → Approved. Ekspertiz, hash'ler, bölge kodu ve uyum bayrakları yazılır.
//!   principal ≤ max_ltv × min(price, appraised_value) değilse AppraisalTooLow.
//! Reject: Pending → Rejected. LoanEscrow (peşinat + ücret) ve CollateralEscrow borçluya
//!   iade edilir, token hesapları kapatılır, rent borçluya döner.
//!
//! Zincire yalnızca hash, değer bandı ve şehir düzeyi bölge kodu yazılır.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::GlassError;
use crate::events::{LoanApproved, LoanRejected};
use crate::math;
use crate::nav::{assert_escrow_covers, loan_escrow_expected};
use crate::state::*;

#[derive(Accounts)]
pub struct ApproveLoan<'info> {
    #[account(mut)]
    pub underwriter: Signer<'info>,

    #[account(
        seeds = [POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump,
        has_one = underwriter @ GlassError::Unauthorized
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [LOAN_SEED, pool.key().as_ref(), &loan.id.to_le_bytes()],
        bump = loan.bump,
        constraint = loan.pool == pool.key() @ GlassError::Unauthorized
    )]
    pub loan: Box<Account<'info, Loan>>,

    /// Reject'te kapatılan hesapların rent'i buraya döner.
    /// CHECK: adres `loan.borrower` ile sabitlenir; yalnızca lamport alır.
    #[account(mut, address = loan.borrower @ GlassError::Unauthorized)]
    pub borrower: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = borrower_usdc.mint == pool.usdc_mint @ GlassError::Unauthorized,
        constraint = borrower_usdc.owner == loan.borrower @ GlassError::Unauthorized
    )]
    pub borrower_usdc: Box<Account<'info, TokenAccount>>,

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

    pub token_program: Program<'info, Token>,
}

/// Ekspertiz değerini asset_type'a göre banda yuvarlar (aşağı): ev 50k, araç 5k.
pub fn value_band_for(asset_type: AssetType, appraised_value: u64) -> u64 {
    let band = match asset_type {
        AssetType::House => VALUE_BAND_HOUSE,
        AssetType::Vehicle => VALUE_BAND_VEHICLE,
    };
    (appraised_value / band) * band
}

/// principal ≤ max_ltv × min(price, appraised_value) (fund_loan da kullanır).
pub fn check_ltv(loan: &Loan, appraised_value: u64, max_ltv_bps: u16) -> Result<()> {
    let basis = loan.price.min(appraised_value);
    let max = math::max_principal(basis, max_ltv_bps)?;
    require!(loan.principal <= max, GlassError::AppraisalTooLow);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn approve_loan_handler(
    ctx: Context<ApproveLoan>,
    decision: Decision,
    appraised_value: u64,
    doc_hash: [u8; 32],
    asset_ref_hash: [u8; 32],
    region_code: u16,
    income_ok: bool,
    currency_ok: bool,
) -> Result<()> {
    require!(
        ctx.accounts.loan.status == LoanStatus::Pending,
        GlassError::InvalidStatus
    );

    // Escrow bakiyeleri kredi sayaçlarıyla uyumlu olmadan hiçbir geçiş yapılmaz.
    let expected = loan_escrow_expected(
        LoanStatus::Pending,
        ctx.accounts.loan.price,
        ctx.accounts.loan.principal,
    )?;
    assert_escrow_covers(ctx.accounts.loan_escrow.amount, expected)?;
    let collateral_expected = math::collateral_amount(ctx.accounts.loan.installment)?;
    assert_escrow_covers(ctx.accounts.collateral_escrow.amount, collateral_expected)?;

    match decision {
        Decision::Approve => {
            require!(appraised_value > 0, GlassError::ZeroAmount);
            check_ltv(
                &ctx.accounts.loan,
                appraised_value,
                ctx.accounts.pool.max_ltv_bps,
            )?;
            let value_band = value_band_for(ctx.accounts.pool.asset_type, appraised_value);

            let loan = &mut ctx.accounts.loan;
            loan.appraised_value = appraised_value;
            loan.doc_hash = doc_hash;
            loan.asset_ref_hash = asset_ref_hash;
            loan.value_band = value_band;
            loan.region_code = region_code;
            loan.income_ok = income_ok;
            loan.currency_ok = currency_ok;
            loan.status = LoanStatus::Approved;

            emit!(LoanApproved {
                pool: ctx.accounts.pool.key(),
                loan: ctx.accounts.loan.key(),
                loan_id: ctx.accounts.loan.id,
                appraised_value,
                value_band,
                region_code,
                doc_hash,
                asset_ref_hash,
            });
        }
        Decision::Reject => {
            let pool_id_bytes = ctx.accounts.pool.pool_id.to_le_bytes();
            let signer_seeds: &[&[&[u8]]] = &[&[
                POOL_SEED,
                ctx.accounts.pool.admin.as_ref(),
                &pool_id_bytes,
                &[ctx.accounts.pool.bump],
            ]];

            let escrow_amount = ctx.accounts.loan_escrow.amount;
            let collateral_amount = ctx.accounts.collateral_escrow.amount;

            for (from, amount) in [
                (ctx.accounts.loan_escrow.to_account_info(), escrow_amount),
                (
                    ctx.accounts.collateral_escrow.to_account_info(),
                    collateral_amount,
                ),
            ] {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: from.clone(),
                            to: ctx.accounts.borrower_usdc.to_account_info(),
                            authority: ctx.accounts.pool.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    amount,
                )?;
                token::close_account(CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    CloseAccount {
                        account: from,
                        destination: ctx.accounts.borrower.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    signer_seeds,
                ))?;
            }

            ctx.accounts.loan.status = LoanStatus::Rejected;

            emit!(LoanRejected {
                pool: ctx.accounts.pool.key(),
                loan: ctx.accounts.loan.key(),
                loan_id: ctx.accounts.loan.id,
                refunded: escrow_amount
                    .checked_add(collateral_amount)
                    .ok_or(GlassError::MathOverflow)?,
            });
        }
    }
    Ok(())
}
