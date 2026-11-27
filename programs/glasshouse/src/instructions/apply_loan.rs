//! apply_loan: borrower ve seller birlikte imzalar. Borçlu, peşinat + %1 açılış ücretini
//! LoanEscrow'a, 3 taksitlik teminatı ayrı CollateralEscrow'a yatırır. Kredi `Pending` açılır.
//!
//! Zincire kişisel veri, ilan URL'si, şasi/plaka/tapu no yazılmaz: Loan yalnızca adresler,
//! tutarlar ve (approve_loan'da) hash/bant tutar. Kredi id'si borçludan değil havuz
//! sayacından gelir (`pool.next_loan_id`).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::GlassError;
use crate::events::LoanApplied;
use crate::math;
use crate::nav::{assert_escrow_covers, loan_escrow_expected};
use crate::state::*;

#[derive(Accounts)]
pub struct ApplyLoan<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    /// Satıcı da imzalar (alıcı-satıcı danışıklı işlemine karşı); para satıcıya
    /// ancak confirm_title'da gider.
    pub seller: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        init,
        payer = borrower,
        space = 8 + Loan::INIT_SPACE,
        seeds = [LOAN_SEED, pool.key().as_ref(), &pool.next_loan_id.to_le_bytes()],
        bump
    )]
    pub loan: Box<Account<'info, Loan>>,

    #[account(address = pool.usdc_mint @ GlassError::Unauthorized)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = borrower_usdc.mint == pool.usdc_mint @ GlassError::Unauthorized,
        constraint = borrower_usdc.owner == borrower.key() @ GlassError::Unauthorized
    )]
    pub borrower_usdc: Box<Account<'info, TokenAccount>>,

    /// Peşinat + açılış ücreti. Authority Pool PDA'sıdır (docs/STATE.md).
    #[account(
        init,
        payer = borrower,
        seeds = [ESCROW_SEED, loan.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = pool
    )]
    pub loan_escrow: Box<Account<'info, TokenAccount>>,

    /// 3 taksitlik teminat; LoanEscrow'dan ayrıdır.
    #[account(
        init,
        payer = borrower,
        seeds = [COLLATERAL_SEED, loan.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = pool
    )]
    pub collateral_escrow: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn apply_loan_handler(ctx: Context<ApplyLoan>, price: u64, down_payment: u64) -> Result<()> {
    require!(
        ctx.accounts.pool.status == PoolStatus::Active,
        GlassError::InvalidStatus
    );
    require!(price > 0, GlassError::ZeroAmount);
    require!(
        ctx.accounts.seller.key() != ctx.accounts.borrower.key(),
        GlassError::SellerIsBorrower
    );

    let pool = &ctx.accounts.pool;
    // peşinat ≥ (1 − max_ltv) × fiyat; principal = fiyat − peşinat.
    let min_down = math::min_down_payment(price, pool.max_ltv_bps)?;
    require!(down_payment >= min_down, GlassError::InsufficientDownPayment);
    require!(down_payment < price, GlassError::ZeroAmount);
    let principal = price - down_payment;

    let installment = math::installment(principal, pool.rate_bps, pool.term_months)?;
    let fee = math::origination_fee(principal)?;
    let escrow_amount = down_payment
        .checked_add(fee)
        .ok_or(GlassError::MathOverflow)?;
    let collateral_amount = math::collateral_amount(installment)?;

    // Borçlu → LoanEscrow (peşinat + ücret), borçlu → CollateralEscrow (teminat).
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.borrower_usdc.to_account_info(),
                to: ctx.accounts.loan_escrow.to_account_info(),
                authority: ctx.accounts.borrower.to_account_info(),
            },
        ),
        escrow_amount,
    )?;
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.borrower_usdc.to_account_info(),
                to: ctx.accounts.collateral_escrow.to_account_info(),
                authority: ctx.accounts.borrower.to_account_info(),
            },
        ),
        collateral_amount,
    )?;

    let loan_key = ctx.accounts.loan.key();
    let pool_key = ctx.accounts.pool.key();
    let loan_id = ctx.accounts.pool.next_loan_id;
    let rate_bps = ctx.accounts.pool.rate_bps;
    let borrower = ctx.accounts.borrower.key();
    let seller = ctx.accounts.seller.key();

    let loan = &mut ctx.accounts.loan;
    loan.id = loan_id;
    loan.pool = pool_key;
    loan.borrower = borrower;
    loan.seller = seller;
    loan.price = price;
    loan.appraised_value = 0;
    loan.principal = principal;
    loan.rate_bps = rate_bps;
    loan.installment = installment;
    loan.remaining_principal = principal;
    loan.paid_installments = 0;
    loan.missed_installments = 0;
    loan.next_due = 0;
    loan.status = LoanStatus::Pending;
    loan.doc_hash = [0u8; 32];
    loan.asset_ref_hash = [0u8; 32];
    loan.value_band = 0;
    loan.region_code = 0;
    loan.income_ok = false;
    loan.currency_ok = false;
    loan.provision_amount = 0;
    loan.late_fee_accrued = 0;
    loan.last_processed_period = 0;
    loan.funded_at = 0;
    loan.title_deadline = 0;
    loan.bump = ctx.bumps.loan;
    loan.escrow_bump = ctx.bumps.loan_escrow;
    loan.collateral_bump = ctx.bumps.collateral_escrow;
    loan.reserved = [0u8; RESERVED_BYTES];

    let pool = &mut ctx.accounts.pool;
    pool.next_loan_id = pool
        .next_loan_id
        .checked_add(1)
        .ok_or(GlassError::MathOverflow)?;

    // invariant: escrow bakiyesi == kredi sayaçlarından beklenen tutar; teminat 3 taksit.
    ctx.accounts.loan_escrow.reload()?;
    ctx.accounts.collateral_escrow.reload()?;
    assert_escrow_covers(
        ctx.accounts.loan_escrow.amount,
        loan_escrow_expected(LoanStatus::Pending, price, principal)?,
    )?;
    assert_escrow_covers(ctx.accounts.collateral_escrow.amount, collateral_amount)?;

    emit!(LoanApplied {
        pool: pool_key,
        loan: loan_key,
        loan_id,
        borrower,
        seller,
        price,
        principal,
        installment,
        escrow_amount,
        collateral_amount,
    });
    Ok(())
}
